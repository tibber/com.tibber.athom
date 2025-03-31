import { Driver, env } from 'homey';
import PairSession from 'homey/lib/PairSession';
import { createListDeviceHandler } from '../../lib/device-helpers';
import { initiateOauth } from '../../lib/oauth';
import { TibberApi } from '../../lib/tibber-api';

class HomeDriver extends Driver {
  #api!: TibberApi;

  async onInit() {
    this.log('Tibber Home driver has been initialized');
  }

  async onPair(session: PairSession) {
    this.#api = new TibberApi(this.log, this.homey.settings);

    session.setHandler('showView', async (view) => {
      if (view === 'loading') {
        if (env.ACCESS_TOKEN !== undefined) {
          // If access token is provided, don't show oAuth popup.
          await session.showView('list_devices');
        } else {
          await session.showView('login_oauth2');
        }
      }
    });

    session.setHandler(
      'list_devices',
      createListDeviceHandler(
        this.log,
        this.#api,
        (home) => home?.currentSubscription?.status === 'running',
        formatDeviceName,
      ),
    );

    initiateOauth(this.homey, session, this.#api).catch(console.error);
  }
}

const formatDeviceName = (address: string | undefined) => `${address}`;

module.exports = HomeDriver;
