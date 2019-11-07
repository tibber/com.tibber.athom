const 	Homey 				= require('homey'),
        tibber              = require('./tibber'),
        http 			    = require('http.min');

module.exports = {
    initiateOauth: initiateOauth
};

function initiateOauth(socket) {
    let state = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
    const redirectUrl = 'https://callback.athom.com/oauth2/callback/';
    let apiBaseUrl = 'https://thewall.tibber.com';
    let apiAuthUrl = `${apiBaseUrl}/connect/authorize?state=${state}&scope=tibber_graph&response_type=code&client_id=${Homey.env.CLIENT_ID}&redirect_uri=${redirectUrl}`;

    let myOAuth2Callback = new Homey.CloudOAuth2Callback(apiAuthUrl);
    myOAuth2Callback
        .on('url', url => {
            socket.emit('url', url);
        })
        .on('code', async code => {
            try {
                const result = await http.post({
                    uri: `${apiBaseUrl}/connect/token`,
                    form: {
                        client_id: Homey.env.CLIENT_ID,
                        client_secret: Homey.env.CLIENT_SECRET,
                        grant_type: 'authorization_code',
                        redirect_uri: redirectUrl,
                        code: code,
                    },
                });

                if (result.response.statusCode !== 200) {
                    console.error('request failed', result.response);
                    socket.emit('error', new Error(`Request failed with code ${result.response.statusCode}`));
                    return Homey.app.error('api -> failed to fetch tokens', result.response.statusCode);
                }

                let params = JSON.parse(result.data);
                tibber.setDefaultToken(params.access_token);
                socket.emit('authorized');
            } catch (err) {
                console.error('request failed', err);
                socket.emit('error', new Error(`Error fetching tokens`));
                Homey.app.error('api -> error fetching tokens:', err);
            }
        })
        .generate()
        .catch( err => {
            console.error(err);
            socket.emit('error', err);
        });
}