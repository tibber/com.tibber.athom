import { App, env } from 'homey';
import ManagerCloud from 'homey/manager/cloud';
import http from 'http.min';
import { EventEmitter } from 'stream';
import { TibberApi } from './tibber';
import { noticeError, startTransaction } from './newrelic-transaction';

export const initiateOauth = async (
  { app, cloud }: { app: App; cloud: ManagerCloud },
  session: EventEmitter,
  tibber: TibberApi,
): Promise<void> => {
  const state = Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, '')
    .substring(0, 10);
  const redirectUrl = 'https://callback.athom.com/oauth2/callback/';
  const apiBaseUrl = 'https://thewall.tibber.com';
  const apiAuthUrl = `${apiBaseUrl}/connect/authorize?state=${state}&scope=tibber_graph&response_type=code&client_id=${env.CLIENT_ID}&redirect_uri=${redirectUrl}`;

  const myOAuth2Callback = await cloud.createOAuth2Callback(apiAuthUrl);
  myOAuth2Callback
    .on('url', (url) => {
      session.emit('url', url);
    })
    .on('code', async (code) => {
      try {
        const result = await startTransaction('ConnectOauth', 'Auth', () =>
          http.post({
            uri: `${apiBaseUrl}/connect/token`,
            form: {
              client_id: env.CLIENT_ID,
              client_secret: env.CLIENT_SECRET,
              grant_type: 'authorization_code',
              redirect_uri: redirectUrl,
              code,
            },
          }),
        );

        if (result.response.statusCode !== 200) {
          console.error('request failed', result.response);
          const error = new Error(
            `Request failed with code ${result.response.statusCode}`,
          );
          session.emit('error', error);
          noticeError(error);

          return app.error(
            'api -> failed to fetch tokens',
            result.response.statusCode,
          );
        }

        const params = JSON.parse(result.data);
        tibber.setDefaultToken(params.access_token);
        session.emit('authorized');
      } catch (err) {
        console.error('request failed', err);
        session.emit('error', new Error(`Error fetching tokens`));
        app.error('api -> error fetching tokens:', err);
        noticeError(err as Error);
      }

      return undefined;
    });
};
