const Homey = require('homey'),
    _ = require('lodash'),
    queries = require('./queries'),
    ws = require('ws'),
    ApolloBoost = require('apollo-client'),
    ApolloClient = ApolloBoost.default,
    { GraphQLClient } = require('graphql-request'),
    { WebSocketLink } = require("apollo-link-ws"),
    { InMemoryCache } = require("apollo-cache-inmemory"),
    newrelic = require('newrelic'),
    moment = require('moment-timezone');

module.exports = { tibber, getRandomDelay }

function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
}

function tibber(dependencies) {
    let { log, homeId, token } = dependencies;

    log(`Initialize Tibber client for home ${homeId} using token ${token}`);

    let _client = undefined;
    const host = 'https://api.tibber.com';
    const path = '/v1-beta/gql';
    function getClient() {
        if (!token)
            token = getDefaultToken();
        if (!token)
            throw new Error("Access token not set");

        if (!_client)
            _client = new GraphQLClient(`${host}${path}`, {
                timeout: 60000,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'User-Agent': 'Homey (Tibber App)'
                },
            });

        return _client;
    }

    async function getHomes() {
        let client = getClient();
        log('Get homes');
        return newrelic.startWebTransaction('Get homes', () => client.request(queries.getHomesQuery())
            .then(data => {
                return data;
            })
            .catch(e => {
                console.error(`${new Date()} Error while fetching home data`, e);
                throw e;
            }));
    }

    let priceInfoNextHours = [];
    async function getPriceInfoCached() {

        // Cache empty. Fetch immediately
        if (!priceInfoNextHours.length) {
            log(`No price infos cached. Fetch prices immediately.`);
            priceInfoNextHours = getPriceInfo();
            return priceInfoNextHours;
        }

        const lastPriceInfoDay = moment(_.last(priceInfoNextHours).startsAt).startOf('day');
        log(`last price info entry is for ${lastPriceInfoDay.format()}`);

        const now = moment();
        const today = moment().add(1, 'day').startOf('day');
        const tomorrow = moment().add(2, 'day').startOf('day');

        // Last cache entry too old. Fetch immediately
        if (lastPriceInfoDay < today) {
            log(`Last price info entry is before today. Re-fetch prices immediately.`);
            priceInfoNextHours = getPriceInfo();
            return priceInfoNextHours;
        }

        // Last cache entry is ok but there might be new prices available. Fetch after delay to avoid hitting the api at the same time
        const expectedPricePublishTime = today.add(13, 'hours');
        if (lastPriceInfoDay < tomorrow && now > expectedPricePublishTime) {
            const delay = getRandomDelay(0, 50 * 60);
            log(`Last price info entry is before tomorrow and current time is after 13:00. Schedule re-fetch prices after ${delay} seconds.`);
            setTimeout(async () => {
                priceInfoNextHours = await getPriceData()
            }, delay * 1000);
            return priceInfoNextHours;
        }

        // Last cache entry ok and no new prices available yet
        log(`Last price info entry is up-to-date`);
        return priceInfoNextHours;
    }

    async function getPriceInfo() {
        let client = getClient();
        log('Get prices');
        const data = await newrelic.startWebTransaction('Get prices', () => client.request(queries.getPriceQuery(homeId)))
            .catch(e => {
                console.error(`${new Date()} Error while fetching price data`, e);
                throw e;
            });
        const priceInfoToday = _.get(data, 'viewer.home.currentSubscription.priceInfo.today');
        const priceInfoTomorrow = _.get(data, 'viewer.home.currentSubscription.priceInfo.tomorrow');
        if(priceInfoToday && priceInfoTomorrow)
            priceInfoNextHours = priceInfoToday.concat(priceInfoTomorrow);
        else if (priceInfoToday)
            priceInfoNextHours = priceInfoToday;

        return priceInfoNextHours;
    }

    async function getConsumptionData(daysToFetch, hoursToFetch) {
        let client = getClient();
        log(`Get consumption for ${daysToFetch} days ${hoursToFetch} hours`);
        return newrelic.startWebTransaction('Get consumption', () => client.request(queries.getConsumptionQuery(homeId, daysToFetch, hoursToFetch)))
            .catch(e => {
                console.error(`${new Date()} Error while fetching consumption data`, e);
                throw e;
            });
    }

    async function sendPush(title, message) {
        log('Send push notification');
        let client = getClient();
        let push = queries.getPushMessage(title, message);
        return client.request(push)
            .then(result => {
                console.log(`${new Date()} Push notification sent`, result);
            })
            .catch(e => {
                console.error(`${new Date()} Error sending push notification`, e);
                throw e;
            });
    }

    function subscribeToLive(callback) {
        log('Subscribe to live');
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

    return {
        getHomes: getHomes,
        getPriceInfoCached: getPriceInfoCached,
        getConsumptionData: getConsumptionData,
        sendPush: sendPush,
        subscribeToLive: subscribeToLive,
        setDefaultToken: setDefaultToken,
        getDefaultToken: getDefaultToken
    };
}

