import { ApolloClient, InMemoryCache } from '@apollo/client/core';
import { GraphQLClient } from 'graphql-request';
import { ClientError } from 'graphql-request/dist/types';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import moment from 'moment-timezone';
import type ManagerSettings from 'homey/manager/settings';
import { Device, env } from 'homey';
import { UserAgentWebSocket } from './UserAgentWebSocket';
import { queries } from './queries';
import {
  getUserAgent,
  noticeError,
  startSegment,
  startTransaction,
} from './newrelic-transaction';
import {
  ERROR_CODE_HOME_NOT_FOUND,
  ERROR_CODE_UNAUTHENTICATED,
} from './constants';
import { randomBetweenRange, takeFromStartOrEnd } from './helpers';

export interface Logger {
  (message: string, data?: unknown): void;
}

export interface LiveMeasurement {
  data?: {
    liveMeasurement: {
      timestamp: string;
      power: number;
      accumulatedConsumption: number;
      accumulatedCost: number | null;
      accumulatedProduction: number;
      accumulatedReward: number | null;
      lastMeterConsumption: number | null;
      lastMeterProduction: number | null;
      currency: string | null;
      minPower: number;
      averagePower: number;
      maxPower: number;
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

export type TransformedPriceEntry = Omit<PriceInfoEntry, 'startsAt'> & {
  startsAt: moment.Moment;
};

export interface PriceData {
  today: TransformedPriceEntry[];
  latest?: TransformedPriceEntry;
  lowestToday?: TransformedPriceEntry;
  highestToday?: TransformedPriceEntry;
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

export class TibberApi {
  readonly #log: Logger;
  readonly #homeId?: string;
  #homeySettings: ManagerSettings;
  #token?: string;
  #client?: GraphQLClient;
  #timeZone?: string;
  quarterPrices: TransformedPriceEntry[] = [];

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
          console.error('Error while fetching home data', e);
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

          const tz = home.viewer.home?.timeZone;
          if (tz) {
            this.#log('Detected Tibber home timezone', tz);
            this.#timeZone = tz;
          }

          return home;
        })
        .catch(async (e) => {
          noticeError(e);
          console.error('Error while fetching home features', e);

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

  async populateCachedPriceInfos(
    homeySetTimeout: (
      callback: (...args: unknown[]) => void,
      ms: number,
      ...args: unknown[]
    ) => NodeJS.Timeout,
  ): Promise<void> {
    if (this.quarterPrices.length === 0) {
      this.#log(`No price infos cached. Fetch prices immediately.`);

      this.quarterPrices = await startSegment(
        'GetPriceInfo.CacheEmpty',
        true,
        () => this.#getPriceInfo(),
      );
    }

    if (this.quarterPrices.length === 0) {
      this.#log(`No prices available. Retry later.`);
      return;
    }

    const [last] = takeFromStartOrEnd(this.quarterPrices, -1)!;
    const lastPriceForDayLocal = last.startsAt.clone().startOf('day');
    this.#log(
      `Last price info entry is for day at local time ${lastPriceForDayLocal.format()}`,
    );

    // Last cache entry is OK but there might be new prices available
    const expectedPricePublishTime = moment
      .tz(this.#getTimeZone())
      .startOf('day')
      .add(13, 'hours');

    this.#log(
      `Expected price publish time is after ${expectedPricePublishTime.format()}`,
    );

    const nowLocal = moment();
    const tomorrowLocal = moment().startOf('day').add(1, 'day');

    if (
      lastPriceForDayLocal.isBefore(tomorrowLocal) &&
      nowLocal.isAfter(expectedPricePublishTime)
    ) {
      const delay = randomBetweenRange(0, 50 * 60);
      this.#log(
        `Last price info entry is before tomorrow and current time is after 13:00 CET. Schedule re-fetch prices after ${delay} seconds.`,
      );
      startSegment('GetPriceInfo.ScheduleFetchNewPrices', true, () => {
        homeySetTimeout(async () => {
          let data: TransformedPriceEntry[];
          try {
            data = await startTransaction('ScheduledGetPriceInfo', 'API', () =>
              this.#getPriceInfo(),
            );
          } catch (e) {
            console.error(
              'The following error happened when trying to re-fetch stale prices',
              e,
            );
            return;
          }

          this.quarterPrices = data;
        }, delay * 1000);
      });
    }

    this.#log(`Last price info entry is up-to-date`);
  }

  #getTimeZone(): string {
    return this.#timeZone ?? 'Europe/Oslo'; // fallback default
  }

  async #getPriceInfo(): Promise<TransformedPriceEntry[]> {
    const client = this.#getClient();

    this.#log('Get prices');
    const data = await startSegment('GetPriceInfo.Fetch', true, () =>
      client
        .request<PriceRatingResponse>(queries.getPriceQuery(this.#homeId!))
        .catch((e) => {
          noticeError(e);
          console.error('Error while fetching price data', e);
          throw e;
        }),
    );

    const startOfToday = moment().tz(this.#getTimeZone()).startOf('day');
    const startOfYesterday = startOfToday.clone().subtract(1, 'day');
    const pricesYesterday = this.quarterPrices?.filter(
      (p) =>
        p.startsAt.isBefore(startOfToday) &&
        p.startsAt.isSameOrAfter(startOfYesterday),
    );

    const pricesToday =
      data.viewer?.home?.currentSubscription?.priceInfo?.today ?? [];
    const pricesTomorrow =
      data.viewer?.home?.currentSubscription?.priceInfo?.tomorrow ?? [];

    return [
      ...pricesYesterday,
      ...pricesToday.map(transformPrice),
      ...pricesTomorrow.map(transformPrice),
    ];
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
          console.error('Error while fetching consumption data', e);
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
          console.log('Push notification sent', result);
        })
        .catch((e) => {
          noticeError(e);
          console.error('Error sending push notification', e);
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
    if (env.ACCESS_TOKEN !== undefined) return env.ACCESS_TOKEN;

    return this.#homeySettings.get('token');
  }
}

const transformPrice = (priceEntry: PriceInfoEntry): TransformedPriceEntry => {
  const res = priceEntry as unknown as TransformedPriceEntry;
  res.startsAt = moment(priceEntry.startsAt);
  return res;
};
