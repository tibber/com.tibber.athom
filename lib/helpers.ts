import PairSession from 'homey/lib/PairSession';
import _ from 'lodash';
import { Home, Logger, TibberApi } from './tibber';

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
      } = await tibber.getHomes();

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
      log('Error in list device handler called from `onPair`', err);
      throw new Error('Failed to retrieve data.');
    }
  };

const sortByName = (a: { name: string }, b: { name: string }): number => {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
};
