import http, { IncomingMessage } from 'http';
import https from 'https';

export interface TextResponse {
  status: number;
  text: string;
  json<T>(): T;
}

export interface OpenStream {
  status: number;
  res: IncomingMessage;
  close(): void;
}

const transport = (url: string) => (url.startsWith('https:') ? https : http);

/** Makes a request and resolves with the status and the whole body as text. */
export const request = (
  url: string,
  {
    method = 'GET',
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<TextResponse> =>
  new Promise((resolve, reject) => {
    const allHeaders =
      body === undefined
        ? headers
        : { ...headers, 'Content-Length': String(Buffer.byteLength(body)) };
    const req = transport(url).request(
      url,
      { method, headers: allHeaders },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text,
            json: <T>() => JSON.parse(text) as T,
          }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(30 * 1000, () =>
      req.destroy(new Error(`Request to ${url} timed out`)),
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

/** Opens a long-lived GET and resolves once the response headers arrive. */
export const openStream = (
  url: string,
  headers: Record<string, string>,
): Promise<OpenStream> =>
  new Promise((resolve, reject) => {
    const req = transport(url).request(url, { headers }, (res) => {
      resolve({ status: res.statusCode ?? 0, res, close: () => req.destroy() });
    });
    req.on('error', reject);
    req.end();
  });

/** Reads the rest of a response as text. */
export const readBody = (res: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      text += chunk;
    });
    res.on('end', () => resolve(text));
    res.on('error', reject);
  });
