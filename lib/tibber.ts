import _ from 'lodash';
import { ApolloClient, InMemoryCache } from '@apollo/client/core';
import { GraphQLClient } from 'graphql-request';
import { ClientError } from 'graphql-request/dist/types';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import moment from 'moment-timezone';
import type ManagerSettings from 'homey/manager/settings';
import { Device } from 'homey';
import { UserAgentWebSocket } from './UserAgentWebSocket';
import { queries } from './queries';
import {
  noticeError,
  startSegment,
  startTransaction,
  getUserAgent,
} from './newrelic-transaction';
import {
  ERROR_CODE_HOME_NOT_FOUND,
  ERROR_CODE_UNAUTHENTICATED,
} from './constants';

export interface Logger {
  (message: string, data?: unknown): void;
}

export interface LiveMeasurement {
  data?: {
    liveMeasurement: {
      timestamp: string;
      power: number | null;
      accumulatedConsumption: number | null;
      accumulatedCost: number | null;
      currency: string | null;
      minPower: number | null;
      averagePower: number | null;
      maxPower: number | null;
      powerProduction: number | null;
      currentL1: number | null;
      currentL2: number | null;
      currentL3: number | null;
    } | null;
  };
}

export interface ConsumptionNode {
  from: string;
  to: string;
  consumption: number;
  totalCost: number;
  unitCost: number;
  unitPrice: number;
}

export interface ConsumptionData {
  viewer: {
    home: {
      daily: {
        nodes: ConsumptionNode[];
      } | null;
      hourly: {
        nodes: ConsumptionNode[];
      } | null;
    } | null;
  };
}

export interface PriceRatingResponse {
  viewer: {
    home: {
      currentSubscription: {
        priceInfo: {
          today: PriceInfoEntry[];
          tomorrow: PriceInfoEntry[];
        } | null;
      } | null;
    };
  };
}

export interface PriceInfoEntry {
  startsAt: string;
  total: number;
  energy: number;
  tax: number;
  level: 'VERY_CHEAP' | 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE';
}

export interface Homes {
  viewer: {
    homes: Home[];
    websocketSubscriptionUrl: string;
  };
}

export interface HomeResponse {
  viewer: {
    home: Home | null;
    websocketSubscriptionUrl: string;
  };
}

export type Home = {
  id: string;
  name: string;
  timeZone: string;
  address: {
    address1: string;
    postalCode: string;
    city: string;
  };
  features: Partial<{
    realTimeConsumptionEnabled: boolean;
  }> | null;
  currentSubscription: Partial<{
    status: 'running' | 'awaiting time restriction';
  }> | null;
};

const apiHost = 'https://api.tibber.com';
const apiPath = '/v1-beta/gql';

export const getRandomDelay = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min) + min);

export class TibberApi {
  readonly #log: Logger;
  readonly #homeId?: string;
  #homeySettings: ManagerSettings;
  #hourlyPrices: PriceInfoEntry[] = [];
  #token?: string;
  #client?: GraphQLClient;

  constructor(
    log: Logger,
    homeySettings: ManagerSettings,
    homeId?: string,
    token?: string,
  ) {
    this.#log = log;
    this.#homeySettings = homeySettings;
    this.#token = token;
    this.#homeId = homeId;
    this.#log(
      `Initialize Tibber client for home ${homeId} using token ${token}`,
    );
  }

  #getClient(): GraphQLClient {
    if (this.#token === undefined) this.#token = this.getDefaultToken();
    if (this.#token === undefined) throw new Error('Access token not set');

    if (this.#client === undefined) {
      this.#client = new GraphQLClient(`${apiHost}${apiPath}`, {
        timeout: 5 * 60 * 1000,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          'User-Agent': getUserAgent(),
        },
      });
    }

    return this.#client;
  }

  async getHomes(): Promise<Homes> {
    const client = this.#getClient();

    this.#log('Get homes');
    return startSegment('GetHomes.Fetch', true, () =>
      client
        .request<Homes>(queries.getHomesQuery())
        .then((data) => data)
        .catch((e) => {
          noticeError(e);
          console.error(`${new Date()} Error while fetching home data`, e);
          throw e;
        }),
    );
  }

  async getHomeFeatures(device: Device): Promise<HomeResponse> {
    const client = this.#getClient();

    this.#log(`Get features for home ${this.#homeId!}`);
    return startSegment('GetHomeFeatures.Fetch', true, () =>
      client
        .request<HomeResponse>(queries.getHomeFeaturesByIdQuery(this.#homeId!))
        .then((home) => {
          this.#log('Home features', home);
          return home;
        })
        .catch(async (e) => {
          noticeError(e);
          console.error(`${new Date()} Error while fetching home features`, e);

          const errorCode = (e as ClientError).response?.errors?.[0]?.extensions
            ?.code;
          if (errorCode !== undefined) {
            this.#log('Received error code', errorCode);
            if (errorCode === ERROR_CODE_HOME_NOT_FOUND) {
              this.#log(
                `Home with id ${this
                  .#homeId!} not found; set device unavailable.`,
              );
              await device.setUnavailable(
                'Tibber home with specified id not found. Please re-add device.',
              );
            } else if (errorCode === ERROR_CODE_UNAUTHENTICATED) {
              this.#log('Invalid access token; set device unavailable.');
              await device.setUnavailable(
                'Invalid access token. Please re-add device.',
              );
            }
          }

          throw e;
        }),
    );
  }

  async getPriceInfoCached(
    homeySetTimeout: (
      callback: (...args: unknown[]) => void,
      ms: number,
      ...args: unknown[]
    ) => NodeJS.Timeout,
  ): Promise<PriceInfoEntry[]> {
    if (!this.#hourlyPrices.length) {
      this.#log(`No price infos cached. Fetch prices immediately.`);

      this.#hourlyPrices = await startSegment(
        'GetPriceInfo.CacheEmpty',
        true,
        () => this.#getPriceInfo(),
      );

      return this.#hourlyPrices;
    }

    const last = _.last(this.#hourlyPrices) as PriceInfoEntry;
    const lastPriceForDay = moment(last.startsAt).startOf('day');
    this.#log(
      `Last price info entry is for day at system time ${lastPriceForDay.format()}`,
    );

    const now = moment();
    const today = moment().startOf('day');
    const tomorrow = today.add(1, 'day');

    // Last cache entry is OK but there might be new prices available
    const expectedPricePublishTime = moment
      .tz('Europe/Oslo')
      .startOf('day')
      .add(13, 'hours');
    this.#log(
      `Expected price publish time is after ${expectedPricePublishTime.format()}`,
    );

    if (lastPriceForDay < tomorrow && now > expectedPricePublishTime) {
      const delay = getRandomDelay(0, 50 * 60);
      this.#log(
        `Last price info entry is before tomorrow and current time is after 13:00 CET. Schedule re-fetch prices after ${delay} seconds.`,
      );
      startSegment('GetPriceInfo.ScheduleFetchNewPrices', true, () => {
        homeySetTimeout(async () => {
          let data: PriceInfoEntry[];
          try {
            data = await startTransaction('ScheduledGetPriceInfo', 'API', () =>
              this.#getPriceInfo(),
            );
          } catch (e) {
            console.error(
              `${new Date()} The following error happened when trying to re-fetch stale prices`,
              e,
            );
            return;
          }

          this.#hourlyPrices = data;
        }, delay * 1000);
      });

      return this.#hourlyPrices;
    }

    this.#log(`Last price info entry is up-to-date`);
    return this.#hourlyPrices;
  }

  async #getPriceInfo(): Promise<PriceInfoEntry[]> {
    const client = this.#getClient();

    this.#log('Get prices');
    const data = await startSegment('GetPriceInfo.Fetch', true, () =>
      client
        .request<PriceRatingResponse>(queries.getPriceQuery(this.#homeId!))
        .catch((e) => {
          noticeError(e);
          console.error(`${new Date()} Error while fetching price data`, e);
          throw e;
        }),
    );

    const pricesToday =
      data.viewer?.home?.currentSubscription?.priceInfo?.today ?? [];
    const pricesTomorrow =
      data.viewer?.home?.currentSubscription?.priceInfo?.tomorrow ?? [];

    this.#hourlyPrices = [...pricesToday, ...pricesTomorrow];

    return this.#hourlyPrices;
  }

  async getConsumptionData(
    daysToFetch: number,
    hoursToFetch: number,
  ): Promise<ConsumptionData> {
    const client = this.#getClient();

    this.#log(`Get consumption for ${daysToFetch} days ${hoursToFetch} hours`);
    return startSegment('GetConsumption.Fetch', true, () =>
      client
        .request<ConsumptionData>(
          queries.getConsumptionQuery(this.#homeId!, daysToFetch, hoursToFetch),
        )
        .catch((e) => {
          noticeError(e);
          console.error(
            `${new Date()} Error while fetching consumption data`,
            e,
          );
          throw e;
        }),
    );
  }

  async sendPush(title: string, message: string): Promise<void> {
    const client = this.#getClient();

    this.#log('Send push notification');
    const push = queries.getPushMessage(title, message);
    return startTransaction('SendPushNotification', 'API', () =>
      client
        .request(push)
        .then((result) => {
          console.log(`${new Date()} Push notification sent`, result);
        })
        .catch((e) => {
          noticeError(e);
          console.error(`${new Date()} Error sending push notification`, e);
          throw e;
        }),
    );
  }

  subscribeToLive(websocketSubscriptionUrl: string) {
    this.#log('Subscribe to live; create web socket client');
    if (this.#token === undefined) this.#token = this.getDefaultToken();
    if (this.#token === undefined) throw new Error('Access token not set');

    const webSocketClient = createClient({
      url: websocketSubscriptionUrl,

      connectionParams: {
        token: this.#token,
      },
      webSocketImpl: UserAgentWebSocket,
    });

    const wsLink = new GraphQLWsLink(webSocketClient);

    this.#log('Subscribe to live; create apollo client');
    const apolloClient = new ApolloClient({
      link: wsLink,
      cache: new InMemoryCache(),
    });

    this.#log('Subscribe to live; call apollo subscribe');
    return apolloClient.subscribe({
      query: queries.getSubscriptionQuery(this.#homeId!),
      variables: {},
    });
  }

  setDefaultToken(token: string): void {
    this.#homeySettings.set('token', token);
  }

  getDefaultToken(): string {
    return this.#homeySettings.get('token');
  }
}
