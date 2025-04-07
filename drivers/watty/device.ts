import { Device, FlowCardTriggerDevice } from 'homey';
import moment from 'moment-timezone';
import http from 'http.min';
import { Subscription } from 'zen-observable-ts';
import _ from 'lodash';
import { LiveMeasurement, TibberApi } from '../../lib/tibber-api';
import { NordPoolPriceResult } from '../../lib/types';
import { startTransaction, noticeError } from '../../lib/newrelic-transaction';
import { randomBetweenRange } from '../../lib/helpers';

class WattyDevice extends Device {
  #api!: TibberApi;
  #deviceId!: string;
  #throttle!: number;
  #currency?: string;
  #cachedNordPoolPrice: { hour: number; price: number } | null = null;
  #area?: string;
  #prevPowerProduction?: number;
  #prevUpdate?: moment.Moment;
  #prevPower?: number;
  #prevCurrentL1?: number;
  #prevCurrentL2?: number;
  #prevCurrentL3?: number;
  #prevConsumption!: number;
  #prevCost?: number;
  #wsSubscription!: Subscription;
  #resubscribeDebounce!: _.DebouncedFunc<() => void>;
  #resubscribeMaxWaitMilliseconds!: number;
  #powerChangedTrigger!: FlowCardTriggerDevice;
  #consumptionChangedTrigger!: FlowCardTriggerDevice;
  #costChangedTrigger!: FlowCardTriggerDevice;
  #currentL1ChangedTrigger!: FlowCardTriggerDevice;
  #currentL2ChangedTrigger!: FlowCardTriggerDevice;
  #currentL3ChangedTrigger!: FlowCardTriggerDevice;
  #dailyConsumptionReportTrigger!: FlowCardTriggerDevice;

  async onInit() {
    const { id, t: token } = this.getData();

    this.#api = new TibberApi(this.log, this.homey.settings, id, token);
    this.#deviceId = id;
    this.#throttle = this.getSetting('pulse_throttle') || 30;

    this.#powerChangedTrigger = this.homey.flow.getDeviceTriggerCard(
      'watty_power_changed',
    );

    this.#consumptionChangedTrigger = this.homey.flow.getDeviceTriggerCard(
      'watty_consumption_changed',
    );

    this.#costChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('watty_cost_changed');

    this.#currentL1ChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('current.L1_changed');

    this.#currentL2ChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('current.L2_changed');

    this.#currentL3ChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('current.L3_changed');

    this.#dailyConsumptionReportTrigger = this.homey.flow.getDeviceTriggerCard(
      'watty_daily_consumption_report',
    );

    this.log(
      `Tibber Watty device ${this.getName()} has been initialized (throttle: ${
        this.#throttle
      })`,
    );

    const jitterSeconds = randomBetweenRange(0, 10);
    const delaySeconds = 10 * 60;
    this.#resubscribeMaxWaitMilliseconds =
      (jitterSeconds + delaySeconds) * 1000;

    // Resubscribe if no data for delay + jitter
    this.#resubscribeDebounce = _.debounce(
      this.#subscribeToLive.bind(this),
      this.#resubscribeMaxWaitMilliseconds,
    );
    await this.#subscribeToLive();
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: string };
    newSettings: { [key: string]: string };
    changedKeys: string[];
  }) {
    if (changedKeys.includes('pulse_throttle')) {
      this.log('Updated throttle value: ', newSettings.pulse_throttle);
      this.#throttle = Number(newSettings.pulse_throttle) || 30;
    }
    if (changedKeys.includes('pulse_currency')) {
      this.log('Updated currency value: ', newSettings.pulse_currency);
      this.#currency = newSettings.pulse_currency;
      this.#cachedNordPoolPrice = null;
    }
    if (changedKeys.includes('pulse_area')) {
      this.log('Updated area value: ', newSettings.pulse_area);
      this.#area = newSettings.pulse_area;
      this.#cachedNordPoolPrice = null;
    }
  }

  async #subscribeToLive() {
    this.#resubscribeDebounce();

    if (typeof this.#wsSubscription?.unsubscribe === 'function') {
      try {
        this.log(
          `No data received in ${
            this.#resubscribeMaxWaitMilliseconds / 1000
          } seconds; Unsubscribing from previous connection`,
        );
        this.#wsSubscription.unsubscribe();
      } catch (e) {
        this.log('Error unsubscribing from previous connection', e);
      }
    }

    let websocketSubscriptionUrl = '';
    try {
      const { viewer } = await this.#api.getHomeFeatures(this);
      websocketSubscriptionUrl = viewer.websocketSubscriptionUrl;

      if (viewer?.home?.features?.realTimeConsumptionEnabled === false) {
        this.log(
          `Home with id ${
            this.#deviceId
          } does not have real time consumption enabled. Set device unavailable`,
        );
        this.#resubscribeDebounce.cancel();
        await this.setUnavailable(
          'Tibber home with specified id not found. Please re-add device.',
        );
        return;
      }
    } catch (e) {
      this.log('Error fetching home features', e);
      return;
    }

    this.log('Subscribing to live data for homeId', this.#deviceId);

    this.#wsSubscription = this.#api
      .subscribeToLive(websocketSubscriptionUrl)
      .subscribe(
        (result) => this.subscribeCallback(result),
        (error) => {
          noticeError(error);
          this.log('Subscription error occurred', error);
          // When server shuts down we end up here with message text "Unexpected server response: 503"
          const delay = randomBetweenRange(5, 120);
          this.log(`Resubscribe after ${delay} seconds`);
          this.#resubscribeDebounce.cancel();
          this.homey.setTimeout(() => this.#subscribeToLive(), delay * 1000);
        },
        () => this.log('Subscription ended with no error'),
      );
  }

  async subscribeCallback(result: LiveMeasurement) {
    this.#resubscribeDebounce();

    this.homey.api
      .realtime('data-update-event', {
        driverId: 'pulse',
        deviceId: this.getData().id,
        liveMeasurement: result.data?.liveMeasurement,
      })
      .catch(console.error);

    const power = result.data?.liveMeasurement?.power;
    const powerProduction = result.data?.liveMeasurement?.powerProduction;

    if (powerProduction) this.#prevPowerProduction = powerProduction;

    if (
      this.#prevUpdate &&
      moment().diff(this.#prevUpdate, 'seconds') < this.#throttle
    )
      return;

    this.#prevUpdate = moment();

    const measurePower =
      power || -powerProduction! || -this.#prevPowerProduction!;
    this.log(`Set 'measure_power' capability to`, measurePower);
    this.setCapabilityValue('measure_power', measurePower)
      .catch(console.error)
      .finally(() => {
        if (measurePower !== this.#prevPower) {
          this.#prevPower = measurePower;
          this.log(`Trigger power changed`, measurePower);
          this.#powerChangedTrigger
            .trigger(this, { power: measurePower })
            .catch(console.error);
        }
      });

    const currentL1 = result.data?.liveMeasurement?.currentL1;
    const currentL2 = result.data?.liveMeasurement?.currentL2;
    const currentL3 = result.data?.liveMeasurement?.currentL3;

    this.log(
      `Latest current values [L1: ${currentL1}, L2: ${currentL2}, L3: ${currentL3}]`,
    );

    if (currentL1 !== undefined && currentL1 !== null) {
      this.setCapabilityValue('measure_current.L1', currentL1)
        .catch(console.error)
        .finally(() => {
          this.log("Set 'measure_current.L1' capability to", currentL1);
          if (currentL1 !== this.#prevCurrentL1) {
            this.#prevCurrentL1 = currentL1!;
            this.log(`Trigger current L1 changed`, currentL1);
            this.#currentL1ChangedTrigger
              .trigger(this, { currentL1 })
              .catch(console.error);
          }
        });
    }

    if (currentL2 !== undefined && currentL2 !== null) {
      this.setCapabilityValue('measure_current.L2', currentL2)
        .catch(console.error)
        .finally(() => {
          this.log("Set 'measure_current.L2' capability to", currentL2);
          if (currentL2 !== this.#prevCurrentL2) {
            this.#prevCurrentL2 = currentL2!;
            this.log(`Trigger current L2 changed`, currentL2);
            this.#currentL2ChangedTrigger
              .trigger(this, { currentL2 })
              .catch(console.error);
          }
        });
    }

    if (currentL3 !== undefined && currentL3 !== null) {
      this.setCapabilityValue('measure_current.L3', currentL3)
        .catch(console.error)
        .finally(() => {
          this.log("Set 'measure_current.L3' capability to", currentL3);
          if (currentL3 !== this.#prevCurrentL3) {
            this.#prevCurrentL3 = currentL3!;
            this.log(`Trigger current L3 changed`, currentL3);
            this.#currentL3ChangedTrigger
              .trigger(this, { currentL3 })
              .catch(console.error);
          }
        });
    }

    const consumption = result.data?.liveMeasurement?.accumulatedConsumption;
    if (consumption !== undefined) {
      const fixedConsumption = Number(consumption.toFixed(2));
      if (fixedConsumption !== this.#prevConsumption) {
        if (fixedConsumption < this.#prevConsumption) {
          // consumption has been reset
          this.log('Triggering daily consumption report');
          this.#dailyConsumptionReportTrigger
            .trigger(this, {
              consumption: this.#prevConsumption,
              cost: this.#prevCost,
            })
            .catch(console.error);
        }

        this.#prevConsumption = fixedConsumption;
        this.setCapabilityValue('meter_power', fixedConsumption)
          .catch(console.error)
          .finally(() => {
            this.#consumptionChangedTrigger
              .trigger(this, { consumption: fixedConsumption })
              .catch(console.error);
          });
      }
    }

    let cost = result.data?.liveMeasurement?.accumulatedCost;
    if (cost === undefined || cost === null) {
      try {
        const now = moment();
        if (
          this.#cachedNordPoolPrice === null ||
          this.#cachedNordPoolPrice.hour !== now.hour()
        ) {
          const area = this.#area || 'Oslo';
          const currency = this.#currency || 'NOK';
          this.log(
            `Using Nord Pool prices. Currency: ${currency} - Area: ${area}`,
          );
          const priceResult = await startTransaction(
            'GetNordPoolPrices.Watty',
            'External',
            () =>
              http.json<NordPoolPriceResult>(
                `https://www.nordpoolgroup.com/api/marketdata/page/10?currency=${currency},${currency},${currency},${currency}&endDate=${moment()
                  .tz(this.homey.clock.getTimezone())
                  .format('DD-MM-YYYY')}`,
              ),
          );
          const filteredRows = (priceResult?.data.Rows ?? [])
            .filter(
              (row) =>
                !row.IsExtraRow &&
                moment
                  .tz(row.StartTime, this.homey.clock.getTimezone())
                  .isBefore(now) &&
                moment
                  .tz(row.EndTime, this.homey.clock.getTimezone())
                  .isAfter(now),
            )
            .map((row) => row.Columns);

          const areaCurrentPrice = filteredRows.length
            ? filteredRows[0].find((a: { Name: string }) => a.Name === area)
            : undefined;

          if (areaCurrentPrice !== undefined) {
            const currentPrice =
              Number(
                areaCurrentPrice.Value.replace(',', '.')
                  .replace(' ', '')
                  .trim(),
              ) / 1000;

            this.#cachedNordPoolPrice = {
              hour: now.hour(),
              price: currentPrice,
            };
            this.log(
              `Found price for system time ${now.format()} for area ${area} ${currentPrice}`,
            );
          }
        }

        if (typeof this.#cachedNordPoolPrice?.price !== 'number') return;

        cost = this.#cachedNordPoolPrice!.price * consumption!;
      } catch (e) {
        console.error('Error fetching prices from Nord Pool', e);
      }
    }

    if (cost !== undefined && cost !== null) {
      const fixedCost = Number(cost.toFixed(2));
      if (fixedCost !== this.#prevCost) {
        this.#prevCost = fixedCost;
        this.setCapabilityValue('accumulatedCost', fixedCost)
          .catch(console.error)
          .finally(() => {
            this.#costChangedTrigger
              .trigger(this, { cost: fixedCost })
              .catch(console.error);
          });
      }
    }

    const lastMeterConsumption =
      result.data?.liveMeasurement?.lastMeterConsumption;
    if (typeof lastMeterConsumption === 'number') {
      if (this.hasCapability('meter_power.imported') !== true)
        await this.addCapability('meter_power.imported').catch(console.error);

      const fixedLastMeterConsumption = Number(lastMeterConsumption.toFixed(2));
      this.setCapabilityValue(
        'meter_power.imported',
        fixedLastMeterConsumption,
      ).catch(console.error);
    }

    const lastMeterProduction =
      result.data?.liveMeasurement?.lastMeterProduction;
    if (typeof lastMeterProduction === 'number') {
      if (this.hasCapability('meter_power.exported') !== true)
        await this.addCapability('meter_power.exported').catch(console.error);

      const fixedLastMeterProduction = Number(lastMeterProduction.toFixed(2));
      this.setCapabilityValue(
        'meter_power.exported',
        fixedLastMeterProduction,
      ).catch(console.error);
    }
  }

  onDeleted() {
    this.destroy();
  }

  onUninit() {
    this.destroy();
  }

  destroy() {
    if (typeof this.#wsSubscription?.unsubscribe === 'function') {
      try {
        this.log('Unsubscribing from previous connection');
        this.#wsSubscription.unsubscribe();
        this.#resubscribeDebounce.cancel();
      } catch (e) {
        this.log('Error unsubscribing from previous connection', e);
      }
    }
  }
}

module.exports = WattyDevice;
