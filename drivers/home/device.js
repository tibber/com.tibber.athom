'use strict';

const   Homey               = require('homey'),
        _                   = require('lodash'),
        http                = require('http.min'),
        moment				= require('moment-timezone'),
        Promise             = require('bluebird'),
        { tibber, getRandomDelay } = require('../../lib/tibber'),
        newrelic = require('newrelic');

class MyDevice extends Homey.Device {

	async onInit() {

        this._tibber = tibber({
            log: this.log,
            homeId: this.getData().id,
            token: this.getData().t
        });

        if(!this.getData().address)
            return this.setUnavailable("You will need to remove and add this home as new device");

        this._deviceLabel = this.getName();
        this._insightId = this._deviceLabel.replace(/[^a-z0-9]/ig,'_').toLowerCase();
        this._lastPrice = undefined;
        this._lastTemperature = undefined;
        this._location = { lat:this.getData().address.latitude, lon:this.getData().address.longitude };

        this._priceChangedTrigger = new Homey.FlowCardTriggerDevice('price_changed');
        this._priceChangedTrigger.register();

        this._temperatureChangedTrigger = new Homey.FlowCardTriggerDevice('temperature_changed');
        this._temperatureChangedTrigger.register();

        this._consumptionReportTrigger = new Homey.FlowCardTriggerDevice('consumption_report');
        this._consumptionReportTrigger.register();

        this._priceBelowAvgTrigger = new Homey.FlowCardTriggerDevice('price_below_avg');
        this._priceBelowAvgTrigger
            .register()
            .registerRunListener(this._priceAvgComparer.bind(this));

        this._priceAboveAvgTrigger = new Homey.FlowCardTriggerDevice('price_above_avg');
        this._priceAboveAvgTrigger
            .register()
            .registerRunListener(this._priceAvgComparer.bind(this));

        this._priceBelowAvgTodayTrigger = new Homey.FlowCardTriggerDevice('price_below_avg_today');
        this._priceBelowAvgTodayTrigger
            .register()
            .registerRunListener(this._priceAvgComparer.bind(this));

        this._priceAboveAvgTodayTrigger = new Homey.FlowCardTriggerDevice('price_above_avg_today');
        this._priceAboveAvgTodayTrigger
            .register()
            .registerRunListener(this._priceAvgComparer.bind(this));

        this._priceAtLowestTrigger = new Homey.FlowCardTriggerDevice('price_at_lowest');
        this._priceAtLowestTrigger
            .register()
            .registerRunListener(this._priceMinMaxComparer.bind(this));

        this._priceAtHighestTrigger = new Homey.FlowCardTriggerDevice('price_at_highest');
        this._priceAtHighestTrigger
            .register()
            .registerRunListener(this._priceMinMaxComparer.bind(this));

        this._priceAtLowestTodayTrigger = new Homey.FlowCardTriggerDevice('price_at_lowest_today');
        this._priceAtLowestTodayTrigger.register(); //Cannot use registerRunListener as the card have no arguments

        this._priceAtHighestTodayTrigger = new Homey.FlowCardTriggerDevice('price_at_highest_today');
        this._priceAtHighestTodayTrigger.register(); //Cannot use registerRunListener as the card have no arguments

        this._priceAmongLowestTrigger = new Homey.FlowCardTriggerDevice('price_among_lowest_today');
        this._priceAmongLowestTrigger
            .register()
            .registerRunListener(this._priceMinMaxComparer.bind(this));

        this._priceAmongHighestTrigger = new Homey.FlowCardTriggerDevice('price_among_highest_today');
        this._priceAmongHighestTrigger
            .register()
            .registerRunListener(this._priceMinMaxComparer.bind(this));

        this._currentPriceBelowCondition = new Homey.FlowCardCondition('current_price_below');
        this._currentPriceBelowCondition
            .register()
            .registerRunListener(args => args.price > _.get(this._lastPrice, 'total'));

        this._currentPriceBelowAvgCondition = new Homey.FlowCardCondition('cond_price_below_avg');
        this._currentPriceBelowAvgCondition
            .register()
            .registerRunListener(args => this._priceAvgComparer(args, { below: true }));

        this._currentPriceAboveAvgCondition = new Homey.FlowCardCondition('cond_price_above_avg');
        this._currentPriceAboveAvgCondition
            .register()
            .registerRunListener(args => this._priceAvgComparer(args, { below: false }));

        this._currentPriceBelowAvgTodayCondition = new Homey.FlowCardCondition('cond_price_below_avg_today');
        this._currentPriceBelowAvgTodayCondition
            .register()
            .registerRunListener(args => this._priceAvgComparer(args, { below: true }));

        this._currentPriceAboveAvgTodayCondition = new Homey.FlowCardCondition('cond_price_above_avg_today');
        this._currentPriceAboveAvgTodayCondition
            .register()
            .registerRunListener(args => this._priceAvgComparer(args, { below: false }));

        this._currentPriceAtLowestCondition = new Homey.FlowCardCondition('cond_price_at_lowest');
        this._currentPriceAtLowestCondition
            .register()
            .registerRunListener(args => this._priceMinMaxComparer(args, { lowest: true }));

        this._currentPriceAtHighestCondition = new Homey.FlowCardCondition('cond_price_at_highest');
        this._currentPriceAtHighestCondition
            .register()
            .registerRunListener(args => this._priceMinMaxComparer(args, { lowest: false }));

        this._currentPriceAtLowestTodayCondition = new Homey.FlowCardCondition('cond_price_at_lowest_today');
        this._currentPriceAtLowestTodayCondition
            .register()
            .registerRunListener(args => this._priceMinMaxComparer(args, { lowest: true }));

        this._currentPriceAtHighestTodayCondition = new Homey.FlowCardCondition('cond_price_at_highest_today');
        this._currentPriceAtHighestTodayCondition
            .register()
            .registerRunListener(args => this._priceMinMaxComparer(args, { lowest: false }));

        this._currentPriceAmongLowestTodayCondition = new Homey.FlowCardCondition('cond_price_among_lowest_today');
        this._currentPriceAmongLowestTodayCondition
            .register()
            .registerRunListener(args => this._priceMinMaxComparer(args, { lowest: true }));

        this._currentPriceAmongHighestTodayCondition = new Homey.FlowCardCondition('cond_price_among_highest_today');
        this._currentPriceAmongHighestTodayCondition
            .register()
            .registerRunListener(args => this._priceMinMaxComparer(args, { lowest: false }));

        this._outdoorTemperatureBelowCondition = new Homey.FlowCardCondition('temperature_below');
        this._outdoorTemperatureBelowCondition
            .register()
            .registerRunListener(args => args.temperature > this._lastTemperature);

        this._sendPushNotificationAction = new Homey.FlowCardAction('sendPushNotification');
        this._sendPushNotificationAction
            .register()
            .registerRunListener(args => this._tibber.sendPush(args.title, args.message));

        if (!this.hasCapability('price_level'))
            await this.addCapability('price_level');

        this.log(`Tibber home device ${this.getName()} has been initialized`);
        return this.updateData();
	}

	onDeleted() {
	    this.log('Device deleted:', this._deviceLabel);

        Homey.ManagerSettings.set(`${this._insightId}_lastLoggedDailyConsumption`, undefined);
        Homey.ManagerSettings.set(`${this._insightId}_lastLoggerHourlyConsumption`, undefined);

        return Homey.app.cleanupLogs(this._insightId);
    }

	async getTemperature() {
	    try {
            this.log(`Fetching temperature with api key ${Homey.env.DS_API_KEY} for coordinates ${this._location.lat},${this._location.lon}`);
            let temperature;
            try
            {
                const forecast = await newrelic.startWebTransaction('Get temperature', () => http.json(`https://api.darksky.net/forecast/${Homey.env.DS_API_KEY}/${this._location.lat},${this._location.lon}?units=si`));
                temperature = _.get(forecast, 'currently.temperature');
                this.log(`Fetched temperature ${temperature}`);
            }
            catch (error)
            {
                this.log(`Error fetching temperature ${JSON.stringify(error)}`);
            }

            if(temperature && temperature !== this._lastTemperature)
            {
                this._lastTemperature = temperature;
                this.setCapabilityValue('measure_temperature', temperature).catch(console.error);

                this.log('Triggering temperature_changed', temperature);
                this._temperatureChangedTrigger.trigger(this, temperature);

                let temperatureLogger = await this._createGetLog(`${this._insightId}_temperature`, {
                    label: `${this.getLoggerPrefix()}Outdoor temperature`,
                    type: 'number',
                    decimals: true
                });
                temperatureLogger.createEntry(temperature, new Date()).catch(console.error);
            }
        }
        catch (e) {
            console.error(`Error fetching weather forecast (${this._location.lat},${this._location.lon})`, e);
        }
    }

    isConsumptionReportEnabled() {
        return this.getSetting('enable_consumption_report') || false;
    }

    async updateData() {
        try {
            this.log(`Begin update`);

            // Fetch and update price triggers
            const priceInfoNextHours = await this._tibber.getPriceInfoCached();
            this.onPriceData(priceInfoNextHours);

            // Fetch and update temperature
            await this.getTemperature();

            // Fetch and update consumption report if enabled
            if (this.isConsumptionReportEnabled()) {
                this.log(`Consumption report enabled. Begin update`);
                const now = moment();
                const lastLoggedDailyConsumption = this.getLastLoggedDailyConsumption();
                let daysToFetch = 14;
                if (lastLoggedDailyConsumption) {
                    const durationSinceLastDailyConsumption = moment.duration(now.diff(moment(lastLoggedDailyConsumption)));
                    daysToFetch = Math.floor(durationSinceLastDailyConsumption.asDays());
                }

                const lastLoggedHourlyConsumption = this.getLastLoggedHourlyConsumption();
                let hoursToFetch = 200;
                if (lastLoggedHourlyConsumption) {
                    var durationSinceLastHourlyConsumption = moment.duration(now.diff(moment(lastLoggedHourlyConsumption)));
                    hoursToFetch = Math.floor(durationSinceLastHourlyConsumption.asHours());
                }

                this.log(`Last logged daily consumption at ${lastLoggedDailyConsumption} hourly consumption at ${lastLoggedHourlyConsumption}. Fetch ${daysToFetch} days ${hoursToFetch} hours`);

                if (!lastLoggedDailyConsumption || !lastLoggedHourlyConsumption) {
                    const consumptionData = await this._tibber.getConsumptionData(daysToFetch, hoursToFetch);
                    await this.onConsumptionData(consumptionData);
                }
                else if (!hoursToFetch && !daysToFetch) {
                    this.log(`Consumption data up to date. Skip fetch.`);
                }
                else {
                    const delay = getRandomDelay(0, 59 * 60);
                    this.log(`Schedule consumption fetch for ${daysToFetch} days ${hoursToFetch} hours after ${delay} seconds.`);
                    setTimeout(async () => {
                        const consumptionData = await this._tibber.getConsumptionData(daysToFetch, hoursToFetch);
                        await this.onConsumptionData(consumptionData);
                    }, delay * 1000);
                }
            }

            const nextHour = moment().add(1, 'hour').startOf('hour');
            this.log(`Next time to run update is at ${nextHour.format()}`);
            const delay = moment.duration(nextHour.diff(moment()));
            this.scheduleUpdate(delay.asSeconds());

            this.log(`End update`);
        }
        catch(e) {
            this.log('Error fetching data', e);

            const errorCode = _.get(e, 'response.errors[0].extensions.code');
            this.log('Received error code', errorCode);
            if (errorCode == 'HOME_NOT_FOUND') {
                this.log(`Home with id ${this.getData().id} not found. Set device unavailable`);
                await this.setUnavailable('Tibber home with specified id not found. Please re-add device.');
                return;
            }

            //Try again after a delay
            const delay = getRandomDelay(0, 5 * 60);
            this.scheduleUpdate(delay);
        }
    }

    scheduleUpdate(seconds) {
	    this.log(`Scheduling update again in ${seconds} seconds`);
        setTimeout(this.updateData.bind(this), seconds * 1000);
    }

    getLoggerPrefix() {
        return this.getDriver().getDevices().length > 1 ? (`${this._deviceLabel} `) : '';
    }

    async onPriceData(priceInfoNextHours) {
        const currentHour = moment().startOf('hour');
        const priceInfoCurrent = _.find(priceInfoNextHours, (p) => currentHour.isSame(moment(p.startsAt)))
        if (!priceInfoCurrent) {
            this.log(`Error finding current price info for ${currentHour.format()}. Abort.`, priceInfoNextHours);
            return;
        }

        if(_.get(priceInfoCurrent, 'startsAt') !== _.get(this._lastPrice, 'startsAt')) {
            this._lastPrice = priceInfoCurrent;
            this._priceInfoNextHours = priceInfoNextHours;

            if(priceInfoCurrent.total !== null) {
                this.setCapabilityValue("price_total", priceInfoCurrent.total).catch(console.error);
                this.setCapabilityValue("price_level", priceInfoCurrent.level).catch(console.error);

                this._priceChangedTrigger.trigger(this, priceInfoCurrent);
                this.log('Triggering price_changed', priceInfoCurrent);

                let priceLogger = await this._createGetLog(`${this._insightId}_price`, {
                    label: `${this.getLoggerPrefix()}Current price`,
                    type: 'number',
                    decimals: true
                });
                priceLogger.createEntry(priceInfoCurrent.total, moment(priceInfoCurrent.startsAt).toDate()).catch(console.error);

                if(priceInfoNextHours) {
                    this._priceBelowAvgTrigger.trigger(this, null, { below: true }).catch(console.error);
                    this._priceBelowAvgTodayTrigger.trigger(this, null, { below: true }).catch(console.error);
                    this._priceAboveAvgTrigger.trigger(this, null, { below: false }).catch(console.error);
                    this._priceAboveAvgTodayTrigger.trigger(this, null, { below: false }).catch(console.error);
                    this._priceAtLowestTrigger.trigger(this, null, { lowest: true }).catch(console.error);
                    this._priceAtHighestTrigger.trigger(this, null, { lowest: false }).catch(console.error);
                    this._priceAmongLowestTrigger.trigger(this, null, { lowest: true }).catch(console.error);
                    this._priceAmongHighestTrigger.trigger(this, null, { lowest: true }).catch(console.error);

                    if(this._priceMinMaxComparer({}, { lowest: true }))
                        this._priceAtLowestTodayTrigger.trigger(this, null, { lowest: true }).catch(console.error);
                    if(this._priceMinMaxComparer({}, { lowest: false }))
                        this._priceAtHighestTodayTrigger.trigger(this, null, { lowest: false }).catch(console.error);
                }
            }
        }
    }

    getLastLoggedDailyConsumption() {
        return Homey.ManagerSettings.get(`${this._insightId}_lastLoggedDailyConsumption`);
    }

    setLastLoggedDailyConsumption(value) {
        Homey.ManagerSettings.set(`${this._insightId}_lastLoggedDailyConsumption`, value);
    }

    getLastLoggedHourlyConsumption() {
        return Homey.ManagerSettings.get(`${this._insightId}_lastLoggerHourlyConsumption`);
    }

    setLastLoggedHourlyConsumption(value) {
        Homey.ManagerSettings.set(`${this._insightId}_lastLoggerHourlyConsumption`, value);
    }

    async onConsumptionData(data) {

		try {
            const lastLoggedDailyConsumption = this.getLastLoggedDailyConsumption();
            const consumptionsSinceLastReport = [];
            const dailyConsumptions = _.get(data, 'viewer.home.daily.nodes') || [];
            await Promise.mapSeries(dailyConsumptions, async dailyConsumption => {
                if (dailyConsumption.consumption !== null) {
                    if (lastLoggedDailyConsumption && moment(dailyConsumption.to) <= moment(lastLoggedDailyConsumption))
                        return;

                    consumptionsSinceLastReport.push(dailyConsumption);
                    this.setLastLoggedDailyConsumption(dailyConsumption.to);

                    this.log('Got daily consumption', dailyConsumption);
                    let consumptionLogger = await this._createGetLog(`${this._insightId}_dailyConsumption`, {
                        label: `${this.getLoggerPrefix()}Daily consumption`,
                        type: 'number',
                        decimals: true
                    });

                    consumptionLogger.createEntry(dailyConsumption.consumption, moment(dailyConsumption.to).toDate()).catch(console.error);

                    let costLogger = await this._createGetLog(`${this._insightId}_dailyCost`, {
                        label: `${this.getLoggerPrefix()}Daily total cost`,
                        type: 'number',
                        decimals: true
                    });
                    costLogger.createEntry(dailyConsumption.totalCost, moment(dailyConsumption.to).toDate()).catch(console.error);
                }
            });

            if (consumptionsSinceLastReport.length > 0)
                this._consumptionReportTrigger.trigger(this, {
                    consumption: +_.sumBy(consumptionsSinceLastReport, 'consumption').toFixed(2),
                    totalCost: +_.sumBy(consumptionsSinceLastReport, 'totalCost').toFixed(2),
                    unitCost: +_.sumBy(consumptionsSinceLastReport, 'unitCost').toFixed(2),
                    unitPrice: +_.meanBy(consumptionsSinceLastReport, 'unitPrice').toFixed(2)
                });
        }
        catch (e) {
		    console.error('Error logging daily consumption', e);
        }

        try {
            const lastLoggedHourlyConsumption = this.getLastLoggedHourlyConsumption();
            const hourlyConsumptions = _.get(data, 'viewer.home.hourly.nodes') || [];
            await Promise.mapSeries(hourlyConsumptions, async hourlyConsumption => {
                if (hourlyConsumption.consumption !== null) {
                    if (lastLoggedHourlyConsumption && moment(hourlyConsumption.to) <= moment(lastLoggedHourlyConsumption))
                        return;

                    this.setLastLoggedHourlyConsumption(hourlyConsumption.to);

                    this.log('Got hourly consumption', hourlyConsumption);
                    let consumptionLogger = await this._createGetLog(`${this._insightId}hourlyConsumption`, {
                        label: `${this.getLoggerPrefix()}Hourly consumption`,
                        type: 'number',
                        decimals: true
                    });

                    consumptionLogger.createEntry(hourlyConsumption.consumption, moment(hourlyConsumption.to).toDate()).catch(console.error);

                    let costLogger = await this._createGetLog(`${this._insightId}_hourlyCost`, {
                        label: `${this.getLoggerPrefix()}Hourly total cost`,
                        type: 'number',
                        decimals: true
                    });
                    costLogger.createEntry(hourlyConsumption.totalCost, moment(hourlyConsumption.to).toDate()).catch(console.error);
                }
            });
        }
        catch (e) {
            console.error('Error logging hourly consumption', e);
        }
    }

    _priceAvgComparer(args, state) {
        if (args.hours === 0)
            return false;

        const now = moment();
        let avgPriceNextHours;
        if(args.hours)
            avgPriceNextHours = _(this._priceInfoNextHours)
                                    .filter(p => args.hours > 0 ? moment(p.startsAt).isAfter(now) : moment(p.startsAt).isBefore(now))
                                    .take(Math.abs(args.hours))
                                    .meanBy(x => x.total);
        else
            avgPriceNextHours = _(this._priceInfoNextHours)
                                    .filter(p => moment(p.startsAt).add(30, 'minutes').isSame(now, 'day'))
                                    .meanBy(x => x.total);

        if (avgPriceNextHours.length == 0) {
            this.log(`Cannot determine condition. No prices for next hours available.`);
            return false;
        }

        if (!this._lastPrice)
            return false;

        let diffAvgCurrent = (this._lastPrice.total - avgPriceNextHours) / avgPriceNextHours * 100;
        if (state.below)
            diffAvgCurrent = diffAvgCurrent * -1;

        this.log(`${this._lastPrice.total.toFixed(2)} is ${diffAvgCurrent.toFixed(2)}% ${state.below ? 'below' : 'above'} avg (${avgPriceNextHours.toFixed(2)}) ${args.hours ? 'next ' + args.hours + ' hours' : 'today'}. Condition of min ${args.percentage} percentage met = ${diffAvgCurrent > args.percentage}`);
        return diffAvgCurrent > args.percentage;
    }

    _priceMinMaxComparer(args, state) {
        if (args.hours === 0 || args.ranked_hours === 0)
            return false;

        const now = moment();
        let pricesNextHours;
        if(args.hours)
            pricesNextHours = _(this._priceInfoNextHours)
                .filter(p => args.hours > 0 ? moment(p.startsAt).isAfter(now) : moment(p.startsAt).isBefore(now))
                .take(Math.abs(args.hours))
                .value();
        else
            pricesNextHours = _(this._priceInfoNextHours)
                .filter(p => moment(p.startsAt).add(30, 'minutes').isSame(now, 'day'))
                .value();

        if (pricesNextHours.length == 0) {
            this.log(`Cannot determine condition. No prices for next hours available.`);
            return false;
        }

        let conditionMet;
        if(args.ranked_hours) {
            sortedHours = _.sortBy(pricesNextHours, ['total']);
            currentHourRank = _.findIndex(pricesNextHours, ['startsAt', this._lastPrice.startsAt]);
            if (currentHourRank < 0) {
                this.log(`Could not find the current hour rank among today's hours`);
                return false
            }

            conditionMet = state.lowest ? currentHourRank < args.ranked_hours
                : currentHourRank >= sortedHours.length - args.ranked_hours

                this.log(`${this._lastPrice.total.toFixed(2)} is among the ${state.lowest ? 'lowest' : 'highest'} ${args.ranked_hours} hours today = ${conditionMet}`);
        } else {
            toCompare = state.lowest ? _.minBy(pricesNextHours, 'total').total
                : _.maxBy(pricesNextHours, 'total').total;
    
            conditionMet = state.lowest ? this._lastPrice.total <= toCompare
                : this._lastPrice.total >= toCompare;

            this.log(`${this._lastPrice.total.toFixed(2)} is ${state.lowest ? 'lower than the lowest' : 'higher than the highest'} (${toCompare}) ${args.hours ? 'among the next ' + args.hours + ' hours' : 'today'} = ${conditionMet}`);
        }

        return conditionMet;
    }

    async _createGetLog(name, options) {
	    try {
	        let log = await Homey.ManagerInsights.getLog(name);
	        return log;
        }
        catch(e) {
            console.error('Could not find log ' + name + '. Creating new log.', e);
	        if(!options.title)
	            options.title = options.label; //for 2.0 support

             return Homey.ManagerInsights.createLog(name, options);
        }
    }
}

module.exports = MyDevice;