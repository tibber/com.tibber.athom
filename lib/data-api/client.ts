import { request } from './http';
import type { DataApiAuth } from './auth';
import type { DiscoveredDevice } from './device-kind';

export const DATA_API_URL = 'https://data-api.tibber.com';

export interface DataApiHome {
  id: string;
  name: string;
}

/** The Tibber Data API's REST endpoints this app needs. */
export class DataApiClient {
  readonly #auth: Pick<DataApiAuth, 'getAccessToken'>;
  readonly #baseUrl: string;

  constructor({
    auth,
    baseUrl = DATA_API_URL,
  }: {
    auth: Pick<DataApiAuth, 'getAccessToken'>;
    baseUrl?: string;
  }) {
    this.#auth = auth;
    this.#baseUrl = baseUrl;
  }

  async #get<T>(path: string, forceRefresh = false): Promise<T> {
    const token = await this.#auth.getAccessToken({ forceRefresh });
    const res = await request(`${this.#baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    // An access token can be revoked before it expires; refresh once on 401
    if (res.status === 401 && !forceRefresh) return this.#get(path, true);
    if (res.status !== 200) {
      throw new Error(
        `Tibber Data API ${path} failed: HTTP ${res.status} ${res.text.slice(
          0,
          200,
        )}`,
      );
    }
    return res.json<T>();
  }

  async listHomes(): Promise<DataApiHome[]> {
    return (await this.#get<{ homes: DataApiHome[] }>('/v1/homes')).homes;
  }

  /** Devices that can be passed to the live-events stream. Bridge-attached Pulses need an active Bridge. */
  async listLiveDevices(homeId: string): Promise<DiscoveredDevice[]> {
    return (
      await this.#get<{ devices: DiscoveredDevice[] }>(
        `/v1/homes/${encodeURIComponent(homeId)}/live-events/devices`,
      )
    ).devices;
  }
}
