import PairSession from "homey/lib/PairSession";
import { Logger, TibberApi } from "./tibber";
import _ from 'lodash';

interface HomeFilterPredicate {
    (home: any): boolean;
}

export const createListDeviceHandler = (
    log: Logger,
    tibber: TibberApi,
    filterPredicate: HomeFilterPredicate,
    deviceNameFormatter: (address: string) => string
): PairSession.Handler =>
     async (data) => {
        try {
            const homes = await tibber.getHomes();

            // TODO: simplify
            return _.reject(_.map(_.get(homes, 'viewer.homes'), home => {
                if(!filterPredicate) return null;

                _.assign(home, { t: tibber.getDefaultToken() });
                let address = _.get(home, 'address.address1');
                return {
                    data: home,
                    name: deviceNameFormatter(address)
                };
            }), _.isNull)
            .sort(sortByName);
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
