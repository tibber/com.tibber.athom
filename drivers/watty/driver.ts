import { Driver } from 'homey';
import PairSession from 'homey/lib/PairSession';
import _ from 'lodash';
import { EventEmitter } from 'stream';
import { createListDeviceHandler } from '../../lib/helpers';
import { initiateOauth } from '../../lib/oauth';
import { TibberApi } from '../../lib/tibber';

class WattyDriver extends Driver {
  #tibber!: TibberApi;

  async onInit() {
    this.log('Tibber Watty driver has been initialized');
  }

  async onPair(session: PairSession) {
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

    await initiateOauth(
      this.homey,
      session as unknown as EventEmitter, // this cast of `session` is due to `PairSession` missing `.emit()`, even though JS code examples call it
      this.#tibber,
    );
  }
}

const formatDeviceName = (address: string | undefined) => `Watty ${address}`;

module.exports = WattyDriver;
