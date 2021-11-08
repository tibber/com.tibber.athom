import _ from 'lodash';
import ws from 'ws';
import ApolloClient from 'apollo-client';
import { GraphQLClient } from 'graphql-request';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { WebSocketLink } from 'apollo-link-ws';
import moment from 'moment-timezone';
import type ManagerSettings from 'homey/manager/settings';
import { queries } from './queries';

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
  totalCost: number; // this is marked as deprecated
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

export interface PriceInfo {
  startsAt: string;
  total: number;
  energy: number;
  tax: number;
  level: 'VERY_CHEAP' | 'CHEAP' | 'NORMAL' | 'EXPENSIVE' | 'VERY_EXPENSIVE';
}

export interface Homes {
  viewer: {
    homes: Home[];
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
    latitude: string;
    longitude: string;
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
const liveSubscriptionUrl = 'wss://api.tibber.com/v1-beta/gql/subscriptions';

export const getRandomDelay = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min) + min);

export class TibberApi {
  #log: Logger;
  #homeySettings: ManagerSettings;
  #priceInfoNextHours: PriceInfo[] = []; // it looks like this can either be an array of PriceInfo or just a value. double-check.
  #homeId?: string;
  #token?: string;
  #client?: GraphQLClient;

  // I really don't like that `homeId` and `token` are optional here,
  // but the oauth flow during drivers `onPair()` currently need them to be
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
          'User-Agent': 'Homey (Tibber App)',
        },
      });
    }

    return this.#client;
  }

  async getHomes(): Promise<Homes> {
    const client = this.#getClient();
    this.#log('Get homes');
    return client
      .request<Homes>(queries.getHomesQuery())
      .then((data) => data)
      .catch((e) => {
        console.error(`${new Date()} Error while fetching home data`, e);
        throw e;
      });
  }

  async getPriceInfoCached() {
    // Cache empty. Fetch immediately
    if (!this.#priceInfoNextHours.length) {
      this.#log(`No price infos cached. Fetch prices immediately.`);
      this.#priceInfoNextHours = await this.#getPriceInfo();
      return this.#priceInfoNextHours;
    }

    const last = _.last(this.#priceInfoNextHours) as PriceInfo;
    const lastPriceInfoDay = moment(last.startsAt).startOf('day');
    this.#log(`last price info entry is for day ${lastPriceInfoDay.format()}`);

    const now = moment();
    const today = moment().startOf('day');
    const tomorrow = moment().add(1, 'day').startOf('day');

    // Last cache entry too old. Fetch immediately
    if (lastPriceInfoDay < tomorrow) {
      this.#log(
        `Last price info entry is before tomorrow. Re-fetch prices immediately.`,
      );
      this.#priceInfoNextHours = await this.#getPriceInfo();
      return this.#priceInfoNextHours;
    }

    // Last cache entry is ok but there might be new prices available. Fetch after delay to avoid hitting the api at the same time
    const expectedPricePublishTime = today.add(13, 'hours');
    this.#log(
      `Expected price publish time is after ${expectedPricePublishTime.format()}`,
    );

    if (now > expectedPricePublishTime) {
      const delay = getRandomDelay(0, 50 * 60);
      this.#log(
        `Last price info entry is before tomorrow and current time is after 13:00. Schedule re-fetch prices after ${delay} seconds.`,
      );
      setTimeout(async () => {
        this.#priceInfoNextHours = await this.#getPriceInfo();
      }, delay * 1000);

      return this.#priceInfoNextHours;
    }

    // Last cache entry ok and no new prices available yet
    this.#log(`Last price info entry is up-to-date`);
    return this.#priceInfoNextHours;
  }

  async #getPriceInfo(): Promise<PriceInfo[]> {
    const client = this.#getClient();

    this.#log('Get prices');
    const data = await client
      .request(queries.getPriceQuery(this.#homeId!))
      .catch((e) => {
        console.error(`${new Date()} Error while fetching price data`, e);
        throw e;
      });

    const priceInfoToday = _.get(
      data,
      'viewer.home.currentSubscription.priceInfo.today',
    );
    const priceInfoTomorrow = _.get(
      data,
      'viewer.home.currentSubscription.priceInfo.tomorrow',
    );
    if (priceInfoToday && priceInfoTomorrow)
      this.#priceInfoNextHours = priceInfoToday.concat(priceInfoTomorrow);
    else if (priceInfoToday) this.#priceInfoNextHours = priceInfoToday;

    return this.#priceInfoNextHours;
  }

  async getConsumptionData(
    daysToFetch: number,
    hoursToFetch: number,
  ): Promise<ConsumptionData> {
    const client = this.#getClient();
    this.#log(`Get consumption for ${daysToFetch} days ${hoursToFetch} hours`);
    return client
      .request(
        queries.getConsumptionQuery(this.#homeId!, daysToFetch, hoursToFetch),
      )
      .catch((e) => {
        console.error(`${new Date()} Error while fetching consumption data`, e);
        throw e;
      });
  }

  async sendPush(title: string, message: string) {
    this.#log('Send push notification');
    const client = this.#getClient();
    const push = queries.getPushMessage(title, message);
    return client
      .request(push)
      .then((result) => {
        console.log(`${new Date()} Push notification sent`, result);
      })
      .catch((e) => {
        console.error(`${new Date()} Error sending push notification`, e);
        throw e;
      });
  }

  subscribeToLive(callback: (result: LiveMeasurement) => Promise<void>) {
    this.#log('Subscribe to live');
    if (this.#token === undefined) this.#token = this.getDefaultToken();
    if (this.#token === undefined) throw new Error('Access token not set');

    const wsLink = new WebSocketLink({
      uri: liveSubscriptionUrl,
      options: {
        reconnect: false,
        connectionParams: {
          token: this.#token,
        },
      },
      webSocketImpl: ws,
    });

    const wsClient = new ApolloClient({
      link: wsLink,
      cache: new InMemoryCache(),
    });

    return wsClient
      .subscribe({
        query: queries.getSubscriptionQuery(this.#homeId!),
        variables: {},
      })
      .subscribe(callback, console.error);
  }

  setDefaultToken(token: string) {
    this.#homeySettings.set('token', token);
  }

  getDefaultToken() {
    return this.#homeySettings.get('token');
  }
}
