import crypto from 'crypto';
import { EventEmitter } from 'events';
import { request } from './http';
import { LoginRequiredError } from './errors';

const AUTHORIZE_URL = 'https://thewall.tibber.com/connect/authorize';
const TOKEN_URL = 'https://thewall.tibber.com/connect/token';
// Homey's OAuth2 callback service; it hands the code to the pairing session
const REDIRECT_URI = 'https://callback.athom.com/oauth2/callback/';
const SCOPES =
  'openid offline_access data-api-user-read data-api-homes-read data-api-meters-read';
const TOKENS_SETTING = 'dataApiTokens';

interface Settings {
  get(key: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  set(key: string, value: unknown): void;
}

interface StoredTokens {
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const base64Url = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Tibber Data API login (OAuth2 authorization code, PKCE unless a client secret is set) and access
 * tokens, kept in Homey's app settings apart from the GraphQL API token. Emits `login` after a
 * successful login.
 */
export class DataApiAuth extends EventEmitter {
  readonly #settings: Settings;
  readonly #clientId?: string;
  readonly #clientSecret: string;
  readonly #authorizeUrl: string;
  readonly #tokenUrl: string;
  readonly #now: () => number;
  #pendingVerifier?: string;
  #refreshing?: Promise<string>;

  constructor({
    settings,
    clientId,
    clientSecret,
    authorizeUrl = AUTHORIZE_URL,
    tokenUrl = TOKEN_URL,
    now = Date.now,
  }: {
    settings: Settings;
    clientId?: string;
    clientSecret?: string;
    authorizeUrl?: string;
    tokenUrl?: string;
    now?: () => number;
  }) {
    super();
    this.#settings = settings;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret ?? '';
    this.#authorizeUrl = authorizeUrl;
    this.#tokenUrl = tokenUrl;
    this.#now = now;
  }

  get #tokens(): StoredTokens {
    return this.#settings.get(TOKENS_SETTING) ?? {};
  }

  isLoggedIn(): boolean {
    return Boolean(this.#tokens.refreshToken);
  }

  hasClient(): boolean {
    return Boolean(this.#clientId);
  }

  /** The URL to log in at. Each call starts a new login attempt. */
  startLogin(): string {
    if (!this.hasClient()) {
      throw new Error(
        'No Tibber Data API client is configured (DATA_API_CLIENT_ID).',
      );
    }
    const verifier = base64Url(crypto.randomBytes(48));
    this.#pendingVerifier = verifier;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.#clientId!,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state: base64Url(crypto.randomBytes(16)),
    });
    if (!this.#clientSecret) {
      params.set(
        'code_challenge',
        base64Url(crypto.createHash('sha256').update(verifier).digest()),
      );
      params.set('code_challenge_method', 'S256');
    }
    return `${this.#authorizeUrl}?${params.toString()}`;
  }

  /** Exchanges the code from the OAuth2 callback for tokens. */
  async finishLogin(code: string): Promise<void> {
    if (!this.#pendingVerifier) throw new Error('No login in progress.');
    if (!code) throw new Error('Tibber returned no login code.');

    const fields: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: this.#clientId!,
    };
    if (this.#clientSecret) fields.client_secret = this.#clientSecret;
    else fields.code_verifier = this.#pendingVerifier;

    const token = await this.#tokenRequest(fields);
    if (!token.refresh_token) {
      throw new Error(
        'Logged in, but Tibber returned no refresh token. The client needs the offline_access scope.',
      );
    }
    this.#storeTokens(token);
    this.#pendingVerifier = undefined;
    this.emit('login');
  }

  /** A valid access token, refreshed when it's about to expire. Concurrent callers share one refresh. */
  async getAccessToken({ forceRefresh = false } = {}): Promise<string> {
    const tokens = this.#tokens;
    if (
      !forceRefresh &&
      tokens.accessToken &&
      (tokens.expiresAt ?? 0) > this.#now() + 60 * 1000
    )
      return tokens.accessToken;
    if (!tokens.refreshToken) {
      throw new LoginRequiredError(
        'Not logged in to Tibber. Repair the device to log in.',
      );
    }

    if (!this.#refreshing) {
      this.#refreshing = this.#refresh(tokens.refreshToken).finally(() => {
        this.#refreshing = undefined;
      });
    }
    return this.#refreshing;
  }

  async #refresh(refreshToken: string): Promise<string> {
    const fields: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.#clientId ?? '',
    };
    if (this.#clientSecret) fields.client_secret = this.#clientSecret;

    let token: TokenResponse;
    try {
      token = await this.#tokenRequest(fields);
    } catch (e) {
      if ((e as { oauthError?: string }).oauthError === 'invalid_grant') {
        this.#settings.set(TOKENS_SETTING, {});
        throw new LoginRequiredError(
          'The Tibber login has expired. Repair the device to log in again.',
        );
      }
      throw e;
    }
    // Refresh tokens may be single-use, so the new one replaces the old straight away
    this.#storeTokens(token, refreshToken);
    return token.access_token;
  }

  async #tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
    const res = await request(this.#tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(fields).toString(),
    });
    let body: Partial<TokenResponse> & {
      error?: string;
      error_description?: string;
    } = {};
    try {
      body = res.json();
    } catch (e) {
      // not JSON; the status says enough
    }
    if (res.status !== 200) {
      const detail = [body.error, body.error_description]
        .filter(Boolean)
        .join(': ');
      const error = new Error(
        `Tibber login request failed: HTTP ${res.status}${
          detail ? ` (${detail})` : ''
        }`,
      ) as Error & { status?: number; oauthError?: string };
      error.status = res.status;
      error.oauthError = body.error;
      throw error;
    }
    return body as TokenResponse;
  }

  #storeTokens(token: TokenResponse, previousRefreshToken?: string) {
    const tokens: StoredTokens = {
      accessToken: token.access_token,
      expiresAt: this.#now() + (token.expires_in ?? 3600) * 1000,
      refreshToken: token.refresh_token ?? previousRefreshToken,
    };
    this.#settings.set(TOKENS_SETTING, tokens);
  }
}
