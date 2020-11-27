const Homey = require('homey'),
    queries = require('./queries'),
    ws = require('ws'),
    ApolloBoost = require('apollo-client'),
    ApolloClient = ApolloBoost.default,
    { GraphQLClient } = require('graphql-request'),
    { WebSocketLink } = require("apollo-link-ws"),
    { InMemoryCache } = require("apollo-cache-inmemory"),
    newrelic = require('newrelic');

module.exports = {
    getHomes: getHomes,
    getData: getData,
    sendPush: sendPush,
    subscribeToLive: subscribeToLive,
    setDefaultToken: setDefaultToken,
    getDefaultToken: getDefaultToken
};

let _clients = [];
const host = 'https://api.tibber.com';
const path = '/v1-beta/gql';
function getClient(token) {
    if (!token)
        token = getDefaultToken();
    if (!token)
        throw new Error("Access token not set");

    if (!_clients[token])
        _clients[token] = new GraphQLClient(`${host}${path}`, {
            timeout: 60000,
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'Homey (Tibber App)'
            },
        });

    return _clients[token];
}

async function getHomes(token) {
    let client = getClient(token);
    return newrelic.startWebTransaction('Get homes', () => client.request(queries.getHomesQuery())
        .then(data => {
            return data;
        })
        .catch(e => {
            console.error(`${new Date()} Error while fetching home data`, e);
        }));
}

async function getData(token, homeId) {
    let client = getClient(token);
    return newrelic.startWebTransaction('Get consumption', () => client.request(queries.getConsumptionQuery(homeId)))
        .then(data => {
            return data;
        })
        .catch(e => {
            console.error(`${new Date()} Error while fetching consumption data`, e);
        });
}

async function sendPush(token, title, message) {
    let client = getClient(token);
    let push = queries.getPushMessage(title, message);
    return client.request(push)
        .then(result => {
            console.log(`${new Date()} Push notification sent`, result);
        })
        .catch(console.error);
}

function subscribeToLive(token, homeId, callback) {
    if (!token)
        token = getDefaultToken();
    if (!token)
        throw new Error("Access token not set");

    const wsLink = new WebSocketLink({
        uri: 'wss://api.tibber.com/v1-beta/gql/subscriptions',
        options: {
            reconnect: false,
            connectionParams: {
                token: token,
            }
        },
        webSocketImpl: ws
    });

    const wsClient = new ApolloClient({
        link: wsLink,
        cache: new InMemoryCache()
    });

    return wsClient.subscribe({
        query: queries.getSubscriptionQuery(homeId),
        variables: {}
    }).subscribe(callback, console.error);
}

function setDefaultToken(token) {
    Homey.ManagerSettings.set('token', token);
}

function getDefaultToken() {
    return Homey.ManagerSettings.get('token');
}