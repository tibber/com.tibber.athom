import moment from 'moment-timezone';
import { sort } from 'fast-sort';
import { PriceData, TransformedPriceEntry } from './tibber-api';
import {
  max,
  mean,
  min,
  parseTimeString,
  takeFromStartOrEnd,
  TimeString,
} from './helpers';

export interface AveragePriceOptions {
  hours: number;
  percentage: number;
}

export interface AveragePriceArguments {
  below: boolean;
}

const SLOTS_PER_HOUR = 4;

export const averagePrice = (
  logger: (...args: unknown[]) => void,
  quarterPrices: readonly TransformedPriceEntry[],
  priceData: PriceData,
  now: moment.Moment,
  options: AveragePriceOptions,
  { below }: AveragePriceArguments,
): boolean => {
  const { hours, percentage } = options;
  if (hours === 0) return false;

  const slotCount = Math.floor(hours * SLOTS_PER_HOUR);

  const prices =
    hours !== undefined
      ? takeFromStartOrEnd(
          quarterPrices.filter((p) =>
            hours! > 0 ? p.startsAt.isAfter(now) : p.startsAt.isBefore(now),
          ),
          slotCount,
        )
      : priceData.today;

  const avgPrice = mean(prices, (item) => item.total);

  if (Number.isNaN(avgPrice)) {
    logger(`Cannot determine condition. No prices for next slots available.`);
    return false;
  }

  if (!priceData.latest) return false;

  let diffAvgCurrent = ((priceData.latest.total - avgPrice) / avgPrice) * 100;
  if (below) diffAvgCurrent *= -1;

  logger(
    `${priceData.latest.total} is ${diffAvgCurrent}% ${
      below ? 'below' : 'above'
    } avg (${avgPrice}) ${
      hours ? `next ${hours} hours` : 'today'
    }. Condition of min ${percentage} percentage met = ${
      diffAvgCurrent > percentage
    }`,
  );
  return diffAvgCurrent > percentage;
};

export interface PriceExtremesOptions {
  hours?: number;
  ranked_slots?: number;
}

export interface PriceExtremesArguments {
  lowest: boolean;
}

export const priceExtremes = (
  logger: (...args: unknown[]) => void,
  quarterPrices: readonly TransformedPriceEntry[],
  priceData: PriceData,
  now: moment.Moment,
  options: PriceExtremesOptions,
  { lowest }: PriceExtremesArguments,
): boolean => {
  const { hours, ranked_slots: rankedSlots } = options;
  if (hours === 0 || rankedSlots === 0) return false;

  const slotCount = hours ? hours * SLOTS_PER_HOUR : undefined;
  const currentSlot = now.clone().startOf('minute');
  currentSlot.minutes(Math.floor(currentSlot.minutes() / 15) * 15);


  const prices =
    slotCount !== undefined
      ? takeFromStartOrEnd(
          quarterPrices.filter((p) =>
            hours! > 0 ? p.startsAt.isSameOrAfter(currentSlot) : p.startsAt.isSameOrBefore(currentSlot),
          ),
          slotCount,
        )
      : priceData.today;

  if (!prices.length) {
    logger(`Cannot determine condition. No prices for next slots available.`);
    return false;
  }

  if (!priceData.latest) {
    logger(`Cannot determine condition. The last price is undefined`);
    return false;
  }

  let conditionMet;
  if (rankedSlots !== undefined) {
    const sortedPrices = sort(prices).asc((p) => p.total);
    const currentSlotRank = sortedPrices.findIndex((p) =>
      p.startsAt.isSame(priceData.latest!.startsAt),
    );

    if (currentSlotRank < 0) {
      logger(`Could not find the current slot rank among today's slots`);
      return false;
    }

    conditionMet = lowest
      ? currentSlotRank < rankedSlots
      : currentSlotRank >= sortedPrices.length - rankedSlots;

    logger(
      `${priceData.latest.total} is among the ${
        lowest ? 'lowest' : 'highest'
      } ${rankedSlots} slots today = ${conditionMet}`,
    );
  } else {
    const toCompare = lowest
      ? min(prices, (p) => p.total)!.total
      : max(prices, (p) => p.total)!.total;

    conditionMet = lowest
      ? priceData.latest.total <= toCompare
      : priceData.latest.total >= toCompare;

    logger(
      `${priceData.latest.total} is ${
        lowest ? 'lower than the lowest' : 'higher than the highest'
      } (${toCompare}) ${
        hours ? `among the next ${hours} hours` : 'today'
      } = ${conditionMet}`,
    );
  }

  return conditionMet;
};

export interface LowestPricesWithinTimeFrameOptions {
  ranked_slots: number;
  start_time: TimeString;
  end_time: TimeString;
}

export const lowestPricesWithinTimeFrame = (
  logger: (...args: unknown[]) => void,
  quarterPrices: readonly TransformedPriceEntry[],
  priceData: PriceData,
  now: moment.Moment,
  options: LowestPricesWithinTimeFrameOptions,
): boolean => {
  const {
    ranked_slots: rankedSlots,
    start_time: startTime,
    end_time: endTime,
  } = options;

  if (rankedSlots === 0) return false;

  const timeZone = now.tz() || 'Europe/Oslo';
  const nonAdjustedStart = parseTimeString(startTime, timeZone);
  let start = nonAdjustedStart;

  const nonAdjustedEnd = parseTimeString(endTime, timeZone);
  let end = nonAdjustedEnd;

  const periodStretchesOverMidnight = nonAdjustedStart.isAfter(nonAdjustedEnd);
  const adjustStartToYesterday = now.isBefore(nonAdjustedEnd);
  const adjustEndToTomorrow = now.isAfter(nonAdjustedEnd);

  if (periodStretchesOverMidnight) {
    start = nonAdjustedStart
      .clone()
      .subtract(adjustStartToYesterday ? 1 : 0, 'day');
    end = nonAdjustedEnd.clone().add(adjustEndToTomorrow ? 1 : 0, 'day');
  }

  if (!now.isSameOrAfter(start) || !now.isBefore(end)) {
    logger(`Time conditions not met`);
    return false;
  }

  const pricesWithinTimeFrame = quarterPrices.filter(
    (p) => p.startsAt.isSameOrAfter(start) && p.startsAt.isBefore(end),
  );

  if (!pricesWithinTimeFrame.length) {
    logger(`Cannot determine condition. No prices in the time window.`);
    return false;
  }

  if (!priceData.latest) {
    logger(`Cannot determine condition. The last price is undefined`);
    return false;
  }

  const sortedSlots = sort(pricesWithinTimeFrame).asc((p) => p.total);
  const currentSlotRank = sortedSlots.findIndex((p) =>
    p.startsAt.isSame(priceData.latest!.startsAt),
  );

  if (currentSlotRank < 0) {
    logger(`Could not find the current slot rank among window prices`);
    return false;
  }

  const conditionMet = currentSlotRank < rankedSlots;

  logger(
    `${priceData.latest.total} is among the lowest ${rankedSlots}
      prices between ${start} and ${end} = ${conditionMet}`,
  );

  return conditionMet;
};
