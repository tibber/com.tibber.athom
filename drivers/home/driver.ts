import { Driver } from 'homey';
import PairSession from 'homey/lib/PairSession';
import { EventEmitter } from 'stream';
import { createListDeviceHandler } from '../../lib/helpers';
import { initiateOauth } from '../../lib/oauth';
import { TibberApi } from '../../lib/tibber';

class HomeDriver extends Driver {
  #tibber!: TibberApi;

  async onInit() {
    this.log('Tibber Home driver has been initialized');
  }

  onPair(session: PairSession) {
    this.#tibber = new TibberApi(this.log, this.homey.settings);

    session.setHandler(
      'list_devices',
      createListDeviceHandler(
        this.log,
        this.#tibber,
        (home) => home?.currentSubscription?.status === 'running',
        formatDeviceName,
      ),
    );

    initiateOauth(
      this.homey,
      session as unknown as EventEmitter, // this cast of `session` is due to `PairSession` missing `.emit()`, even though JS code examples call it
      this.#tibber,
    ).catch(console.error);
  }
}

const formatDeviceName = (address: string | undefined) => `${address}`;

module.exports = HomeDriver;
