// Each home's stream state is a plain object that the methods below update in place
/* eslint-disable no-param-reassign */
import { openStream, readBody } from './http';
import { SseEvent, SseParser } from './sse';
import { DATA_API_URL } from './client';
import { LoginRequiredError } from './errors';
import type { DataApiAuth } from './auth';
import type { DataApiLiveMeasurement } from './measurement';

export const MAX_DEVICES_PER_STREAM = 5;

const DEFAULT_OPTIONS = {
  debounceMs: 1000, // devices initialising together share the first connection
  idleTimeoutMs: 60 * 1000, // the server pings after ~20 s of silence
  backoffMinMs: 5 * 1000,
  backoffMaxMs: 5 * 60 * 1000,
  evictedDelayMs: 5 * 60 * 1000,
  notStreamableRetryMs: 10 * 60 * 1000,
  loginRetryMs: 30 * 60 * 1000,
};

export type LiveStreamOptions = typeof DEFAULT_OPTIONS;

export interface LiveStreamListener {
  onMeasurement(frame: DataApiLiveMeasurement): void;
  onStatus?(status: { message: string }): void;
}

type Timer = unknown;

export interface Timers {
  setTimeout(callback: () => void, ms: number): Timer;
  clearTimeout(timer: Timer): void;
}

interface StreamError {
  code?: string;
  transient?: boolean;
  retryAfter?: number;
  deviceId?: string;
}

interface Home {
  id: string;
  listeners: Map<string, LiveStreamListener>;
  excluded: Map<string, number>; // deviceId -> retry after (epoch ms)
  generation: number;
  backoffMs: number;
  timer?: Timer;
  connection?: { close(): void; idleTimer?: Timer };
  forceRefresh?: boolean;
  retriedAuth?: boolean;
}

const jitter = (ms: number) => Math.round(ms * (0.75 + Math.random() * 0.5));

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

/**
 * Keeps one live-events stream per home open for every subscribed device. The Data API allows a
 * single stream per home (a second one evicts the first), so devices in the same home share it.
 *
 * Listeners get `onMeasurement(frame)` for each frame of their device and `onStatus({ message })`
 * when their device can't be streamed; the next measurement means it's streaming again.
 */
export class LiveStreams {
  readonly #auth: Pick<DataApiAuth, 'getAccessToken'>;
  readonly #baseUrl: string;
  readonly #log: (message: string) => void;
  readonly #timers: Timers;
  readonly #options: LiveStreamOptions;
  readonly #homes = new Map<string, Home>();

  constructor({
    auth,
    baseUrl = DATA_API_URL,
    log = () => {},
    timers = defaultTimers,
    options = {},
  }: {
    auth: Pick<DataApiAuth, 'getAccessToken'>;
    baseUrl?: string;
    log?: (message: string) => void;
    timers?: Timers;
    options?: Partial<LiveStreamOptions>;
  }) {
    this.#auth = auth;
    this.#baseUrl = baseUrl;
    this.#log = log;
    this.#timers = timers;
    this.#options = { ...DEFAULT_OPTIONS, ...options };
  }

  subscribe(
    homeId: string,
    deviceId: string,
    listener: LiveStreamListener,
  ): () => void {
    let home = this.#homes.get(homeId);
    if (!home) {
      home = {
        id: homeId,
        listeners: new Map(),
        excluded: new Map(),
        generation: 0,
        backoffMs: 0,
      };
      this.#homes.set(homeId, home);
    }
    home.listeners.set(deviceId, listener);
    home.excluded.delete(deviceId);
    this.#schedule(home, this.#options.debounceMs);
    return () => this.#unsubscribe(homeId, deviceId, listener);
  }

  /** Reconnects every home now, e.g. after a new login. */
  reconnectAll(): void {
    this.#homes.forEach((home) => {
      home.backoffMs = 0;
      home.excluded.clear();
      this.#schedule(home, 0);
    });
  }

  destroy(): void {
    this.#homes.forEach((home) => this.#stop(home));
    this.#homes.clear();
  }

  #unsubscribe(homeId: string, deviceId: string, listener: LiveStreamListener) {
    const home = this.#homes.get(homeId);
    if (!home || home.listeners.get(deviceId) !== listener) return;
    home.listeners.delete(deviceId);
    if (home.listeners.size > 0) {
      this.#schedule(home, this.#options.debounceMs);
      return;
    }
    this.#stop(home);
    this.#homes.delete(homeId);
  }

  #schedule(home: Home, delayMs: number) {
    this.#clearTimer(home.timer);
    home.timer = this.#timers.setTimeout(() => {
      home.timer = undefined;
      this.#connect(home).catch((e) =>
        this.#retry(home, `unexpected error: ${(e as Error).message}`),
      );
    }, delayMs);
  }

  #clearTimer(timer?: Timer) {
    if (timer !== undefined) this.#timers.clearTimeout(timer);
  }

  #stop(home: Home) {
    this.#clearTimer(home.timer);
    home.timer = undefined;
    this.#closeConnection(home);
  }

  #closeConnection(home: Home) {
    // Callbacks from the closed connection check the generation and ignore themselves
    home.generation += 1;
    if (!home.connection) return;
    this.#clearTimer(home.connection.idleTimer);
    home.connection.close();
    home.connection = undefined;
  }

  static #notify(home: Home, deviceIds: string[], message: string) {
    deviceIds.forEach((id) => home.listeners.get(id)?.onStatus?.({ message }));
  }

  #retry(home: Home, reason: string) {
    home.backoffMs = Math.min(
      this.#options.backoffMaxMs,
      home.backoffMs ? home.backoffMs * 2 : this.#options.backoffMinMs,
    );
    const delay = jitter(home.backoffMs);
    this.#log(
      `Home ${home.id}: ${reason}; reconnecting in ${Math.round(
        delay / 1000,
      )} s`,
    );
    this.#schedule(home, delay);
  }

  async #connect(home: Home) {
    this.#closeConnection(home);
    const { generation } = home;
    const isCurrent = () =>
      generation === home.generation && this.#homes.get(home.id) === home;

    const now = Date.now();
    home.excluded.forEach((until, id) => {
      if (until <= now) home.excluded.delete(id);
    });
    const candidates = [...home.listeners.keys()].filter(
      (id) => !home.excluded.has(id),
    );
    if (candidates.length === 0) {
      // Every device was reported as not streamable; check again when the first exclusion runs out
      if (home.excluded.size > 0)
        this.#schedule(home, Math.min(...home.excluded.values()) - now);
      return;
    }
    const deviceIds = candidates.slice(0, MAX_DEVICES_PER_STREAM);
    LiveStreams.#notify(
      home,
      candidates.slice(MAX_DEVICES_PER_STREAM),
      'Tibber streams at most 5 meters per home.',
    );

    let token: string;
    try {
      token = await this.#auth.getAccessToken({
        forceRefresh: Boolean(home.forceRefresh),
      });
      home.forceRefresh = false;
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof LoginRequiredError) {
        LiveStreams.#notify(home, deviceIds, (e as Error).message);
        this.#schedule(home, this.#options.loginRetryMs);
        return;
      }
      this.#retry(
        home,
        `getting an access token failed: ${(e as Error).message}`,
      );
      return;
    }
    if (!isCurrent()) return;

    const query = deviceIds
      .map((id) => `deviceId=${encodeURIComponent(id)}`)
      .join('&');
    let stream;
    try {
      stream = await openStream(
        `${this.#baseUrl}/v1/homes/${encodeURIComponent(
          home.id,
        )}/live-events?${query}`,
        { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      );
    } catch (e) {
      if (isCurrent())
        this.#retry(home, `connecting failed: ${(e as Error).message}`);
      return;
    }
    if (!isCurrent()) {
      stream.close();
      return;
    }

    if (stream.status !== 200) {
      const body = await readBody(stream.res).catch(() => '');
      stream.close();
      if (isCurrent())
        this.#handleHttpError(home, deviceIds, stream.status, body);
      return;
    }
    home.retriedAuth = false;
    this.#log(`Home ${home.id}: streaming ${deviceIds.length} device(s)`);

    const connection: Home['connection'] = { close: stream.close };
    home.connection = connection;
    const resetIdleTimer = () => {
      this.#clearTimer(connection.idleTimer);
      connection.idleTimer = this.#timers.setTimeout(() => {
        if (!isCurrent()) return;
        this.#closeConnection(home);
        this.#retry(
          home,
          `nothing received for ${Math.round(
            this.#options.idleTimeoutMs / 1000,
          )} s`,
        );
      }, this.#options.idleTimeoutMs);
    };
    resetIdleTimer();

    const parser = new SseParser();
    stream.res.setEncoding('utf8');
    stream.res.on('data', (text: string) => {
      if (!isCurrent()) return;
      resetIdleTimer();
      const events = parser.push(text);
      for (let i = 0; i < events.length && isCurrent(); i += 1)
        this.#handleEvent(home, deviceIds, events[i]);
    });
    const onEnd = () => {
      if (!isCurrent()) return;
      this.#closeConnection(home);
      this.#retry(home, 'the stream closed');
    };
    stream.res.on('end', onEnd);
    stream.res.on('close', onEnd);
    stream.res.on('error', onEnd);
  }

  #handleHttpError(
    home: Home,
    deviceIds: string[],
    status: number,
    body: string,
  ) {
    if (status === 401 && !home.retriedAuth) {
      // The access token may have been revoked early; refresh it once before backing off
      home.retriedAuth = true;
      home.forceRefresh = true;
      this.#schedule(home, 0);
      return;
    }
    if (status === 403) {
      LiveStreams.#notify(
        home,
        deviceIds,
        'The Tibber login is missing the data-api-meters-read scope. Repair the device to log in again.',
      );
      this.#schedule(home, this.#options.loginRetryMs);
      return;
    }
    this.#retry(home, `HTTP ${status} ${body.slice(0, 200)}`);
  }

  #handleEvent(home: Home, deviceIds: string[], { event, data }: SseEvent) {
    if (event === 'measurement') {
      const frame = data as DataApiLiveMeasurement | undefined;
      if (!frame?.deviceId) return;
      home.backoffMs = 0;
      home.listeners.get(frame.deviceId)?.onMeasurement(frame);
      return;
    }
    // `ping` only keeps proxies from closing the connection; unknown events are ignored
    if (event !== 'stream_error') return;

    const error = (data as StreamError | undefined) ?? { code: 'unknown' };
    this.#closeConnection(home); // stream errors are terminal
    if (error.code === 'device_not_streamable' && error.deviceId) {
      home.excluded.set(
        error.deviceId,
        Date.now() + this.#options.notStreamableRetryMs,
      );
      LiveStreams.#notify(
        home,
        [error.deviceId],
        'Tibber cannot stream this meter right now. It may be setting up, removed, or its Bridge is offline.',
      );
      this.#schedule(home, this.#options.debounceMs);
      return;
    }
    if (error.code === 'evicted') {
      // Reconnecting straight away would evict whoever took the slot, and they would evict us back
      LiveStreams.#notify(
        home,
        deviceIds,
        "Another app or integration took over this home's live stream. This device reconnects in a few minutes.",
      );
      this.#log(`Home ${home.id}: evicted by another connection`);
      this.#schedule(home, jitter(this.#options.evictedDelayMs));
      return;
    }
    if (error.transient && error.retryAfter) {
      this.#log(
        `Home ${home.id}: ${error.code}; retrying in ${error.retryAfter} s`,
      );
      this.#schedule(home, error.retryAfter * 1000);
      return;
    }
    this.#retry(home, `stream error ${error.code}`);
  }
}
