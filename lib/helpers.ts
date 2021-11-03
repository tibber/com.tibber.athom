import PairSession from "homey/lib/PairSession";
import { Home, Logger, TibberApi } from "./tibber";
import _ from 'lodash';
import { inspect } from "util";

export interface HomeFilterPredicate {
    (home: Home): boolean;
}

export interface HomeDevice {
    name: string;
    data: Home & {
        t: string;
    };
}

export const createListDeviceHandler = (
    log: Logger,
    tibber: TibberApi,
    filterPredicate: HomeFilterPredicate,
    deviceNameFormatter: (address: string | undefined) => string
): PairSession.Handler =>
     async (_data): Promise<HomeDevice[]> => {
        try {
            const { viewer: { homes }} = await tibber.getHomes();

            const devices: HomeDevice[] = [];
            for (const home of homes) {
                if (!filterPredicate(home)) continue;

                let address = home.address?.address1;
                devices.push({
                    name: deviceNameFormatter(address),
                    data: {
                        ...home,
                        t: tibber.getDefaultToken()
                    },
                });
            }
            devices.sort(sortByName);
            return devices;
        }
        catch (err) {
            log('Error in list device handler called from `onPair`', err);
            throw new Error("Failed to retrieve data.");
        }
};

// TODO: `any` because TS doesn't understand that these are cannot be `null` here
const sortByName = (a: any, b: any): number => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
}
