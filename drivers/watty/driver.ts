import { Driver } from 'homey';
import PairSession from 'homey/lib/PairSession';
import { createListDeviceHandler } from '../../lib/device-helpers';
import { initiateOauth } from '../../lib/oauth';
import { TibberApi } from '../../lib/api';

class WattyDriver extends Driver {
  #api!: TibberApi;

  async onInit() {
    this.log('Tibber Watty driver has been initialized');
  }

  onPair(session: PairSession) {
    this.#api = new TibberApi(this.log, this.homey.settings);

    session.setHandler(
      'list_devices',
      createListDeviceHandler(
        this.log,
        this.#api,
        (home) => Boolean(home?.features?.realTimeConsumptionEnabled),
        formatDeviceName,
      ),
    );

    initiateOauth(this.homey, session, this.#api).catch(console.error);
  }
}

const formatDeviceName = (address: string | undefined) => `Watty ${address}`;

module.exports = WattyDriver;
