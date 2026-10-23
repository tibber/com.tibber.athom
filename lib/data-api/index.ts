import { env } from 'homey';
import type Homey from 'homey/lib/Homey';
import { DataApiAuth } from './auth';
import { DataApiClient } from './client';
import { LiveStreams } from './live-streams';

export interface DataApi {
  auth: DataApiAuth;
  client: DataApiClient;
  liveStreams: LiveStreams;
}

const instances = new WeakMap<Homey, DataApi>();

/**
 * The app's Tibber Data API login, REST client and live streams, created on first use and shared by
 * every driver and device, since the API allows one live stream per home.
 */
export const getDataApi = (homey: Homey): DataApi => {
  let dataApi = instances.get(homey);
  if (!dataApi) {
    const auth = new DataApiAuth({
      settings: homey.settings,
      clientId: env.DATA_API_CLIENT_ID,
      clientSecret: env.DATA_API_CLIENT_SECRET,
    });
    const liveStreams = new LiveStreams({
      auth,
      log: (message) => homey.app.log(message),
      timers: {
        setTimeout: (callback, ms) => homey.setTimeout(callback, ms),
        clearTimeout: (timer) => homey.clearTimeout(timer),
      },
    });
    // A new login can bring back devices that were unavailable for want of one
    auth.on('login', () => liveStreams.reconnectAll());
    dataApi = { auth, client: new DataApiClient({ auth }), liveStreams };
    instances.set(homey, dataApi);
  }
  return dataApi;
};
