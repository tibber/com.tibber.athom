import { env, Device, FlowCard, FlowCardTriggerDevice } from 'homey';
import _ from 'lodash';
import http from 'http.min';
import moment from 'moment-timezone';
import newrelic from 'newrelic';
import { mapSeries } from 'bluebird';
import {
  TibberApi,
  getRandomDelay,
  PriceInfo,
  ConsumptionData,
  ConsumptionNode,
} from '../../lib/tibber';

// eslint-disable-next-line import/extensions
import type { AppInstance } from '../../app';

class HomeDevice extends Device {
  #tibber!: TibberApi;
  #deviceLabel!: string;
  #insightId!: string;
  #priceInfoNextHours!: PriceInfo[];
  #lastPrice?: PriceInfo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #lastTemperature?: any;
  #location!: { lat: number; lon: number };
  #priceChangedTrigger!: FlowCardTriggerDevice;
  #temperatureChangedTrigger!: FlowCardTriggerDevice;
  #consumptionReportTrigger!: FlowCardTriggerDevice;
  #priceBelowAvgTrigger!: FlowCardTriggerDevice;
  #priceAboveAvgTrigger!: FlowCardTriggerDevice;
  #priceBelowAvgTodayTrigger!: FlowCardTriggerDevice;
  #priceAboveAvgTodayTrigger!: FlowCardTriggerDevice;
  #priceAtLowestTrigger!: FlowCardTriggerDevice;
  #priceAtHighestTrigger!: FlowCardTriggerDevice;
  #priceAtLowestTodayTrigger!: FlowCardTriggerDevice;
  #priceAtHighestTodayTrigger!: FlowCardTriggerDevice;
  #priceAmongLowestTrigger!: FlowCardTriggerDevice;
  #priceAmongHighestTrigger!: FlowCardTriggerDevice;
  #currentPriceBelowCondition!: FlowCard;
  #currentPriceBelowAvgCondition!: FlowCard;
  #currentPriceAboveAvgCondition!: FlowCard;
  #currentPriceBelowAvgTodayCondition!: FlowCard;
  #currentPriceAboveAvgTodayCondition!: FlowCard;
  #currentPriceAtLowestCondition!: FlowCard;
  #currentPriceAtHighestCondition!: FlowCard;
  #currentPriceAtLowestTodayCondition!: FlowCard;
  #currentPriceAtHighestTodayCondition!: FlowCard;
  #currentPriceAmongLowestTodayCondition!: FlowCard;
  #currentPriceAmongHighestTodayCondition!: FlowCard;
  #outdoorTemperatureBelowCondition!: FlowCard;
  #sendPushNotificationAction!: FlowCard;

  async onInit() {
    const data = this.getData();
    const { id: homeId, t: token } = data;

    this.#tibber = new TibberApi(this.log, this.homey.settings, homeId, token);

    if (data.address === undefined) {
      return this.setUnavailable(
        'You will need to remove and add this home as new device',
      );
    }

    this.#deviceLabel = this.getName();
    this.#insightId = this.#deviceLabel
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    this.#lastPrice = undefined;
    this.#lastTemperature = undefined;
    const { latitude: lat, longitude: lon } = data.address;
    this.#location = { lat, lon };

    this.#priceChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('price_changed'); // .registerRunListener(() => true);

    this.#temperatureChangedTrigger = this.homey.flow.getDeviceTriggerCard(
      'temperature_changed',
    ); // .registerRunListener(() => true);

    this.#consumptionReportTrigger =
      this.homey.flow.getDeviceTriggerCard('consumption_report'); // .registerRunListener(() => true);

    this.#priceBelowAvgTrigger =
      this.homey.flow.getDeviceTriggerCard('price_below_avg');
    this.#priceBelowAvgTrigger.registerRunListener(
      this.#priceAvgComparer.bind(this),
    );

    this.#priceAboveAvgTrigger =
      this.homey.flow.getDeviceTriggerCard('price_above_avg');
    this.#priceAboveAvgTrigger.registerRunListener(
      this.#priceAvgComparer.bind(this),
    );

    this.#priceBelowAvgTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_below_avg_today',
    );
    this.#priceBelowAvgTodayTrigger.registerRunListener(
      this.#priceAvgComparer.bind(this),
    );

    this.#priceAboveAvgTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_above_avg_today',
    );
    this.#priceAboveAvgTodayTrigger.registerRunListener(
      this.#priceAvgComparer.bind(this),
    );

    this.#priceAtLowestTrigger =
      this.homey.flow.getDeviceTriggerCard('price_at_lowest');
    this.#priceAtLowestTrigger.registerRunListener(
      this.#priceMinMaxComparer.bind(this),
    );

    this.#priceAtHighestTrigger =
      this.homey.flow.getDeviceTriggerCard('price_at_highest');
    this.#priceAtHighestTrigger.registerRunListener(
      this.#priceMinMaxComparer.bind(this),
    );

    this.#priceAtLowestTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_at_lowest_today',
    );
    // this._priceAtLowestTodayTrigger.register(); //Cannot use registerRunListener as the card have no arguments

    this.#priceAtHighestTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_at_highest_today',
    );
    // this._priceAtHighestTodayTrigger.register(); //Cannot use registerRunListener as the card have no arguments

    this.#priceAmongLowestTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_among_lowest_today',
    );
    this.#priceAmongLowestTrigger.registerRunListener(
      this.#priceMinMaxComparer.bind(this),
    );

    this.#priceAmongHighestTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_among_highest_today',
    );
    this.#priceAmongHighestTrigger.registerRunListener(
      this.#priceMinMaxComparer.bind(this),
    );

    this.#currentPriceBelowCondition = this.homey.flow.getConditionCard(
      'current_price_below',
    );
    this.#currentPriceBelowCondition.registerRunListener((args, _state) => {
      if (this.#lastPrice === undefined) return false;
      return args.price > Number(this.#lastPrice.total);
    });

    this.#currentPriceBelowAvgCondition = this.homey.flow.getConditionCard(
      'cond_price_below_avg',
    );
    this.#currentPriceBelowAvgCondition.registerRunListener((args) =>
      this.#priceAvgComparer(args, { below: true }),
    );

    this.#currentPriceAboveAvgCondition = this.homey.flow.getConditionCard(
      'cond_price_above_avg',
    );
    this.#currentPriceAboveAvgCondition.registerRunListener((args) =>
      this.#priceAvgComparer(args, { below: false }),
    );

    this.#currentPriceBelowAvgTodayCondition = this.homey.flow.getConditionCard(
      'cond_price_below_avg_today',
    );
    this.#currentPriceBelowAvgTodayCondition.registerRunListener((args) =>
      this.#priceAvgComparer(args, { below: true }),
    );

    this.#currentPriceAboveAvgTodayCondition = this.homey.flow.getConditionCard(
      'cond_price_above_avg_today',
    );
    this.#currentPriceAboveAvgTodayCondition.registerRunListener((args) =>
      this.#priceAvgComparer(args, { below: false }),
    );

    this.#currentPriceAtLowestCondition = this.homey.flow.getConditionCard(
      'cond_price_at_lowest',
    );
    this.#currentPriceAtLowestCondition.registerRunListener((args) =>
      this.#priceMinMaxComparer(args, { lowest: true }),
    );

    this.#currentPriceAtHighestCondition = this.homey.flow.getConditionCard(
      'cond_price_at_highest',
    );
    this.#currentPriceAtHighestCondition.registerRunListener((args) =>
      this.#priceMinMaxComparer(args, { lowest: false }),
    );

    this.#currentPriceAtLowestTodayCondition = this.homey.flow.getConditionCard(
      'cond_price_at_lowest_today',
    );
    this.#currentPriceAtLowestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparer(args, { lowest: true }),
    );

    this.#currentPriceAtHighestTodayCondition =
      this.homey.flow.getConditionCard('cond_price_at_highest_today');
    this.#currentPriceAtHighestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparer(args, { lowest: false }),
    );

    this.#currentPriceAmongLowestTodayCondition =
      this.homey.flow.getConditionCard('cond_price_among_lowest_today');
    this.#currentPriceAmongLowestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparer(args, { lowest: true }),
    );

    this.#currentPriceAmongHighestTodayCondition =
      this.homey.flow.getConditionCard('cond_price_among_highest_today');
    this.#currentPriceAmongHighestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparer(args, { lowest: false }),
    );

    this.#outdoorTemperatureBelowCondition =
      this.homey.flow.getConditionCard('temperature_below');
    this.#outdoorTemperatureBelowCondition.registerRunListener(
      (args) => args.temperature > this.#lastTemperature,
    );

    this.#sendPushNotificationAction = this.homey.flow.getActionCard(
      'sendPushNotification',
    );
    this.#sendPushNotificationAction.registerRunListener((args) =>
      this.#tibber.sendPush(args.title, args.message),
    );

    if (!this.hasCapability('price_level'))
      await this.addCapability('price_level');

    this.log(`Tibber home device ${this.getName()} has been initialized`);
    return this.updateData();
  }

  onDeleted() {
    this.log('Device deleted:', this.#deviceLabel);

    this.homey.settings.set(
      `${this.#insightId}_lastLoggedDailyConsumption`,
      undefined,
    );
    this.homey.settings.set(
      `${this.#insightId}_lastLoggerHourlyConsumption`,
      undefined,
    );

    return (this.homey.app as AppInstance)?.cleanupLogs(this.#insightId);
  }

  async getTemperature() {
    try {
      this.log(
        `Fetching temperature with api key ${env.DS_API_KEY} for coordinates ${
          this.#location.lat
        },${this.#location.lon}`,
      );

      let temperature;
      try {
        const { lat, lon } = this.#location;
        const forecast = await newrelic.startWebTransaction(
          'Get temperature',
          () =>
            http.json(
              `https://api.darksky.net/forecast/${env.DS_API_KEY}/${lat},${lon}?units=si`,
            ),
        );
        temperature = _.get(forecast, 'currently.temperature');
        this.log(`Fetched temperature ${temperature}`);
      } catch (error) {
        this.log(`Error fetching temperature ${JSON.stringify(error)}`);
      }

      if (temperature && temperature !== this.#lastTemperature) {
        this.#lastTemperature = temperature;
        this.setCapabilityValue('measure_temperature', temperature).catch(
          console.error,
        );

        this.log('Triggering temperature_changed', temperature);
        this.#temperatureChangedTrigger
          .trigger(this, temperature)
          .catch(console.error);

        const temperatureLogger = await this.#createGetLog(
          `${this.#insightId}_temperature`,
          {
            title: `${this.getLoggerPrefix()}Outdoor temperature`,
            type: 'number',
            decimals: 1,
          },
        );
        temperatureLogger
          .createEntry(temperature /* , new Date() */)
          .catch(console.error);
      }
    } catch (e) {
      console.error(
        `Error fetching weather forecast (${this.#location.lat},${
          this.#location.lon
        })`,
        e,
      );
    }
  }

  isConsumptionReportEnabled() {
    return this.getSetting('enable_consumption_report') || false;
  }

  async updateData() {
    try {
      this.log(`Begin update`);

      // Fetch and update price triggers
      const priceInfoNextHours = await this.#tibber.getPriceInfoCached(
        this.homey.setTimeout,
      );
      this.onPriceData(priceInfoNextHours).catch(() => {});

      // Fetch and update temperature
      await this.getTemperature();

      // Fetch and update consumption report if enabled
      if (this.isConsumptionReportEnabled()) {
        this.log(`Consumption report enabled. Begin update`);
        const now = moment();
        const lastLoggedDailyConsumption = this.getLastLoggedDailyConsumption();
        let daysToFetch = 14;

        if (lastLoggedDailyConsumption) {
          const durationSinceLastDailyConsumption = moment.duration(
            now.diff(moment(lastLoggedDailyConsumption)),
          );
          daysToFetch = Math.floor(durationSinceLastDailyConsumption.asDays());
        }

        const lastLoggedHourlyConsumption =
          this.getLastLoggedHourlyConsumption();

        let hoursToFetch = 200;
        if (lastLoggedHourlyConsumption) {
          const durationSinceLastHourlyConsumption = moment.duration(
            now.diff(moment(lastLoggedHourlyConsumption)),
          );
          hoursToFetch = Math.floor(
            durationSinceLastHourlyConsumption.asHours(),
          );
        }

        this.log(
          `Last logged daily consumption at ${lastLoggedDailyConsumption} hourly consumption at ${lastLoggedHourlyConsumption}. Fetch ${daysToFetch} days ${hoursToFetch} hours`,
        );

        if (!lastLoggedDailyConsumption || !lastLoggedHourlyConsumption) {
          const consumptionData = await this.#tibber.getConsumptionData(
            daysToFetch,
            hoursToFetch,
          );
          await this.onConsumptionData(consumptionData);
        } else if (!hoursToFetch && !daysToFetch) {
          this.log(`Consumption data up to date. Skip fetch.`);
        } else {
          const delay = getRandomDelay(0, 59 * 60);
          this.log(
            `Schedule consumption fetch for ${daysToFetch} days ${hoursToFetch} hours after ${delay} seconds.`,
          );
          this.homey.setTimeout(async () => {
            const consumptionData = await this.#tibber.getConsumptionData(
              daysToFetch,
              hoursToFetch,
            );
            await this.onConsumptionData(consumptionData);
          }, delay * 1000);
        }
      }

      const nextHour = moment().add(1, 'hour').startOf('hour');
      this.log(`Next time to run update is at ${nextHour.format()}`);
      const delay = moment.duration(nextHour.diff(moment()));
      this.scheduleUpdate(delay.asSeconds());

      this.log(`End update`);
    } catch (e) {
      this.log('Error fetching data', e);

      const errorCode = _.get(e, 'response.errors[0].extensions.code');
      this.log('Received error code', errorCode);
      if (errorCode === 'HOME_NOT_FOUND') {
        this.log(
          `Home with id ${this.getData().id} not found. Set device unavailable`,
        );
        await this.setUnavailable(
          'Tibber home with specified id not found. Please re-add device.',
        );
        return;
      }

      // Try again after a delay
      const delay = getRandomDelay(0, 5 * 60);
      this.scheduleUpdate(delay);
    }
  }

  scheduleUpdate(seconds: number) {
    this.log(`Scheduling update again in ${seconds} seconds`);
    setTimeout(this.updateData.bind(this), seconds * 1000);
  }

  getLoggerPrefix() {
    return this.driver.getDevices().length > 1 ? `${this.#deviceLabel} ` : '';
  }

  async onPriceData(priceInfoNextHours: PriceInfo[]) {
    const currentHour = moment().startOf('hour');
    const priceInfoCurrent = _.find(priceInfoNextHours, (p) =>
      currentHour.isSame(moment(p.startsAt)),
    );
    if (priceInfoCurrent === undefined) {
      this.log(
        `Error finding current price info for ${currentHour.format()}. Abort.`,
        priceInfoNextHours,
      );
      return;
    }

    if (
      _.get(priceInfoCurrent, 'startsAt') !== _.get(this.#lastPrice, 'startsAt')
    ) {
      this.#lastPrice = priceInfoCurrent;
      this.#priceInfoNextHours = priceInfoNextHours;

      if (priceInfoCurrent.total !== null) {
        this.setCapabilityValue('price_total', priceInfoCurrent.total).catch(
          console.error,
        );
        this.setCapabilityValue('price_level', priceInfoCurrent.level).catch(
          console.error,
        );

        this.#priceChangedTrigger
          .trigger(this, priceInfoCurrent)
          .catch(console.error);
        this.log('Triggering price_changed', priceInfoCurrent);

        const priceLogger = await this.#createGetLog(
          `${this.#insightId}_price`,
          {
            title: `${this.getLoggerPrefix()}Current price`,
            type: 'number',
            decimals: 1,
          },
        );
        priceLogger
          .createEntry(
            priceInfoCurrent.total /* , moment(priceInfoCurrent.startsAt).toDate() */,
          )
          .catch(console.error);

        if (priceInfoNextHours === undefined) return;

        this.#priceBelowAvgTrigger
          .trigger(this, undefined, { below: true })
          .catch(console.error);

        this.#priceBelowAvgTodayTrigger
          .trigger(this, undefined, { below: true })
          .catch(console.error);

        this.#priceAboveAvgTrigger
          .trigger(this, undefined, { below: false })
          .catch(console.error);

        this.#priceAboveAvgTodayTrigger
          .trigger(this, undefined, { below: false })
          .catch(console.error);

        this.#priceAtLowestTrigger
          .trigger(this, undefined, { lowest: true })
          .catch(console.error);

        this.#priceAtHighestTrigger
          .trigger(this, undefined, { lowest: false })
          .catch(console.error);

        this.#priceAmongLowestTrigger
          .trigger(this, undefined, { lowest: true })
          .catch(console.error);

        this.#priceAmongHighestTrigger
          .trigger(this, undefined, { lowest: true })
          .catch(console.error);

        if (this.#priceMinMaxComparer({}, { lowest: true })) {
          this.#priceAtLowestTodayTrigger
            .trigger(this, undefined, { lowest: true })
            .catch(console.error);
        }

        if (this.#priceMinMaxComparer({}, { lowest: false })) {
          this.#priceAtHighestTodayTrigger
            .trigger(this, undefined, { lowest: false })
            .catch(console.error);
        }
      }
    }
  }

  getLastLoggedDailyConsumption(): string {
    return this.homey.settings.get(
      `${this.#insightId}_lastLoggedDailyConsumption`,
    );
  }

  setLastLoggedDailyConsumption(value: string) {
    this.homey.settings.set(
      `${this.#insightId}_lastLoggedDailyConsumption`,
      value,
    );
  }

  getLastLoggedHourlyConsumption(): string {
    return this.homey.settings.get(
      `${this.#insightId}_lastLoggerHourlyConsumption`,
    );
  }

  setLastLoggedHourlyConsumption(value: string) {
    this.homey.settings.set(
      `${this.#insightId}_lastLoggerHourlyConsumption`,
      value,
    );
  }

  async onConsumptionData(data: ConsumptionData) {
    try {
      const lastLoggedDailyConsumption = this.getLastLoggedDailyConsumption();
      const consumptionsSinceLastReport: ConsumptionNode[] = [];
      const dailyConsumptions: ConsumptionNode[] =
        data.viewer.home?.daily?.nodes ?? [];
      await mapSeries(dailyConsumptions, async (dailyConsumption) => {
        if (dailyConsumption.consumption !== null) {
          if (
            lastLoggedDailyConsumption &&
            moment(dailyConsumption.to) <= moment(lastLoggedDailyConsumption)
          )
            return;

          consumptionsSinceLastReport.push(dailyConsumption);
          this.setLastLoggedDailyConsumption(dailyConsumption.to);

          this.log('Got daily consumption', dailyConsumption);
          const consumptionLogger = await this.#createGetLog(
            `${this.#insightId}_dailyConsumption`,
            {
              title: `${this.getLoggerPrefix()}Daily consumption`,
              type: 'number',
              decimals: 1,
            },
          );

          consumptionLogger
            .createEntry(
              dailyConsumption.consumption /* , moment(dailyConsumption.to).toDate() */,
            )
            .catch(console.error);

          const costLogger = await this.#createGetLog(
            `${this.#insightId}_dailyCost`,
            {
              title: `${this.getLoggerPrefix()}Daily total cost`,
              type: 'number',
              decimals: 1,
            },
          );
          costLogger
            .createEntry(
              dailyConsumption.totalCost /* , moment(dailyConsumption.to).toDate() */,
            )
            .catch(console.error);
        }
      });

      if (consumptionsSinceLastReport.length > 0) {
        this.#consumptionReportTrigger
          .trigger(this, {
            consumption: +_.sumBy(
              consumptionsSinceLastReport,
              'consumption',
            ).toFixed(2),
            totalCost: +_.sumBy(
              consumptionsSinceLastReport,
              'totalCost',
            ).toFixed(2),
            unitCost: +_.sumBy(consumptionsSinceLastReport, 'unitCost').toFixed(
              2,
            ),
            unitPrice: +_.meanBy(
              consumptionsSinceLastReport,
              'unitPrice',
            ).toFixed(2),
          })
          .catch(console.error);
      }
    } catch (e) {
      console.error('Error logging daily consumption', e);
    }

    try {
      const lastLoggedHourlyConsumption = this.getLastLoggedHourlyConsumption();
      const hourlyConsumptions = data.viewer.home?.hourly?.nodes || [];
      await mapSeries(hourlyConsumptions, async (hourlyConsumption) => {
        if (hourlyConsumption.consumption !== null) {
          if (
            lastLoggedHourlyConsumption &&
            moment(hourlyConsumption.to) <= moment(lastLoggedHourlyConsumption)
          )
            return;

          this.setLastLoggedHourlyConsumption(hourlyConsumption.to);

          this.log('Got hourly consumption', hourlyConsumption);
          const consumptionLogger = await this.#createGetLog(
            `${this.#insightId}hourlyConsumption`,
            {
              title: `${this.getLoggerPrefix()}Hourly consumption`,
              type: 'number',
              decimals: 1,
            },
          );

          consumptionLogger
            .createEntry(
              hourlyConsumption.consumption /* , moment(hourlyConsumption.to).toDate() */,
            )
            .catch(console.error);

          const costLogger = await this.#createGetLog(
            `${this.#insightId}_hourlyCost`,
            {
              title: `${this.getLoggerPrefix()}Hourly total cost`,
              type: 'number',
              decimals: 1,
            },
          );
          costLogger
            .createEntry(
              hourlyConsumption.totalCost /* , moment(hourlyConsumption.to).toDate() */,
            )
            .catch(console.error);
        }
      });
    } catch (e) {
      console.error('Error logging hourly consumption', e);
    }
  }

  #priceAvgComparer(
    { hours, percentage }: { hours: number; percentage: number },
    { below }: { below: boolean },
  ): boolean {
    if (hours === 0) return false;

    const now = moment();
    let avgPriceNextHours: number;
    if (hours) {
      avgPriceNextHours = _(this.#priceInfoNextHours)
        .filter((p) =>
          hours > 0
            ? moment(p.startsAt).isAfter(now)
            : moment(p.startsAt).isBefore(now),
        )
        .take(Math.abs(hours))
        .meanBy((x) => x.total);
    } else {
      avgPriceNextHours = _(this.#priceInfoNextHours)
        .filter((p) => moment(p.startsAt).add(30, 'minutes').isSame(now, 'day'))
        .meanBy((x) => x.total);
    }

    if (avgPriceNextHours === undefined) {
      this.log(
        `Cannot determine condition. No prices for next hours available.`,
      );
      return false;
    }

    if (!this.#lastPrice) return false;

    let diffAvgCurrent =
      ((this.#lastPrice.total - avgPriceNextHours) / avgPriceNextHours) * 100;
    if (below) diffAvgCurrent *= -1;

    this.log(
      `${this.#lastPrice.total.toFixed(2)} is ${diffAvgCurrent.toFixed(2)}% ${
        below ? 'below' : 'above'
      } avg (${avgPriceNextHours.toFixed(2)}) ${
        hours ? `next ${hours} hours` : 'today'
      }. Condition of min ${percentage} percentage met = ${
        diffAvgCurrent > percentage
      }`,
    );
    return diffAvgCurrent > percentage;
  }

  #priceMinMaxComparer(
    options: { hours?: number; ranked_hours?: number },
    { lowest }: { lowest: boolean },
  ) {
    if (options.hours === 0 || options.ranked_hours === 0) return false;

    const now = moment();
    const pricesNextHours =
      options.hours !== undefined
        ? _(this.#priceInfoNextHours)
            .filter((p) =>
              options.hours! > 0
                ? moment(p.startsAt).isAfter(now)
                : moment(p.startsAt).isBefore(now),
            )
            .take(Math.abs(options.hours))
            .value()
        : _(this.#priceInfoNextHours)
            .filter((p) =>
              moment(p.startsAt).add(30, 'minutes').isSame(now, 'day'),
            )
            .value();

    if (!pricesNextHours.length) {
      this.log(
        `Cannot determine condition. No prices for next hours available.`,
      );
      return false;
    }

    if (this.#lastPrice === undefined) {
      this.log(`Cannot determine condition. The last price is undefined`);
      return false;
    }

    let conditionMet;
    if (options.ranked_hours !== undefined) {
      const sortedHours = _.sortBy(pricesNextHours, ['total']);
      const currentHourRank = _.findIndex(pricesNextHours, [
        'startsAt',
        this.#lastPrice.startsAt,
      ]);
      if (currentHourRank < 0) {
        this.log(`Could not find the current hour rank among today's hours`);
        return false;
      }

      conditionMet = lowest
        ? currentHourRank < options.ranked_hours
        : currentHourRank >= sortedHours.length - options.ranked_hours;

      this.log(
        `${this.#lastPrice.total.toFixed(2)} is among the ${
          lowest ? 'lowest' : 'highest'
        } ${options.ranked_hours} hours today = ${conditionMet}`,
      );
    } else {
      const toCompare = lowest
        ? _.minBy(pricesNextHours, 'total')!.total
        : _.maxBy(pricesNextHours, 'total')!.total;

      conditionMet = lowest
        ? this.#lastPrice.total <= toCompare
        : this.#lastPrice.total >= toCompare;

      this.log(
        `${this.#lastPrice.total.toFixed(2)} is ${
          lowest ? 'lower than the lowest' : 'higher than the highest'
        } (${toCompare}) ${
          options.hours ? `among the next ${options.hours} hours` : 'today'
        } = ${conditionMet}`,
      );
    }

    return conditionMet;
  }

  async #createGetLog(
    name: string,
    options: {
      title: string;
      type: string;
      units?: string | undefined;
      decimals?: number | undefined;
    },
  ) {
    try {
      return await this.homey.insights.getLog(name);
    } catch (e) {
      console.info(
        `Could not find log ${name} (error: ${e}). Creating new log.`,
      );
      return await this.homey.insights.createLog(name, options);
    }
  }
}

module.exports = HomeDevice;
