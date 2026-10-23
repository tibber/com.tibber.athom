import { ServerResponse } from 'http';
import { LiveStreams, LiveStreamListener } from './live-streams';
import { LoginRequiredError } from './errors';
import type { DataApiLiveMeasurement } from './measurement';
import { json, sleep, sseFrame, startServer, waitFor } from './test-helpers';

const FAST = {
  debounceMs: 10,
  idleTimeoutMs: 400,
  backoffMinMs: 30,
  backoffMaxMs: 200,
  evictedDelayMs: 400,
  notStreamableRetryMs: 2000,
  loginRetryMs: 300,
};

interface Connection {
  ids: string[];
  token?: string;
  path: string;
  closed: boolean;
}

type Auth = ConstructorParameters<typeof LiveStreams>[0]['auth'];

let cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
});

/**
 * A mock live-events endpoint. `onStream` drives each connection, `n` counting connections from 1,
 * and `status` can answer a connection with an HTTP error instead.
 */
const setup = async (
  onStream: (res: ServerResponse, n: number) => void,
  {
    auth = { getAccessToken: async () => 'tok' },
    status,
  }: {
    auth?: Auth;
    status?: (n: number, connection: Connection) => number;
  } = {},
) => {
  const connections: Connection[] = [];
  const server = await startServer((req, res) => {
    const url = new URL(req.url ?? '', 'http://x');
    const connection: Connection = {
      ids: url.searchParams.getAll('deviceId'),
      token: req.headers.authorization,
      path: url.pathname,
      closed: false,
    };
    connections.push(connection);
    res.on('close', () => {
      connection.closed = true;
    });
    const forced = status?.(connections.length, connection);
    if (forced) return json(res, forced, { title: 'nope' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sseFrame('ping'));
    return onStream(res, connections.length);
  });
  const logs: string[] = [];
  const streams = new LiveStreams({
    auth,
    baseUrl: server.base,
    log: (line) => logs.push(line),
    options: FAST,
  });
  cleanups.push(() => {
    streams.destroy();
    server.close();
  });
  return { connections, streams, logs };
};

const recorder = () => {
  const frames: DataApiLiveMeasurement[] = [];
  const statuses: string[] = [];
  const listener: LiveStreamListener = {
    onMeasurement: (frame) => frames.push(frame),
    onStatus: ({ message }) => statuses.push(message),
  };
  return { frames, statuses, listener };
};

test('devices in one home share one stream and each gets its own frames', async () => {
  const { connections, streams } = await setup((res) => {
    res.write(sseFrame('measurement', { deviceId: 'b', power: 2 }));
    res.write(sseFrame('measurement', { deviceId: 'a', power: 1 }));
  });
  const a = recorder();
  const b = recorder();
  streams.subscribe('home', 'a', a.listener);
  streams.subscribe('home', 'b', b.listener);
  await waitFor(() => a.frames.length && b.frames.length, 'frames');
  expect(connections).toHaveLength(1);
  expect(connections[0].path).toBe('/v1/homes/home/live-events');
  expect(connections[0].ids).toEqual(['a', 'b']);
  expect(connections[0].token).toBe('Bearer tok');
  expect(a.frames).toEqual([{ deviceId: 'a', power: 1 }]);
  expect(b.frames).toEqual([{ deviceId: 'b', power: 2 }]);
});

test('a closed stream is reopened with backoff', async () => {
  const { connections, streams, logs } = await setup((res, n) => {
    res.write(sseFrame('measurement', { deviceId: 'a', power: n }));
    if (n === 1) res.end();
  });
  const a = recorder();
  streams.subscribe('home', 'a', a.listener);
  await waitFor(() => a.frames.length === 2, 'second connection');
  expect(connections).toHaveLength(2);
  expect(logs.some((line) => /the stream closed/.test(line))).toBe(true);
});

test('a silent stream is closed and reopened after the idle timeout', async () => {
  const { connections, streams } = await setup(() => {});
  streams.subscribe('home', 'a', recorder().listener);
  await waitFor(() => connections.length === 2, 'reconnect');
  expect(connections[0].closed).toBe(true);
});

test('evicted: devices are told, and the stream waits before reconnecting', async () => {
  const { connections, streams } = await setup((res, n) => {
    if (n === 1) {
      res.write(
        sseFrame('stream_error', { code: 'evicted', transient: false }),
      );
    } else {
      res.write(sseFrame('measurement', { deviceId: 'a', power: 5 }));
    }
  });
  const a = recorder();
  streams.subscribe('home', 'a', a.listener);
  await waitFor(() => a.statuses.length, 'status');
  expect(a.statuses[0]).toMatch(/took over/);
  await waitFor(() => connections[0].closed, 'close');
  await sleep(150);
  expect(connections).toHaveLength(1);
  await waitFor(() => a.frames.length, 'frame after reconnect');
});

test('device_not_streamable drops that device and keeps streaming the others', async () => {
  const { connections, streams } = await setup((res, n) => {
    if (n === 1) {
      res.write(
        sseFrame('stream_error', {
          code: 'device_not_streamable',
          transient: false,
          deviceId: 'b',
        }),
      );
    } else {
      res.write(sseFrame('measurement', { deviceId: 'a', power: 1 }));
    }
  });
  const a = recorder();
  const b = recorder();
  streams.subscribe('home', 'a', a.listener);
  streams.subscribe('home', 'b', b.listener);
  await waitFor(() => a.frames.length, 'frame for a');
  expect(connections[1].ids).toEqual(['a']);
  expect(b.statuses[0]).toMatch(/cannot stream/);
  expect(a.statuses).toEqual([]);
});

test('a transient error is retried after retryAfter', async () => {
  const { connections, streams } = await setup((res, n) => {
    if (n === 1) {
      res.write(
        sseFrame('stream_error', {
          code: 'upstream_unavailable',
          transient: true,
          retryAfter: 0.2,
        }),
      );
    }
  });
  streams.subscribe('home', 'a', recorder().listener);
  await waitFor(() => connections[0]?.closed, 'close');
  const closedAt = Date.now();
  await waitFor(() => connections.length === 2, 'retry');
  expect(Date.now() - closedAt).toBeGreaterThanOrEqual(150);
});

test('401 refreshes the token once and reconnects', async () => {
  const forced: boolean[] = [];
  const auth: Auth = {
    getAccessToken: async ({ forceRefresh = false } = {}) => {
      forced.push(forceRefresh);
      return forceRefresh ? 'fresh' : 'stale';
    },
  };
  const { connections, streams } = await setup(
    (res) => res.write(sseFrame('measurement', { deviceId: 'a', power: 1 })),
    {
      auth,
      status: (_n, c) => (c.token === 'Bearer stale' ? 401 : 0),
    },
  );
  const a = recorder();
  streams.subscribe('home', 'a', a.listener);
  await waitFor(() => a.frames.length, 'frame');
  expect(forced).toEqual([false, true]);
  expect(connections[connections.length - 1].token).toBe('Bearer fresh');
});

test('403 tells the devices about the missing scope', async () => {
  const { streams } = await setup(() => {}, { status: () => 403 });
  const a = recorder();
  streams.subscribe('home', 'a', a.listener);
  await waitFor(() => a.statuses.length, 'status');
  expect(a.statuses[0]).toMatch(/data-api-meters-read/);
});

test('without a login the devices are told and nothing connects', async () => {
  const auth: Auth = {
    getAccessToken: async () => {
      throw new LoginRequiredError('Not logged in to Tibber.');
    },
  };
  const { connections, streams } = await setup(() => {}, { auth });
  const a = recorder();
  streams.subscribe('home', 'a', a.listener);
  await waitFor(() => a.statuses.length, 'status');
  expect(a.statuses[0]).toBe('Not logged in to Tibber.');
  expect(connections).toHaveLength(0);
});

test('removing the last device closes the stream for good', async () => {
  const { connections, streams } = await setup(() => {});
  const unsubscribe = streams.subscribe('home', 'a', recorder().listener);
  await waitFor(() => connections.length === 1, 'connection');
  unsubscribe();
  await waitFor(() => connections[0].closed, 'close');
  await sleep(600); // longer than the idle timeout and backoff
  expect(connections).toHaveLength(1);
});

test('more than five devices: five stream, the rest are told why', async () => {
  const { connections, streams } = await setup(() => {});
  const listeners = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => {
    const r = recorder();
    streams.subscribe('home', id, r.listener);
    return r;
  });
  await waitFor(() => connections.length === 1, 'connection');
  expect(connections[0].ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(listeners[5].statuses[0]).toMatch(/at most 5/);
});

test('homes stream independently', async () => {
  const { connections, streams } = await setup(() => {});
  streams.subscribe('home1', 'a', recorder().listener);
  streams.subscribe('home2', 'b', recorder().listener);
  await waitFor(() => connections.length === 2, 'connections');
  expect(connections.map((c) => c.path).sort()).toEqual([
    '/v1/homes/home1/live-events',
    '/v1/homes/home2/live-events',
  ]);
});
