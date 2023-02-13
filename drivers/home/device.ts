import { Device, FlowCard, FlowCardTriggerDevice } from 'homey';
import _ from 'lodash';
import moment from 'moment-timezone';
import { mapSeries } from 'bluebird';
import { ClientError } from 'graphql-request/dist/types';
import {
  TibberApi,
  getRandomDelay,
  PriceInfoEntry,
  ConsumptionData,
  ConsumptionNode,
} from '../../lib/tibber';
import { startTransaction } from '../../lib/newrelic-transaction';
import { formatTime, isSameDay } from '../../lib/helpers';
import { TimeString } from '../../lib/types';
import {
  ERROR_CODE_HOME_NOT_FOUND,
  ERROR_CODE_UNAUTHENTICATED,
} from '../../lib/constants';

const deprecatedPriceLevelMap = {
  VERY_CHEAP: 'LOW',
  CHEAP: 'LOW',
  NORMAL: 'NORMAL',
  EXPENSIVE: 'HIGH',
  VERY_EXPENSIVE: 'HIGH',
};

class HomeDevice extends Device {
  #tibber!: TibberApi;
  #deviceLabel!: string;
  #insightId!: string;
  #hourlyPrices!: PriceInfoEntry[];
  #latestPrice?: PriceInfoEntry;
  #priceAtLowestToday?: PriceInfoEntry;
  #priceAtHighestToday?: PriceInfoEntry;
  #priceChangedTrigger!: FlowCardTriggerDevice;
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
  #currentPriceAmongLowestWithinTimeFrameCondition!: FlowCard;
  #sendPushNotificationAction!: FlowCard;
  #hasDeprecatedTotalPriceCapability = false;
  #hasDeprecatedPriceLevelCapability = false;
  #hasDeprecatedMeasurePriceLevelCapability = false;

  async onInit() {
    // `price_total` was deprecated in favor of `measure_price_total` (so it could be used as a device indicator)
    // and `price_level` was deprecated in favor of `measure_price_level` (because it went from 5 enum values to 3)
    // after that, we deprecated `measure_price_level` because that change was premature and poorly communicated
    // and reverted to using 5 price levels again
    // we don't want to remove these capabilities completely and break users' flow cards using them
    this.#hasDeprecatedTotalPriceCapability = this.hasCapability('price_total');
    this.#hasDeprecatedPriceLevelCapability = this.hasCapability('price_level');
    this.#hasDeprecatedMeasurePriceLevelCapability = this.hasCapability(
      'measure_price_level',
    );

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
    this.#latestPrice = undefined;

    this.#priceChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('price_changed');

    this.#consumptionReportTrigger =
      this.homey.flow.getDeviceTriggerCard('consumption_report');

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

    this.#priceAtHighestTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_at_highest_today',
    );

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
      if (this.#latestPrice === undefined) return false;
      return args.price > Number(this.#latestPrice.total);
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

    this.#currentPriceAmongLowestWithinTimeFrameCondition =
      this.homey.flow.getConditionCard('price_among_lowest_time');
    this.#currentPriceAmongLowestWithinTimeFrameCondition.registerRunListener(
      (args) => this.#lowestPricesWithinTimeFrame(args),
    );

    this.#sendPushNotificationAction = this.homey.flow.getActionCard(
      'sendPushNotification',
    );
    this.#sendPushNotificationAction.registerRunListener(async (args) =>
      this.#tibber.sendPush(args.title, args.message),
    );

    if (!this.hasCapability('price_level'))
      await this.addCapability('price_level');

    if (!this.hasCapability('measure_price_level'))
      await this.addCapability('measure_price_level');

    if (!this.hasCapability('measure_price_info_level'))
      await this.addCapability('measure_price_info_level');

    if (!this.hasCapability('measure_price_total'))
      await this.addCapability('measure_price_total');

    if (this.hasCapability('measure_temperature')) {
      await this.removeCapability('measure_temperature');
      await this.homey.notifications
        .createNotification({
          excerpt:
            'Please note potential breaking changes with this version of the ' +
            "Tibber app. Details available on the app's store page.",
        })
        .catch(console.error);
    }

    if (!this.hasCapability('measure_price_lowest'))
      await this.addCapability('measure_price_lowest');

    if (!this.hasCapability('measure_price_highest'))
      await this.addCapability('measure_price_highest');

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

    return this.homey.app?.cleanupLogs(this.#insightId);
  }

  isConsumptionReportEnabled() {
    return this.getSetting('enable_consumption_report') || false;
  }

  async updateData() {
    try {
      this.log(`Begin update`);

      const hourlyPrices = await startTransaction('GetPriceInfo', 'API', () =>
        this.#tibber.getPriceInfoCached((callback, ms, args) =>
          this.homey.setTimeout(callback, ms, args),
        ),
      );

      this.onPriceData(hourlyPrices).catch(() => {});

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
          const consumptionData = await startTransaction(
            'GetConsumption',
            'API',
            () => this.#tibber.getConsumptionData(daysToFetch, hoursToFetch),
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
            let consumptionData;
            try {
              consumptionData = await startTransaction(
                'ScheduledGetConsumption',
                'API',
                () =>
                  this.#tibber.getConsumptionData(daysToFetch, hoursToFetch),
              );
            } catch (e) {
              console.error(
                `${new Date()} The following error occurred during scheduled consumption fetch`,
                e,
              );
              return;
            }

            await this.onConsumptionData(consumptionData);
          }, delay * 1000);
        }
      }

      const nextHour = moment().add(1, 'hour').startOf('hour');
      this.log(
        `Next time to run update is at system time ${nextHour.format()}`,
      );
      const delay = moment.duration(nextHour.diff(moment()));
      this.scheduleUpdate(delay.asSeconds());

      this.log(`End update`);
    } catch (e) {
      this.log('Error fetching data', e);

      const errorCode = (e as ClientError).response?.errors?.[0]?.extensions
        ?.code;

      if (errorCode !== undefined) {
        this.log('Received error code', errorCode);
        if (errorCode === ERROR_CODE_HOME_NOT_FOUND) {
          this.log(
            `Home with id ${
              this.getData().id
            } not found. Set device unavailable`,
          );
          await this.setUnavailable(
            'Tibber home with specified id not found. Please re-add device.',
          );
          return;
        }
        if (errorCode === ERROR_CODE_UNAUTHENTICATED) {
          this.log('Invalid access token; set device unavailable.');
          await this.setUnavailable(
            'Invalid access token. Please re-add device.',
          );
          return;
        }
      }

      // Try again after a delay
      const delay = getRandomDelay(0, 5 * 60);
      this.scheduleUpdate(delay);
    }
  }

  scheduleUpdate(seconds: number) {
    this.log(`Scheduling update again in ${seconds} seconds`);
    this.homey.setTimeout(this.updateData.bind(this), seconds * 1000);
  }

  getLoggerPrefix() {
    return this.driver.getDevices().length > 1 ? `${this.#deviceLabel} ` : '';
  }

  #updateLowestAndHighestPrice(hourlyPrices: PriceInfoEntry[]) {
    const now = moment();

    this.log(
      `The current lowest price is ${this.#priceAtLowestToday?.total} at ${
        this.#priceAtLowestToday?.startsAt
      }`,
    );

    this.log(
      `The current highest price is ${this.#priceAtHighestToday?.total} at ${
        this.#priceAtHighestToday?.startsAt
      }`,
    );

    if (isSameDay(this.#priceAtLowestToday?.startsAt, now, 'Europe/Oslo')) {
      this.log("Today's lowest and highest prices are up to date");
      return;
    }

    const pricesToday = hourlyPrices.filter((p) =>
      isSameDay(p.startsAt, now, 'Europe/Oslo'),
    );

    this.#priceAtLowestToday = _.minBy(pricesToday, 'total');
    this.#priceAtHighestToday = _.maxBy(pricesToday, 'total');

    const lowestPrice = this.#priceAtLowestToday?.total ?? null;
    this.setCapabilityValue('measure_price_lowest', lowestPrice)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_price_lowest' capability to", lowestPrice);
      });

    const highestPrice = this.#priceAtHighestToday?.total ?? null;
    this.setCapabilityValue('measure_price_highest', highestPrice)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_price_highest' capability to", highestPrice);
      });
  }

  async onPriceData(hourlyPrices: PriceInfoEntry[]) {
    this.#updateLowestAndHighestPrice(hourlyPrices);

    const currentHour = moment().startOf('hour');

    const currentPrice = hourlyPrices.find((p) =>
      currentHour.isSame(moment(p.startsAt)),
    );
    if (currentPrice === undefined) {
      this.log(
        `Error finding current price info for system time ${currentHour.format()}. Abort.`,
        hourlyPrices,
      );
      return;
    }

    if (currentPrice.startsAt !== this.#latestPrice?.startsAt) {
      this.#latestPrice = currentPrice;
      this.#hourlyPrices = hourlyPrices;

      if (currentPrice.total !== null) {
        const capabilityPromises = [
          this.setCapabilityValue(
            'measure_price_total',
            Number(currentPrice.total),
          ).catch(console.error),
          this.setCapabilityValue(
            'measure_price_info_level',
            currentPrice.level,
          ).catch(console.error),
        ];

        // if the user has flow cards using the deprecated `price_total` capability, update that too, so we don't break existing cards
        if (this.#hasDeprecatedTotalPriceCapability) {
          capabilityPromises.push(
            this.setCapabilityValue(
              'price_total',
              Number(currentPrice.total),
            ).catch(console.error),
          );
        }

        // if the user has flow cards using the deprecated `price_level` capability, update that too, so we don't break existing cards
        if (this.#hasDeprecatedPriceLevelCapability) {
          capabilityPromises.push(
            this.setCapabilityValue('price_level', currentPrice.level).catch(
              console.error,
            ),
          );
        }

        // if the user has flow cards using the deprecated `measure_price_level` capability, update that too, so we don't break existing cards
        // this maps `VERY_EXPENSIVE` and `EXPENSIVE` to the old `HIGH`, and `VERY_CHEAP` and `CHEAP` to the old `LOW`
        if (this.#hasDeprecatedMeasurePriceLevelCapability) {
          const level = deprecatedPriceLevelMap[currentPrice.level];
          capabilityPromises.push(
            this.setCapabilityValue('measure_price_level', level).catch(
              console.error,
            ),
          );
        }

        await Promise.all(capabilityPromises);

        this.#priceChangedTrigger
          .trigger(this, currentPrice)
          .catch(console.error);
        this.log('Triggering price_changed', currentPrice);

        const priceLogger = await this.#createGetLog(
          `${this.#insightId}_price`,
          {
            title: `${this.getLoggerPrefix()}Current price`,
            type: 'number',
            decimals: 2,
          },
        );
        priceLogger.createEntry(currentPrice.total).catch(console.error);

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
          .trigger(this, undefined, { lowest: false })
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
            .createEntry(dailyConsumption.consumption)
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
            .createEntry(dailyConsumption.totalCost)
            .catch(console.error);
        }
      });

      if (consumptionsSinceLastReport.length > 0) {
        this.#consumptionReportTrigger
          .trigger(this, {
            consumption: Number(
              _.sumBy(consumptionsSinceLastReport, 'consumption').toFixed(2),
            ),
            totalCost: Number(
              _.sumBy(consumptionsSinceLastReport, 'totalCost').toFixed(2),
            ),
            unitCost: Number(
              _.sumBy(consumptionsSinceLastReport, 'unitCost').toFixed(2),
            ),
            unitPrice: Number(
              _.meanBy(consumptionsSinceLastReport, 'unitPrice').toFixed(2),
            ),
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
            .createEntry(hourlyConsumption.consumption)
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
            .createEntry(hourlyConsumption.totalCost)
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
      avgPriceNextHours = _(this.#hourlyPrices)
        .filter((p) =>
          hours > 0
            ? moment(p.startsAt).isAfter(now)
            : moment(p.startsAt).isBefore(now),
        )
        .take(Math.abs(hours))
        .meanBy((x) => x.total);
    } else {
      avgPriceNextHours = _(this.#hourlyPrices)
        .filter((p) => isSameDay(p.startsAt, now, 'Europe/Oslo'))
        .meanBy((x) => x.total);
    }

    if (avgPriceNextHours === undefined) {
      this.log(
        `Cannot determine condition. No prices for next hours available.`,
      );
      return false;
    }

    if (!this.#latestPrice) return false;

    let diffAvgCurrent =
      ((this.#latestPrice.total - avgPriceNextHours) / avgPriceNextHours) * 100;
    if (below) diffAvgCurrent *= -1;

    this.log(
      `${this.#latestPrice.total} is ${diffAvgCurrent}% ${
        below ? 'below' : 'above'
      } avg (${avgPriceNextHours}) ${
        hours ? `next ${hours} hours` : 'today'
      }. Condition of min ${percentage} percentage met = ${
        diffAvgCurrent > percentage
      }`,
    );
    return diffAvgCurrent > percentage;
  }

  #priceMinMaxComparer(
    options: {
      hours?: number;
      ranked_hours?: number;
    },
    { lowest }: { lowest: boolean },
  ): boolean {
    if (options.hours === 0 || options.ranked_hours === 0) return false;

    const now = moment();
    const pricesNextHours =
      options.hours !== undefined
        ? _(this.#hourlyPrices)
            .filter((p) =>
              options.hours! > 0
                ? moment(p.startsAt).isAfter(now)
                : moment(p.startsAt).isBefore(now),
            )
            .take(Math.abs(options.hours))
            .value()
        : _(this.#hourlyPrices)
            .filter((p) => isSameDay(p.startsAt, now, 'Europe/Oslo'))
            .value();

    if (!pricesNextHours.length) {
      this.log(
        `Cannot determine condition. No prices for next hours available.`,
      );
      return false;
    }

    if (this.#latestPrice === undefined) {
      this.log(`Cannot determine condition. The last price is undefined`);
      return false;
    }

    let conditionMet;
    if (options.ranked_hours !== undefined) {
      const sortedHours = _.sortBy(pricesNextHours, ['total']);
      const currentHourRank = sortedHours.findIndex(
        (p) => p.startsAt === this.#latestPrice?.startsAt,
      );
      if (currentHourRank < 0) {
        this.log(`Could not find the current hour rank among today's hours`);
        return false;
      }

      conditionMet = lowest
        ? currentHourRank < options.ranked_hours
        : currentHourRank >= sortedHours.length - options.ranked_hours;

      this.log(
        `${this.#latestPrice.total} is among the ${
          lowest ? 'lowest' : 'highest'
        } ${options.ranked_hours} hours today = ${conditionMet}`,
      );
    } else {
      const toCompare = lowest
        ? _.minBy(pricesNextHours, 'total')!.total
        : _.maxBy(pricesNextHours, 'total')!.total;

      conditionMet = lowest
        ? this.#latestPrice.total <= toCompare
        : this.#latestPrice.total >= toCompare;

      this.log(
        `${this.#latestPrice.total} is ${
          lowest ? 'lower than the lowest' : 'higher than the highest'
        } (${toCompare}) ${
          options.hours ? `among the next ${options.hours} hours` : 'today'
        } = ${conditionMet}`,
      );
    }

    return conditionMet;
  }

  #lowestPricesWithinTimeFrame({
    ranked_hours,
    start_time,
    end_time,
  }: {
    ranked_hours: number;
    start_time: TimeString;
    end_time: TimeString;
  }): boolean {
    if (ranked_hours === 0) return false;

    const now = moment().tz('Europe/Oslo');

    const nonAdjustedStart = formatTime(start_time);
    const start = nonAdjustedStart.clone().startOf('hour');

    const nonAdjustedEnd = formatTime(end_time);
    const end = nonAdjustedEnd
      .clone()
      .add(nonAdjustedStart > nonAdjustedEnd ? 1 : 0, 'day');

    console.log(start);
    console.log(end);
    if (!now.isSameOrAfter(start) || !now.isBefore(end)) {
      this.log(`Time conditions not met`);
      return false;
    }

    const pricesNextHours = this.#hourlyPrices.filter(
      (p) =>
        moment(p.startsAt).isSameOrAfter(start) &&
        moment(p.startsAt).isBefore(end),
    );

    console.log(pricesNextHours);

    if (!pricesNextHours.length) {
      this.log(
        `Cannot determine condition. No prices for next hours available.`,
      );
      return false;
    }

    if (this.#latestPrice === undefined) {
      this.log(`Cannot determine condition. The last price is undefined`);
      return false;
    }

    const sortedHours = _.sortBy(pricesNextHours, ['total']);
    const currentHourRank = sortedHours.findIndex(
      (p) => p.startsAt === this.#latestPrice?.startsAt,
    );
    if (currentHourRank < 0) {
      this.log(`Could not find the current hour rank among today's hours`);
      return false;
    }

    const conditionMet = currentHourRank < ranked_hours;

    this.log(
      `${this.#latestPrice.total} is among the lowest ${ranked_hours} 
      prices between ${nonAdjustedStart} and ${end} = ${conditionMet}`,
    );

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
