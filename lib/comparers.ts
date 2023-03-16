import moment from 'moment-timezone';
import { sort } from 'fast-sort';
import { PriceData, TransformedPriceEntry } from './api';
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

export const averagePrice = (
  logger: (...args: unknown[]) => void,
  hourlyPrices: readonly TransformedPriceEntry[],
  priceData: PriceData,
  options: AveragePriceOptions,
  { below }: AveragePriceArguments,
): boolean => {
  const { hours, percentage } = options;
  if (hours === 0) return false;

  const now = moment();
  const prices =
    hours !== undefined
      ? takeFromStartOrEnd(
          hourlyPrices.filter((p) =>
            hours! > 0
              ? p.startsAt.isAfter(now)
              : p.startsAt.isBefore(now, 'hour'),
          ),
          hours,
        )
      : priceData.today;

  const avgPrice = mean(prices, (item) => item.total);

  if (Number.isNaN(avgPrice)) {
    logger(`Cannot determine condition. No prices for next hours available.`);
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

export interface MinMaxPriceOptions {
  hours?: number;
  ranked_hours?: number;
}

export interface MinMaxPriceArguments {
  lowest: boolean;
}

export const minMaxPrice = (
  logger: (...args: unknown[]) => void,
  hourlyPrices: readonly TransformedPriceEntry[],
  priceData: PriceData,
  options: MinMaxPriceOptions,
  { lowest }: MinMaxPriceArguments,
): boolean => {
  const { hours, ranked_hours: rankedHours } = options;
  if (hours === 0 || rankedHours === 0) return false;

  const now = moment();

  const prices =
    hours !== undefined
      ? takeFromStartOrEnd(
          hourlyPrices.filter((p) =>
            hours! > 0
              ? p.startsAt.isAfter(now)
              : p.startsAt.isBefore(now, 'hour'),
          ),
          hours,
        )
      : priceData.today;

  if (!prices.length) {
    logger(`Cannot determine condition. No prices for next hours available.`);
    return false;
  }

  if (priceData.latest === undefined) {
    logger(`Cannot determine condition. The last price is undefined`);
    return false;
  }

  let conditionMet;
  if (rankedHours !== undefined) {
    const sortedPrices = sort(prices).asc((p) => p.total);
    const currentHourRank = sortedPrices.findIndex(
      (p) => p.startsAt === priceData.latest?.startsAt,
    );
    if (currentHourRank < 0) {
      logger(`Could not find the current hour rank among today's hours`);
      return false;
    }

    conditionMet = lowest
      ? currentHourRank < rankedHours
      : currentHourRank >= sortedPrices.length - rankedHours;

    logger(
      `${priceData.latest.total} is among the ${
        lowest ? 'lowest' : 'highest'
      } ${options.ranked_hours} hours today = ${conditionMet}`,
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
        options.hours ? `among the next ${options.hours} hours` : 'today'
      } = ${conditionMet}`,
    );
  }

  return conditionMet;
};

export interface LowestPricesWithinTimeFrameOptions {
  ranked_hours: number;
  start_time: TimeString;
  end_time: TimeString;
}

export const lowestPricesWithinTimeFrame = (
  logger: (...args: unknown[]) => void,
  hourlyPrices: readonly TransformedPriceEntry[],
  priceData: PriceData,
  options: LowestPricesWithinTimeFrameOptions,
): boolean => {
  const {
    ranked_hours: rankedHours,
    start_time: startTime,
    end_time: endTime,
  } = options;

  if (rankedHours === 0) return false;

  const now = moment().tz('Europe/Oslo');

  const nonAdjustedStart = parseTimeString(startTime);
  let start = nonAdjustedStart;

  const nonAdjustedEnd = parseTimeString(endTime);
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

  const pricesWithinTimeFrame = hourlyPrices.filter(
    (p) => p.startsAt.isSameOrAfter(start, 'hour') && p.startsAt.isBefore(end),
  );

  if (!pricesWithinTimeFrame.length) {
    logger(`Cannot determine condition. No prices for next hours available.`);
    return false;
  }

  if (priceData.latest === undefined) {
    logger(`Cannot determine condition. The last price is undefined`);
    return false;
  }

  const sortedHours = sort(pricesWithinTimeFrame).asc((p) => p.total);
  const currentHourRank = sortedHours.findIndex(
    (p) => p.startsAt === priceData.latest?.startsAt,
  );
  if (currentHourRank < 0) {
    logger(`Could not find the current hour rank among today's hours`);
    return false;
  }

  const conditionMet = currentHourRank < rankedHours;

  logger(
    `${priceData.latest.total} is among the lowest ${rankedHours}
      prices between ${start} and ${end} = ${conditionMet}`,
  );

  return conditionMet;
};
