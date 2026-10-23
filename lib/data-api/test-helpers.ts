import http, { IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

export interface TestServer {
  base: string;
  close(): void;
}

/** In-memory stand-in for Homey's ManagerSettings. */
export const memorySettings = (initial: Record<string, unknown> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    get: (key: string) => values.get(key) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
};

/** Starts an HTTP server on a free port; `handle` gets the request body as text. */
export const startServer = (
  handle: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<TestServer> =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => handle(req, res, body));
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      }),
    );
  });

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export const sseFrame = (event: string, data?: unknown) =>
  `event: ${event}\n${
    data === undefined ? '' : `data: ${JSON.stringify(data)}\n`
  }\n`;

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Polls until `check` returns something truthy, or fails after `timeoutMs`. */
export const waitFor = async <T>(
  check: () => T,
  what: string,
  timeoutMs = 3000,
): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const result = check();
    if (result) return result;
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(10);
  }
};
