import { Driver } from 'homey';
import PairSession from 'homey/lib/PairSession';
import { getDataApi } from '../../lib/data-api';
import { deviceName, isPulseCt } from '../../lib/data-api/device-kind';

class PulseCtDriver extends Driver {
  async onInit() {
    this.log('Tibber Pulse CT driver has been initialized');
  }

  async onPair(session: PairSession) {
    const { auth } = getDataApi(this.homey);
    session.setHandler('showView', async (view) => {
      if (view !== 'loading') return;
      // Without a client the login popup can't open; the device list step then says why
      if (auth.isLoggedIn() || !auth.hasClient())
        await session.showView('list_devices');
      else await session.showView('login_oauth2');
    });
    session.setHandler('list_devices', async () => {
      if (!auth.isLoggedIn() && !auth.hasClient()) {
        throw new Error(
          'This version of the app has no Tibber Data API client configured.',
        );
      }
      return this.#listDevices();
    });
    if (auth.hasClient()) await this.#startOAuth2(session);
  }

  async onRepair(session: PairSession) {
    await this.#startOAuth2(session);
  }

  /** Runs Tibber's login in Homey's OAuth2 popup and reports the result to the pairing session. */
  async #startOAuth2(session: PairSession) {
    const { auth } = getDataApi(this.homey);
    const callback = await this.homey.cloud.createOAuth2Callback(
      auth.startLogin(),
    );
    callback
      .on('url', (url: string) => {
        session.emit('url', url).catch((e) => this.error(e));
      })
      .on('code', async (code: string | Error) => {
        try {
          if (code instanceof Error) throw code;
          await auth.finishLogin(code);
          await session.emit('authorized', undefined);
        } catch (e) {
          this.error('Tibber login failed', e);
          await session.emit('error', e).catch((err) => this.error(err));
        }
      });
  }

  async #listDevices() {
    const { client } = getDataApi(this.homey);
    const homes = await client.listHomes();
    const perHome = await Promise.all(
      homes.map(async (home) => {
        const streamable = await client.listLiveDevices(home.id);
        // P1 and IR Pulses are left to the Pulse driver
        return streamable.filter(isPulseCt).map((device) => ({
          name: deviceName(device, homes.length > 1 ? home.name : undefined),
          data: { id: device.id, homeId: home.id },
        }));
      }),
    );
    const devices = perHome.flat();
    if (devices.length === 0) {
      throw new Error(
        'Tibber lists no Pulse CT that can stream. Check that it is paired and its Bridge is online.',
      );
    }
    return devices;
  }
}

module.exports = PulseCtDriver;
