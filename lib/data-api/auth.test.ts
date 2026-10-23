import crypto from 'crypto';
import { ServerResponse } from 'http';
import { DataApiAuth } from './auth';
import { LoginRequiredError } from './errors';
import { DataApiClient } from './client';
import {
  json,
  memorySettings,
  sleep,
  startServer,
  TestServer,
} from './test-helpers';

const CALLBACK = 'https://callback.athom.com/oauth2/callback/';

const b64url = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

let servers: TestServer[] = [];
afterEach(() => {
  servers.forEach((server) => server.close());
  servers = [];
});

/** A mock token endpoint; `respond` gets the posted form fields and the call count. */
const tokenServer = async (
  respond: (
    res: ServerResponse,
    fields: Record<string, string>,
    n: number,
  ) => void,
) => {
  const calls: Record<string, string>[] = [];
  const server = await startServer((req, res, body) => {
    const fields = Object.fromEntries(new URLSearchParams(body));
    calls.push(fields);
    respond(res, fields, calls.length);
  });
  servers.push(server);
  return { ...server, calls, tokenUrl: `${server.base}/token` };
};

const ok = (res: ServerResponse, extra = {}) =>
  json(res, 200, {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    expires_in: 3600,
    ...extra,
  });

describe('DataApiAuth login', () => {
  test('a public client uses PKCE and Homey’s callback, stores tokens and emits login', async () => {
    const server = await tokenServer((res) => ok(res));
    const settings = memorySettings();
    const auth = new DataApiAuth({
      settings,
      clientId: 'my-client',
      tokenUrl: server.tokenUrl,
    });
    const onLogin = jest.fn();
    auth.on('login', onLogin);

    const link = new URL(auth.startLogin());
    expect(link.origin + link.pathname).toBe(
      'https://thewall.tibber.com/connect/authorize',
    );
    expect(link.searchParams.get('client_id')).toBe('my-client');
    expect(link.searchParams.get('redirect_uri')).toBe(CALLBACK);
    expect(link.searchParams.get('scope')).toMatch(/offline_access/);
    expect(link.searchParams.get('scope')).toMatch(/data-api-meters-read/);
    expect(link.searchParams.get('code_challenge_method')).toBe('S256');
    expect(link.searchParams.get('state')).toBeTruthy();

    await auth.finishLogin('the-code');
    const { code_verifier: verifier, ...rest } = server.calls[0];
    expect(rest).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: CALLBACK,
      client_id: 'my-client',
    });
    expect(link.searchParams.get('code_challenge')).toBe(
      b64url(crypto.createHash('sha256').update(verifier).digest()),
    );
    expect(settings.get('dataApiTokens').refreshToken).toBe('refresh-1');
    expect(auth.isLoggedIn()).toBe(true);
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  test('a client with a secret sends the secret and no PKCE', async () => {
    const server = await tokenServer((res) => ok(res));
    const auth = new DataApiAuth({
      settings: memorySettings(),
      clientId: 'c',
      clientSecret: 's',
      tokenUrl: server.tokenUrl,
    });
    const link = new URL(auth.startLogin());
    expect(link.searchParams.get('code_challenge')).toBeNull();
    await auth.finishLogin('x');
    expect(server.calls[0].client_secret).toBe('s');
    expect(server.calls[0].code_verifier).toBeUndefined();
  });

  test('fails clearly without a client, a login in progress, a code, or a refresh token', async () => {
    const server = await tokenServer((res) =>
      json(res, 200, { access_token: 'a', expires_in: 3600 }),
    );
    const noClient = new DataApiAuth({ settings: memorySettings() });
    expect(noClient.hasClient()).toBe(false);
    expect(() => noClient.startLogin()).toThrow(/DATA_API_CLIENT_ID/);

    const auth = new DataApiAuth({
      settings: memorySettings(),
      clientId: 'c',
      tokenUrl: server.tokenUrl,
    });
    await expect(auth.finishLogin('x')).rejects.toThrow(/No login in progress/);
    auth.startLogin();
    await expect(auth.finishLogin('')).rejects.toThrow(/no login code/);
    await expect(auth.finishLogin('x')).rejects.toThrow(/offline_access/);
    expect(auth.isLoggedIn()).toBe(false);
  });
});

describe('DataApiAuth tokens', () => {
  test('reuses a valid token and refreshes an expiring one, once for concurrent callers', async () => {
    const server = await tokenServer(async (res, _fields, n) => {
      await sleep(50);
      ok(res, {
        access_token: `access-${n + 1}`,
        refresh_token: `refresh-${n + 1}`,
      });
    });
    let now = 1_000_000;
    const settings = memorySettings({
      dataApiTokens: {
        accessToken: 'access-1',
        expiresAt: now + 30 * 60 * 1000,
        refreshToken: 'refresh-1',
      },
    });
    const auth = new DataApiAuth({
      settings,
      clientId: 'c',
      tokenUrl: server.tokenUrl,
      now: () => now,
    });

    expect(await auth.getAccessToken()).toBe('access-1');
    expect(server.calls).toHaveLength(0);

    now += 30 * 60 * 1000; // within the minute before expiry
    const tokens = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
    ]);
    expect(tokens).toEqual(['access-2', 'access-2', 'access-2']);
    expect(server.calls).toEqual([
      {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-1',
        client_id: 'c',
      },
    ]);
    expect(settings.get('dataApiTokens').refreshToken).toBe('refresh-2');

    expect(await auth.getAccessToken({ forceRefresh: true })).toBe('access-3');
    expect(server.calls[1].refresh_token).toBe('refresh-2');
  });

  test('a refresh response without a new refresh token keeps the old one', async () => {
    const server = await tokenServer((res) =>
      json(res, 200, { access_token: 'new', expires_in: 3600 }),
    );
    const settings = memorySettings({
      dataApiTokens: { refreshToken: 'keep-me', expiresAt: 0 },
    });
    const auth = new DataApiAuth({
      settings,
      clientId: 'c',
      tokenUrl: server.tokenUrl,
    });
    expect(await auth.getAccessToken()).toBe('new');
    expect(settings.get('dataApiTokens').refreshToken).toBe('keep-me');
  });

  test('an expired login and a missing login raise LoginRequiredError; other failures keep the login', async () => {
    const server = await tokenServer((res, _fields, n) =>
      n === 1 ? json(res, 500, {}) : json(res, 400, { error: 'invalid_grant' }),
    );
    const settings = memorySettings({
      dataApiTokens: { refreshToken: 'r', expiresAt: 0 },
    });
    const auth = new DataApiAuth({
      settings,
      clientId: 'c',
      tokenUrl: server.tokenUrl,
    });

    const failure = await auth.getAccessToken().catch((e) => e);
    expect(failure).not.toBeInstanceOf(LoginRequiredError);
    expect(failure.message).toMatch(/HTTP 500/);
    expect(auth.isLoggedIn()).toBe(true);

    const expired = await auth.getAccessToken().catch((e) => e);
    expect(expired).toBeInstanceOf(LoginRequiredError);
    expect(expired.message).toMatch(/expired/);
    expect(auth.isLoggedIn()).toBe(false);

    await expect(auth.getAccessToken()).rejects.toThrow(/Not logged in/);
  });
});

test('DataApiClient refreshes the token once on 401 and reports other failures', async () => {
  const seen: (string | undefined)[] = [];
  const server = await startServer((req, res) => {
    seen.push(req.headers.authorization);
    if (req.headers.authorization === 'Bearer old') return json(res, 401, {});
    if (req.url === '/v1/homes')
      return json(res, 200, { homes: [{ id: 'h', name: 'Home' }] });
    return json(res, 503, { title: 'down' });
  });
  servers.push(server);
  const auth = {
    getAccessToken: async ({ forceRefresh = false } = {}) =>
      forceRefresh ? 'new' : 'old',
  };
  const client = new DataApiClient({ auth, baseUrl: server.base });
  expect(await client.listHomes()).toEqual([{ id: 'h', name: 'Home' }]);
  expect(seen).toEqual(['Bearer old', 'Bearer new']);
  await expect(client.listLiveDevices('h')).rejects.toThrow(/HTTP 503/);
});
