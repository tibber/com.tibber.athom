import { App, env } from 'homey';
import ManagerCloud from 'homey/manager/cloud';
import http from 'http.min';
import { EventEmitter } from 'stream';
import { TibberApi } from './tibber';

// export interface Socket {
//     // EventEmitter returns `boolean`, but no idea here
//     emit: (eventName: string, ...args: any[]) => void;
//     // EventEmitter returns `this`, but no idea here
//     on: (eventName: string, listener: (...args: any[]) => void) => void;
// };

export const initiateOauth = async (
    { app, cloud }: { app: App, cloud: ManagerCloud },
    // the PairSession interface is missing .emit() even though JS code examples call that
    session: EventEmitter,
    tibber: TibberApi) => {
    let state = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
    const redirectUrl = 'https://callback.athom.com/oauth2/callback/';
    let apiBaseUrl = 'https://thewall.tibber.com';
    let apiAuthUrl = `${apiBaseUrl}/connect/authorize?state=${state}&scope=tibber_graph&response_type=code&client_id=${env.CLIENT_ID}&redirect_uri=${redirectUrl}`;

    let myOAuth2Callback = await cloud.createOAuth2Callback(apiAuthUrl);//  new Homey.CloudOAuth2Callback(apiAuthUrl);
    myOAuth2Callback
        .on('url', url => {
            session.emit('url', url);
        })
        .on('code', async code => {
            try {
                const result = await http.post({
                    uri: `${apiBaseUrl}/connect/token`,
                    form: {
                        client_id: env.CLIENT_ID,
                        client_secret: env.CLIENT_SECRET,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUrl,
                        code: code,
                    },
                });

                if (result.response.statusCode !== 200) {
                    console.error('request failed', result.response);
                    session.emit('error', new Error(`Request failed with code ${result.response.statusCode}`));
                    return app.error('api -> failed to fetch tokens', result.response.statusCode);
                }

                let params = JSON.parse(result.data);
                tibber.setDefaultToken(params.access_token);
                session.emit('authorized');
            } catch (err) {
                console.error('request failed', err);
                session.emit('error', new Error(`Error fetching tokens`));
                app.error('api -> error fetching tokens:', err);
            }
        // })
        // .generate()
        // .catch( err => {
        //     console.error(err);
        //     socket.emit('error', err);
        });
}