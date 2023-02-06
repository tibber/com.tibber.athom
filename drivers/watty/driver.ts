import { Driver } from 'homey';
import PairSession from 'homey/lib/PairSession';
import { createListDeviceHandler } from '../../lib/helpers';
import { initiateOauth } from '../../lib/oauth';
import { TibberApi } from '../../lib/tibber';

class WattyDriver extends Driver {
  #tibber!: TibberApi;

  async onInit() {
    this.log('Tibber Watty driver has been initialized');
  }

  onPair(session: PairSession) {
    this.#tibber = new TibberApi(this.log, this.homey.settings);

    session.setHandler(
      'list_devices',
      createListDeviceHandler(
        this.log,
        this.#tibber,
        (home) => Boolean(home?.features?.realTimeConsumptionEnabled),
        formatDeviceName,
      ),
    );

    initiateOauth(this.homey, session, this.#tibber).catch(console.error);
  }
}

const formatDeviceName = (address: string | undefined) => `Watty ${address}`;

module.exports = WattyDriver;
