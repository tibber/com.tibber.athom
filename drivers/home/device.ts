import { Device, FlowCard, FlowCardTriggerDevice } from 'homey';
import moment from 'moment-timezone';
import { ClientError } from 'graphql-request/dist/types';
import {
  ConsumptionData,
  ConsumptionNode,
  PriceData,
  TibberApi,
} from '../../lib/tibber-api';

import { startTransaction } from '../../lib/newrelic-transaction';
import {
  randomBetweenRange,
  mean,
  sum,
  TimeString,
  getCurrentSlot,
  min,
  max,
} from '../../lib/helpers';
import {
  ERROR_CODE_HOME_NOT_FOUND,
  ERROR_CODE_UNAUTHENTICATED,
} from '../../lib/constants';
import { InsightLoggerError } from '../../lib/errors';
import {
  averagePrice,
  lowestPricesWithinTimeFrame,
  priceExtremes,
} from '../../lib/comparators';

type TransformedPriceEntry = {
  total: number;
  energy: number;
  startsAt: moment.Moment;
  level: string;
};

const deprecatedPriceLevelMap = {
  VERY_CHEAP: 'LOW',
  CHEAP: 'LOW',
  NORMAL: 'NORMAL',
  EXPENSIVE: 'HIGH',
  VERY_EXPENSIVE: 'HIGH',
};

export class HomeDevice extends Device {
  #api!: TibberApi;
  #deviceLabel!: string;
  #timeZone!: string;
  #insightId!: string;
  #prices: PriceData = { today: [] };
  #negativePriceEndsAt!: moment.Moment;
  #priceChangedTrigger!: FlowCardTriggerDevice;
  #negativePriceTrigger!: FlowCardTriggerDevice;
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
  #currentEnergyBelowCondition!: FlowCard;
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
  #currentPriceAmongLowestWithinHoursCondition!: FlowCard;
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

    this.#api = new TibberApi(this.log, this.homey.settings, homeId, token);

    if (data.address === undefined) {
      return this.setUnavailable(
        'You will need to remove and add this home as new device',
      );
    }

    this.#timeZone = this.homey.clock.getTimezone();
    this.#deviceLabel = this.getName();
    this.#insightId = this.#deviceLabel
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    this.#prices.latest = undefined;

    this.#priceChangedTrigger =
      this.homey.flow.getDeviceTriggerCard('price_changed');

    this.#negativePriceTrigger =
      this.homey.flow.getDeviceTriggerCard('negative_price');

    this.#consumptionReportTrigger =
      this.homey.flow.getDeviceTriggerCard('consumption_report');

    this.#priceBelowAvgTrigger =
      this.homey.flow.getDeviceTriggerCard('price_below_avg');
    this.#priceBelowAvgTrigger.registerRunListener(
      this.#priceAvgComparator.bind(this),
    );

    this.#priceAboveAvgTrigger =
      this.homey.flow.getDeviceTriggerCard('price_above_avg');
    this.#priceAboveAvgTrigger.registerRunListener(
      this.#priceAvgComparator.bind(this),
    );

    this.#priceBelowAvgTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_below_avg_today',
    );
    this.#priceBelowAvgTodayTrigger.registerRunListener(
      this.#priceAvgComparator.bind(this),
    );

    this.#priceAboveAvgTodayTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_above_avg_today',
    );
    this.#priceAboveAvgTodayTrigger.registerRunListener(
      this.#priceAvgComparator.bind(this),
    );

    this.#priceAtLowestTrigger =
      this.homey.flow.getDeviceTriggerCard('price_at_lowest');
    this.#priceAtLowestTrigger.registerRunListener(
      this.#priceMinMaxComparator.bind(this),
    );

    this.#priceAtHighestTrigger =
      this.homey.flow.getDeviceTriggerCard('price_at_highest');
    this.#priceAtHighestTrigger.registerRunListener(
      this.#priceMinMaxComparator.bind(this),
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
      this.#priceMinMaxComparator.bind(this),
    );

    this.#priceAmongHighestTrigger = this.homey.flow.getDeviceTriggerCard(
      'price_among_highest_today',
    );
    this.#priceAmongHighestTrigger.registerRunListener(
      this.#priceMinMaxComparator.bind(this),
    );

    this.#currentPriceBelowCondition = this.homey.flow.getConditionCard(
      'current_price_below',
    );
    this.#currentPriceBelowCondition.registerRunListener((args, _state) => {
      if (this.#prices.latest === undefined) return false;
      return args.price > Number(this.#prices.latest.total);
    });

    this.#currentEnergyBelowCondition = this.homey.flow.getConditionCard(
      'current_energy_below',
    );
    this.#currentEnergyBelowCondition.registerRunListener((args, _state) => {
      if (this.#prices.latest === undefined) return false;
      return args.energy_price > Number(this.#prices.latest.energy);
    });

    this.#currentPriceBelowAvgCondition = this.homey.flow.getConditionCard(
      'cond_price_below_avg',
    );
    this.#currentPriceBelowAvgCondition.registerRunListener((args) =>
      this.#priceAvgComparator(args, { below: true }),
    );

    this.#currentPriceAboveAvgCondition = this.homey.flow.getConditionCard(
      'cond_price_above_avg',
    );
    this.#currentPriceAboveAvgCondition.registerRunListener((args) =>
      this.#priceAvgComparator(args, { below: false }),
    );

    this.#currentPriceBelowAvgTodayCondition = this.homey.flow.getConditionCard(
      'cond_price_below_avg_today',
    );
    this.#currentPriceBelowAvgTodayCondition.registerRunListener((args) =>
      this.#priceAvgComparator(args, { below: true }),
    );

    this.#currentPriceAboveAvgTodayCondition = this.homey.flow.getConditionCard(
      'cond_price_above_avg_today',
    );
    this.#currentPriceAboveAvgTodayCondition.registerRunListener((args) =>
      this.#priceAvgComparator(args, { below: false }),
    );

    this.#currentPriceAtLowestCondition = this.homey.flow.getConditionCard(
      'cond_price_at_lowest',
    );
    this.#currentPriceAtLowestCondition.registerRunListener((args) =>
      this.#priceMinMaxComparator(args, { lowest: true }),
    );

    this.#currentPriceAtHighestCondition = this.homey.flow.getConditionCard(
      'cond_price_at_highest',
    );
    this.#currentPriceAtHighestCondition.registerRunListener((args) =>
      this.#priceMinMaxComparator(args, { lowest: false }),
    );

    this.#currentPriceAtLowestTodayCondition = this.homey.flow.getConditionCard(
      'cond_price_at_lowest_today',
    );
    this.#currentPriceAtLowestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparator(args, { lowest: true }),
    );

    this.#currentPriceAtHighestTodayCondition =
      this.homey.flow.getConditionCard('cond_price_at_highest_today');
    this.#currentPriceAtHighestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparator(args, { lowest: false }),
    );

    this.#currentPriceAmongLowestTodayCondition =
      this.homey.flow.getConditionCard('cond_price_among_lowest_today');
    this.#currentPriceAmongLowestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparator(args, { lowest: true }),
    );

    this.#currentPriceAmongHighestTodayCondition =
      this.homey.flow.getConditionCard('cond_price_among_highest_today');
    this.#currentPriceAmongHighestTodayCondition.registerRunListener((args) =>
      this.#priceMinMaxComparator(args, { lowest: false }),
    );

    this.#currentPriceAmongLowestWithinHoursCondition =
      this.homey.flow.getConditionCard('price_among_lowest_during_hours');
    this.#currentPriceAmongLowestWithinHoursCondition.registerRunListener(
      (args) => this.#priceMinMaxComparator(args, { lowest: true }),
    );

    this.#currentPriceAmongLowestWithinTimeFrameCondition =
      this.homey.flow.getConditionCard('price_among_lowest_during_time');
    this.#currentPriceAmongLowestWithinTimeFrameCondition.registerRunListener(
      (args) => this.#lowestPricesWithinTimeFrame(args),
    );

    this.#sendPushNotificationAction = this.homey.flow.getActionCard(
      'sendPushNotification',
    );
    this.#sendPushNotificationAction.registerRunListener(async (args) =>
      this.#api.sendPush(args.title, args.message),
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

    if (!this.hasCapability('measure_price_average'))
      await this.addCapability('measure_price_average');

    if (!this.hasCapability('measure_price_lowest'))
      await this.addCapability('measure_price_lowest');

    if (!this.hasCapability('measure_price_highest'))
      await this.addCapability('measure_price_highest');

    if (!this.hasCapability('measure_energy_current'))
      await this.addCapability('measure_energy_current');

    if (!this.hasCapability('measure_energy_average'))
      await this.addCapability('measure_energy_average');

    if (!this.hasCapability('measure_energy_lowest'))
      await this.addCapability('measure_energy_lowest');

    if (!this.hasCapability('measure_energy_highest'))
      await this.addCapability('measure_energy_highest');

    if (!this.hasCapability('measure_negative_price_time_remaining'))
      await this.addCapability('measure_negative_price_time_remaining');

    if (!this.hasCapability('time_price_lowest'))
      await this.addCapability('time_price_lowest');

    if (!this.hasCapability('time_price_highest'))
      await this.addCapability('time_price_highest');

    this.log(`Tibber home device ${this.getName()} has been initialized`);
    await this.#updateData();
    this.#negativeEnergyTimeUpdater();
    return undefined;
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

  async #updateData() {
    try {
      this.log(`Begin update`);

      await startTransaction('GetPriceInfo', 'API', () =>
        this.#api.populateCachedPriceInfos((callback, ms, args) =>
          this.homey.setTimeout(callback, ms, args),
        ),
      );

      const now = moment();

      try {
        await this.#handlePrice(now);
      } catch (err) {
        console.error(err);
      }

      if (this.#isConsumptionReportEnabled()) {
        this.log(`Consumption report enabled. Begin update`);
        await this.#generateConsumptionReport(now);
      }

      // calculate time to next 15 min slot
      const minutesToAdd = (15 - (now.minute() % 15)) % 15 || 15;
      const nextUpdateTime = now
        .clone()
        .add(minutesToAdd, 'minutes') // jump to next 15-min slot
        .startOf('minute')
        .add(randomBetweenRange(0, 3), 'seconds'); // add small jitter

      this.log(
        `Next time to run update is at system time ${nextUpdateTime.format()}`,
      );
      const delay = moment.duration(nextUpdateTime.diff(moment()));
      this.#scheduleUpdate(delay.asSeconds());

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
      const delay = randomBetweenRange(0, 5 * 60);
      this.#scheduleUpdate(delay);
    }
  }

  async #handlePrice(now: moment.Moment) {
    this.#prices.today = this.#api.quarterPrices
      .filter((p) => p.startsAt.tz(this.#timeZone).isSame(now, 'day'))
      .sort((a, b) => a.startsAt.diff(b.startsAt));

    // NOTE: this also updates capability values
    this.#updateLowestAndHighestPrice(now);

    const currentSlot = getCurrentSlot(now);

    const currentPrice = this.#prices.today.find((p) =>
      currentSlot.isSame(p.startsAt),
    );

    if (currentPrice === undefined) {
      this.log(
        `Error finding current price info for system time ${currentSlot.format()}. Abort.`,
        this.#prices.today,
      );
      return;
    }

    await this.homey.api.realtime('data-update-event', {
      driverId: 'home',
      deviceId: this.getData().id,
      now,
      currentSlot,
      currentPrice,
      lowestToday: this.#prices.lowestToday,
      highestToday: this.#prices.highestToday,
      pricesToday: this.#prices.today,
      quarterPrices: this.#api.quarterPrices,
    });

    const shouldUpdate =
      currentPrice.startsAt !== this.#prices.latest?.startsAt;

    if (shouldUpdate) {
      const turnNegative =
        currentPrice.energy < 0 && (this.#prices.latest?.energy ?? 0) >= 0;
      this.#prices.latest = currentPrice;

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
          this.setCapabilityValue(
            'measure_energy_current',
            Number(currentPrice.energy),
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

        if (turnNegative) {
          let diffHoursRounded = 0;
          const nextPrice = this.#prices.today.find(
            (price) =>
              price.startsAt.isAfter(currentPrice.startsAt) &&
              price.energy >= 0,
          );
          if (nextPrice) {
            this.#negativePriceEndsAt = nextPrice.startsAt.clone();
            const diffMinutesPrecise = moment
              .duration(nextPrice.startsAt.diff(now))
              .asMinutes();
            diffHoursRounded = Math.round(diffMinutesPrecise / 15) / 4;
            this.log(
              `Next non-negative energy price starts at ${nextPrice.startsAt.format()} which is in ${diffHoursRounded.toFixed(
                2,
              )} hour(s) from now.`,
            );
          } else {
            // No upcoming non-negative energy price, so compute time to midnight
            const midnight = now.clone().add(1, 'day').startOf('day');
            this.#negativePriceEndsAt = midnight;
            const diffMinutesPrecise = moment
              .duration(midnight.diff(now))
              .asMinutes();
            diffHoursRounded = Math.round(diffMinutesPrecise / 15) / 4;
            this.log(
              `No upcoming non-negative energy price found. Time to midnight: ${diffHoursRounded.toFixed(
                2,
              )} hour(s).`,
            );
          }
          this.#negativePriceTrigger
            .trigger(this, {
              duration: diffHoursRounded,
            })
            .catch(console.error);
          this.log('Triggering negative_price, duration: ', diffHoursRounded);
        }

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

        if (this.#priceMinMaxComparator({}, { lowest: true })) {
          this.#priceAtLowestTodayTrigger
            .trigger(this, undefined, { lowest: true })
            .catch(console.error);
        }

        if (this.#priceMinMaxComparator({}, { lowest: false })) {
          this.#priceAtHighestTodayTrigger
            .trigger(this, undefined, { lowest: false })
            .catch(console.error);
        }

        try {
          const priceLogger = await this.#createGetLog(
            `${this.#insightId}_price`,
            {
              title: `${this.#getLoggerPrefix()}Current price`,
              type: 'number',
              decimals: 2,
            },
          );
          priceLogger.createEntry(currentPrice.total).catch(console.error);
        } catch (err) {
          const error = new InsightLoggerError(
            `Failing priceLogger. Insight id: ${
              this.#insightId
            }_price. Error: ${err}`,
          );
          console.error(error.message);
        }
      }
    }
    this.#updateNegativeEnergyTime(now, currentPrice);
  }

  #updateNegativeEnergyTime(
    now: moment.Moment,
    currentPrice: TransformedPriceEntry,
  ) {
    const negativeTimeLeft =
      currentPrice.energy < 0 && this.#negativePriceEndsAt
        ? Math.max(
            Math.round(
              moment.duration(this.#negativePriceEndsAt.diff(now)).asMinutes(),
            ),
            0,
          )
        : 0;
    this.setCapabilityValue(
      'measure_negative_price_time_remaining',
      negativeTimeLeft,
    ).catch(console.error);
    this.log(
      'Set measure_negative_price_time_remaining capability to ',
      negativeTimeLeft,
    );
  }

  // Call updateNegativeEnergyTime every minute using the latest price info
  #negativeEnergyTimeUpdater(): void {
    const scheduleNextMinute = () => {
      const now = moment();
      const msToNextMinute =
        60000 - (now.seconds() * 1000 + now.milliseconds());

      this.homey.setTimeout(() => {
        if (this.#prices.latest)
          this.#updateNegativeEnergyTime(moment(), this.#prices.latest);

        // Now start fixed 60s interval from the aligned point
        this.homey.setInterval(() => {
          if (this.#prices.latest)
            this.#updateNegativeEnergyTime(moment(), this.#prices.latest);
        }, 60000);
      }, msToNextMinute);
    };

    scheduleNextMinute();
  }

  #updateLowestAndHighestPrice(now: moment.Moment) {
    this.log(
      `The current lowest price is ${this.#prices.lowestToday?.total} at ${
        this.#prices.lowestToday?.startsAt
      }`,
    );

    this.log(
      `The current highest price is ${this.#prices.highestToday?.total} at ${
        this.#prices.highestToday?.startsAt
      }`,
    );

    if (this.#prices.lowestToday?.startsAt.isSame(now, 'day')) {
      this.log("Today's lowest and highest prices are up to date");
      return;
    }

    this.#prices.lowestToday = min(this.#prices.today, (p) => p.total);
    this.#prices.highestToday = max(this.#prices.today, (p) => p.total);

    const avgPrice = mean(this.#prices.today, (item) => item.total);
    this.setCapabilityValue('measure_price_average', avgPrice)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_price_average' capability to", avgPrice);
      });

    const avgEnergy = mean(this.#prices.today, (item) => item.energy);
    this.setCapabilityValue('measure_energy_average', avgEnergy)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_energy_average' capability to", avgEnergy);
      });

    const lowestPrice = this.#prices.lowestToday?.total ?? null;
    this.setCapabilityValue('measure_price_lowest', lowestPrice)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_price_lowest' capability to", lowestPrice);
      });

    const lowestEnergy = this.#prices.lowestToday?.energy ?? null;
    this.setCapabilityValue('measure_energy_lowest', lowestEnergy)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_energy_lowest' capability to", lowestEnergy);
      });

    const highestPrice = this.#prices.highestToday?.total ?? null;
    this.setCapabilityValue('measure_price_highest', highestPrice)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_price_highest' capability to", highestPrice);
      });

    const highestEnergy = this.#prices.highestToday?.energy ?? null;
    this.setCapabilityValue('measure_energy_highest', highestEnergy)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'measure_energy_highest' capability to", highestEnergy);
      });

    const lowestTime = this.#prices.lowestToday?.startsAt
      ? this.#prices.lowestToday.startsAt.tz(this.#timeZone).format('HH:mm')
      : null;
    this.setCapabilityValue('time_price_lowest', lowestTime)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'time_price_lowest' capability to", lowestTime);
      });

    const highestTime = this.#prices.highestToday?.startsAt
      ? this.#prices.highestToday.startsAt.tz(this.#timeZone).format('HH:mm')
      : null;
    this.setCapabilityValue('time_price_highest', highestTime)
      .catch(console.error)
      .finally(() => {
        this.log("Set 'time_price_highest' capability to", highestTime);
      });
  }

  async #generateConsumptionReport(now: moment.Moment) {
    const lastLoggedDailyConsumption = this.#getLastLoggedDailyConsumption();
    let daysToFetch = 14;

    if (lastLoggedDailyConsumption) {
      const durationSinceLastDailyConsumption = moment.duration(
        now.diff(moment(lastLoggedDailyConsumption)),
      );
      daysToFetch = Math.floor(durationSinceLastDailyConsumption.asDays());
    }

    const lastLoggedHourlyConsumption = this.#getLastLoggedHourlyConsumption();

    let hoursToFetch = 200;
    if (lastLoggedHourlyConsumption) {
      const durationSinceLastHourlyConsumption = moment.duration(
        now.diff(moment(lastLoggedHourlyConsumption)),
      );
      hoursToFetch = Math.floor(durationSinceLastHourlyConsumption.asHours());
    }

    this.log(
      `Last logged daily consumption at ${lastLoggedDailyConsumption} hourly consumption at ${lastLoggedHourlyConsumption}. Fetch ${daysToFetch} days ${hoursToFetch} hours`,
    );

    if (!lastLoggedDailyConsumption || !lastLoggedHourlyConsumption) {
      const consumptionData = await startTransaction(
        'GetConsumption',
        'API',
        () => this.#api.getConsumptionData(daysToFetch, hoursToFetch),
      );

      await this.#logConsumptionInsightsAndInvokeTrigger(consumptionData);
    } else if (!hoursToFetch && !daysToFetch) {
      this.log(`Consumption data up to date. Skip fetch.`);
    } else {
      const delay = randomBetweenRange(0, 59 * 60);
      this.log(
        `Schedule consumption fetch for ${daysToFetch} days ${hoursToFetch} hours after ${delay} seconds.`,
      );
      this.homey.setTimeout(async () => {
        let consumptionData;
        try {
          consumptionData = await startTransaction(
            'ScheduledGetConsumption',
            'API',
            () => this.#api.getConsumptionData(daysToFetch, hoursToFetch),
          );
        } catch (e) {
          console.error(
            'The following error occurred during scheduled consumption fetch',
            e,
          );
          return;
        }

        await this.#logConsumptionInsightsAndInvokeTrigger(consumptionData);
      }, delay * 1000);
    }
  }

  async #logConsumptionInsightsAndInvokeTrigger(data: ConsumptionData) {
    try {
      const lastLoggedDailyConsumption = this.#getLastLoggedDailyConsumption();
      const consumptionsSinceLastReport: ConsumptionNode[] = [];
      const dailyConsumptions: ConsumptionNode[] =
        data.viewer.home?.daily?.nodes ?? [];

      await Promise.all(
        dailyConsumptions.map(async (dailyConsumption) => {
          if (dailyConsumption.consumption === null) return;

          if (
            lastLoggedDailyConsumption &&
            moment(dailyConsumption.to) <= moment(lastLoggedDailyConsumption)
          )
            return;

          consumptionsSinceLastReport.push(dailyConsumption);
          this.#setLastLoggedDailyConsumption(dailyConsumption.to);

          this.log('Got daily consumption', dailyConsumption);
          const consumptionLogger = await this.#createGetLog(
            `${this.#insightId}_dailyConsumption`,
            {
              title: `${this.#getLoggerPrefix()}Daily consumption`,
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
              title: `${this.#getLoggerPrefix()}Daily total cost`,
              type: 'number',
              decimals: 1,
            },
          );
          costLogger
            .createEntry(dailyConsumption.totalCost)
            .catch(console.error);
        }),
      );

      if (consumptionsSinceLastReport.length > 0) {
        this.#consumptionReportTrigger
          .trigger(this, {
            consumption: Number(
              sum(consumptionsSinceLastReport, (c) => c.consumption).toFixed(2),
            ),
            totalCost: Number(
              sum(consumptionsSinceLastReport, (c) => c.totalCost).toFixed(2),
            ),
            unitCost: Number(
              sum(consumptionsSinceLastReport, (c) => c.unitCost).toFixed(2),
            ),
            unitPrice: Number(
              mean(consumptionsSinceLastReport, (c) => c.unitPrice).toFixed(2),
            ),
          })
          .catch(console.error);
      }
    } catch (e) {
      console.error('Error logging daily consumption', e);
    }

    try {
      const lastLoggedHourlyConsumption =
        this.#getLastLoggedHourlyConsumption();
      const hourlyConsumptions = data.viewer.home?.hourly?.nodes ?? [];

      await Promise.all(
        hourlyConsumptions.map(async (hourlyConsumption) => {
          if (hourlyConsumption.consumption === null) return;

          if (
            lastLoggedHourlyConsumption &&
            moment(hourlyConsumption.to) <= moment(lastLoggedHourlyConsumption)
          )
            return;

          this.#setLastLoggedHourlyConsumption(hourlyConsumption.to);

          this.log('Got hourly consumption', hourlyConsumption);
          const consumptionLogger = await this.#createGetLog(
            `${this.#insightId}hourlyConsumption`,
            {
              title: `${this.#getLoggerPrefix()}Hourly consumption`,
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
              title: `${this.#getLoggerPrefix()}Hourly total cost`,
              type: 'number',
              decimals: 1,
            },
          );
          costLogger
            .createEntry(hourlyConsumption.totalCost)
            .catch(console.error);
        }),
      );
    } catch (e) {
      console.error('Error logging hourly consumption', e);
    }
  }

  #getLastLoggedDailyConsumption(): string {
    return this.homey.settings.get(
      `${this.#insightId}_lastLoggedDailyConsumption`,
    );
  }

  #setLastLoggedDailyConsumption(value: string) {
    this.homey.settings.set(
      `${this.#insightId}_lastLoggedDailyConsumption`,
      value,
    );
  }

  #getLastLoggedHourlyConsumption(): string {
    return this.homey.settings.get(
      `${this.#insightId}_lastLoggerHourlyConsumption`,
    );
  }

  #setLastLoggedHourlyConsumption(value: string) {
    this.homey.settings.set(
      `${this.#insightId}_lastLoggerHourlyConsumption`,
      value,
    );
  }

  #priceAvgComparator(
    options: { hours: number; percentage: number },
    args: { below: boolean },
  ): boolean {
    const now = moment();
    return averagePrice(
      this.log,
      this.#api.quarterPrices,
      this.#prices,
      now,
      options,
      args,
    );
  }

  #priceMinMaxComparator(
    options: {
      hours?: number;
      ranked_slots?: number;
    },
    args: { lowest: boolean },
  ): boolean {
    const now = moment();
    return priceExtremes(
      this.log,
      this.#api.quarterPrices,
      this.#prices,
      now,
      options,
      args,
    );
  }

  #lowestPricesWithinTimeFrame(options: {
    ranked_slots: number;
    start_time: TimeString;
    end_time: TimeString;
  }): boolean {
    const now = moment().tz(this.#timeZone);
    return lowestPricesWithinTimeFrame(
      this.log,
      this.#api.quarterPrices,
      this.#prices,
      now,
      options,
    );
  }

  #scheduleUpdate(seconds: number) {
    this.log(`Scheduling update again in ${seconds} seconds`);
    this.homey.setTimeout(this.#updateData.bind(this), seconds * 1000);
  }

  #getLoggerPrefix() {
    return this.driver.getDevices().length > 1 ? `${this.#deviceLabel} ` : '';
  }

  #isConsumptionReportEnabled() {
    return this.getSetting('enable_consumption_report') || false;
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

  getDeviceData() {
    const now = moment();
    const currentSlot = getCurrentSlot(now);
    const currentPrice =
      this.#prices.today.find((p) => currentSlot.isSame(p.startsAt)) || 0;

    return {
      driverId: 'home',
      deviceId: this.getData().id,
      now,
      currentSlot,
      currentPrice,
      lowestToday: this.#prices.lowestToday,
      highestToday: this.#prices.highestToday,
      pricesToday: this.#prices.today,
      quarterPrices: this.#api.quarterPrices,
    };
  }
}

module.exports = HomeDevice;
