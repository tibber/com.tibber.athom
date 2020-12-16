'use strict';

const   Homey               = require('homey'),
        _                   = require('lodash'),
        moment              = require('moment-timezone'),
        http                = require('http.min'),
        { tibber }          = require('../../lib/tibber');

class MyDevice extends Homey.Device {

    onInit() {
        this._tibber = tibber({
            log: this.log,
            homeId: this.getData().id,
            token: this.getData().t
        });

        this._deviceId = this.getData().id;
        this._throttle = this.getSetting('pulse_throttle') || 30;

        this._powerChangedTrigger = new Homey.FlowCardTriggerDevice('power_changed');
        this._powerChangedTrigger.register();

        this._consumptionChangedTrigger = new Homey.FlowCardTriggerDevice('consumption_changed');
        this._consumptionChangedTrigger.register();

        this._costChangedTrigger = new Homey.FlowCardTriggerDevice('cost_changed');
        this._costChangedTrigger.register();

        this._currentL1ChangedTrigger = new Homey.FlowCardTriggerDevice('current.L1_changed');
        this._currentL1ChangedTrigger.register();
        this._currentL2ChangedTrigger = new Homey.FlowCardTriggerDevice('current.L2_changed');
        this._currentL2ChangedTrigger.register();
        this._currentL3ChangedTrigger = new Homey.FlowCardTriggerDevice('current.L3_changed');
        this._currentL3ChangedTrigger.register();

        this._dailyConsumptionReportTrigger = new Homey.FlowCardTriggerDevice('daily_consumption_report');
        this._dailyConsumptionReportTrigger.register();

        this.log(`Tibber pulse device ${this.getName()} has been initialized (throttle: ${this._throttle})`);

        //Resubscribe if no data for 10 minutes
        this._resubscribeDebounce = _.debounce(this.subscribeToLive.bind(this), 10 * 60 * 1000);
        this.subscribeToLive();
    }

    onSettings(oldSettingsObj, newSettingsObj, changedKeysArr, callback) {
        this.log('Changing pulse settings');
        if (changedKeysArr.includes('pulse_throttle')) {
            this.log('Updated throttle value: ', newSettingsObj.pulse_throttle);
            this._throttle = Number(newSettingsObj.pulse_throttle) || 30;
        }
        if (changedKeysArr.includes('pulse_currency')) {
            this.log('Updated currency value: ', newSettingsObj.pulse_currency);
            this._currency = newSettingsObj.pulse_currency;
            this._cachedNordpoolPrice = null;
        }
        if (changedKeysArr.includes('pulse_area')) {
            this.log('Updated area value: ', newSettingsObj.pulse_area);
            this._area = newSettingsObj.pulse_area;
            this._cachedNordpoolPrice = null;
        }
        callback(null, true);
    }

    subscribeToLive() {
        this._resubscribeDebounce();
        if (this._wsSubsctiption && _.isFunction(this._wsSubsctiption.unsubscribe)) {
            try {
                this.log('Unsubscribing from previous connection');
                this._wsSubsctiption.unsubscribe();
            }
            catch (e) {
                this.log('Error unsubscribing from previous connection', e);
            }
        }

        this.log('Subscribing to live data for homeId', this._deviceId);
        this._wsSubsctiption = this._tibber.subscribeToLive(this.subscribeCallback.bind(this));
    }

    async subscribeCallback(result) {
        this._resubscribeDebounce();

        let power = _.get(result, 'data.liveMeasurement.power');
        //this.log(`Received data.liveMeasurement.power`, power);
        let powerProduction = _.get(result, 'data.liveMeasurement.powerProduction');
        //this.log(`Received data.liveMeasurement.powerProduction`, powerProduction);
        if (powerProduction)
            this._prevPowerProduction = powerProduction;

        if (this._prevUpdate && moment().diff(this._prevUpdate, 'seconds') < this._throttle)
            return;

        const measure_power = power || -powerProduction || -this._prevPowerProduction;
        this.log(`Set measure_power capability to`, measure_power);
        this.setCapabilityValue("measure_power", measure_power).catch(console.error);
        this._prevUpdate = moment();

        if (measure_power !== this._prevPower) {
            this._prevPower = measure_power;
            this.log(`Trigger power changed`, measure_power);
            this._powerChangedTrigger.trigger(this, { power: measure_power }).catch(console.error);
        }

        const currentL1 = _.get(result, 'data.liveMeasurement.currentL1');
        if (currentL1) this.setCapabilityValue("measure_current.L1", currentL1).catch(console.error);
        if (currentL1 !== this._prevCurrentL1) {
            this._prevCurrentL1 = currentL1;
            this.log(`Trigger current L1 changed`, currentL1);
            this._currentL1ChangedTrigger.trigger(this, { currentL1: currentL1 }).catch(console.error);
        }
        const currentL2 = _.get(result, 'data.liveMeasurement.currentL2');
        if (currentL2) this.setCapabilityValue("measure_current.L2", currentL2).catch(console.error);
        if (currentL2 !== this._prevCurrentL2) {
            this._prevCurrentL2 = currentL2;
            this.log(`Trigger current L2 changed`, currentL2);
            this._currentL2ChangedTrigger.trigger(this, { currentL2: currentL2 }).catch(console.error);
        }
        const currentL3 = _.get(result, 'data.liveMeasurement.currentL3');
        if (currentL3) this.setCapabilityValue("measure_current.L3", currentL3).catch(console.error);
        if (currentL3 !== this._prevCurrentL3) {
            this._prevCurrentL3 = currentL3;
            this.log(`Trigger current L3 changed`, currentL3);
            this._currentL3ChangedTrigger.trigger(this, { currentL3: currentL3 }).catch(console.error);
        }

        const consumption = _.get(result, 'data.liveMeasurement.accumulatedConsumption');
        if (consumption && _.isNumber(consumption)) {
            const fixedConsumtion = +consumption.toFixed(2);
            if (fixedConsumtion !== this._prevConsumption) {
                if (fixedConsumtion < this._prevConsumption) //Consumption has been reset
                {
                    this.log('Triggering daily consumption report');
                    this._dailyConsumptionReportTrigger.trigger(this, { consumption: this._prevConsumption, cost: this._prevCost }).catch(console.error)
                }

                this._prevConsumption = fixedConsumtion;
                this.setCapabilityValue("meter_power", fixedConsumtion).catch(console.error);
                this._consumptionChangedTrigger.trigger(this, { consumption: fixedConsumtion }).catch(console.error);
            }
        }

        let cost = _.get(result, 'data.liveMeasurement.accumulatedCost');
        if (!cost) {
            try {
                const now = moment();
                if (!this._cachedNordpoolPrice || this._cachedNordpoolPrice.hour !== now.hour()) {
                    const area = this._area || 'Oslo';
                    const currency = this._currency || 'NOK';
                    this.log(`Using nordpool prices. Currency: ${currency} - Area: ${area}`);
                    const result = await http.json(`https://www.nordpoolgroup.com/api/marketdata/page/10?currency=${currency},${currency},${currency},${currency}&endDate=${moment().format("DD-MM-YYYY")}`);
                    const areaCurrentPrice = _(_.get(result, 'data.Rows'))
                        .filter(row => !row.IsExtraRow && moment.tz(row.StartTime, 'Europe/Oslo').isBefore(now) && moment.tz(row.EndTime, 'Europe/Oslo').isAfter(now))
                        .map(row => row.Columns)
                        .first()
                        .find(a => a.Name === area);

                    if (areaCurrentPrice) {
                        let currentPrice = Number(areaCurrentPrice.Value.replace(',', '.').trim()) / 1000;
                        this._cachedNordpoolPrice = { hour: now.hour(), price: currentPrice };
                        this.log(`Found price for ${now.format()} for area ${area} ${currentPrice}`);
                    }

                }
                if (_.isNumber(this._cachedNordpoolPrice.price))
                    cost = this._cachedNordpoolPrice.price * consumption;
            }
            catch (e) {
                console.error('Error fetching prices from nordpool', e);
            }
        }

        if (cost && _.isNumber(cost)) {
            const fixedCost = +cost.toFixed(2);
            if (fixedCost !== this._prevCost) {
                this._prevCost = fixedCost;
                this.setCapabilityValue("accumulatedCost", fixedCost).catch(console.error);
                this._costChangedTrigger.trigger(this, { cost: fixedCost }).catch(console.error);
            }
        }
    }

    onDeleted() {
        if (this._wsSubsctiption && _.isFunction(this._wsSubsctiption.unsubscribe)) {
            try {
                this.log('Unsubscribing from previous connection');
                this._wsSubsctiption.unsubscribe();
                this._resubscribeDebounce.cancel();
            }
            catch (e) {
                this.log('Error unsubscribing from previous connection', e);
            }
        }
    };
}

module.exports = MyDevice;