import PairSession from 'homey/lib/PairSession';
import { ClientError } from 'graphql-request/dist/types';
import { noticeError, startTransaction } from './newrelic-transaction';
import { Home, Logger, TibberApi } from './tibber-api';

export interface HomeFilterPredicate {
  (home: Home): boolean;
}

export interface HomeDevice {
  name: string;
  data: Home & {
    t: string;
  };
}

export const createListDeviceHandler =
  (
    log: Logger,
    tibber: TibberApi,
    filterPredicate: HomeFilterPredicate,
    deviceNameFormatter: (address: string | undefined) => string,
  ): PairSession.Handler =>
  async (_data): Promise<HomeDevice[]> => {
    try {
      const {
        viewer: { homes },
      } = await startTransaction('GetHomes', 'API', () => tibber.getHomes());

      const devices: HomeDevice[] = homes
        .filter(filterPredicate)
        .map((home) => {
          const address = home.address?.address1;
          return {
            name: deviceNameFormatter(address),
            data: {
              ...home,
              t: tibber.getDefaultToken(),
            },
          };
        });

      devices.sort(sortByName);
      return devices;
    } catch (err) {
      noticeError(err as Error);
      log('Error in list device handler called from `onPair`', err);
      const statusCode = (err as ClientError).response?.status ?? 'unknown';
      throw new Error(`Failed to retrieve data: ${statusCode}`);
    }
  };

const sortByName = (a: { name: string }, b: { name: string }): number => {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
};
