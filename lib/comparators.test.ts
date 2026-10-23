import each from 'jest-each';
import moment from 'moment-timezone';
import { lowestPricesWithinTimeFrame, priceExtremes } from './comparators';
import { PriceData, TransformedPriceEntry } from './tibber-api';

const logger = () => {};

const yesterday = '2023-01-31T00:00:00+01:00';
const today = '2023-02-01T00:00:00+01:00';
const tomorrow = '2023-02-02T00:00:00+01:00';

const hourlyPrices: TransformedPriceEntry[] = [];
for (const day of [yesterday, today, tomorrow]) {
  const startsAt = moment(day);
  let valueBase = 1;
  for (let hour = 0; hour < 24; hour += 1) {
    hourlyPrices.push({
      startsAt: startsAt.clone(),
      total: hour + valueBase,
      energy: hour + valueBase,
      tax: hour + valueBase,
      level: 'NORMAL',
    });
    startsAt.add(1, 'hour');
  }
  valueBase += 10;
}

const priceData = (now: moment.Moment): PriceData => ({
  today: hourlyPrices.slice(24, 48),
  latest: hourlyPrices.find((p) => p.startsAt.isSame(now, 'hour')),
  lowestToday: hourlyPrices[24],
  highestToday: hourlyPrices[47],
});

describe('comparators', () => {
  describe('averagePrice', () => {
    describe('below avg', () => {
      test('today', () => {
        expect(true);
      });

      test('for the next X hours', () => {
        expect(true);
      });
    });
  });

  describe('priceExtremes', () => {
    describe('today', () => {
      each`
        now                            | expectedLowest | expectedHighest
        ${'2023-02-01T00:17:06+01:00'} | ${true}        | ${false}
        ${'2023-02-01T02:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T04:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T06:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T08:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T10:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T12:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T16:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T18:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T20:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T22:17:06+01:00'} | ${false}       | ${false}
        ${'2023-02-01T23:17:06+01:00'} | ${false}       | ${true}
      `.describe('today: $now', ({ now, expectedLowest, expectedHighest }) => {
        test('lowest', () => {
          const actual = priceExtremes(
            logger,
            hourlyPrices,
            priceData(now),
            now,
            {},
            { lowest: true },
          );
          expect(actual).toBe(expectedLowest);
        });

        test('highest', () => {
          const actual = priceExtremes(
            logger,
            hourlyPrices,
            priceData(now),
            now,
            {},
            { lowest: false },
          );
          expect(actual).toBe(expectedHighest);
        });
      });

      test('for the next X hours', () => {
        const timeTodayWithLowestPrice = moment('2023-02-01T00:32:27+01:00');
        const actual = priceExtremes(
          logger,
          hourlyPrices,
          priceData(timeTodayWithLowestPrice),
          timeTodayWithLowestPrice,
          { hours: 3 },
          { lowest: false },
        );
        expect(actual).toBe(false);
      });

      test('among the X for the next Y hours', () => {
        const timeTodayWithLowestPrice = moment('2023-02-01T00:32:27+01:00');
        const actual = priceExtremes(
          logger,
          hourlyPrices,
          priceData(timeTodayWithLowestPrice),
          timeTodayWithLowestPrice,
          { ranked_hours: 3, hours: 12 },
          { lowest: false },
        );
        expect(actual).toBe(false);
      });

      test('ranked hours still match when latest.startsAt is a cloned Moment', () => {
        // Scheduled price re-fetch replaces hourlyPrices with new Moment
        // instances. latest still points at the previous object for the same hour.
        const now = moment('2023-02-01T00:17:06+01:00');
        const data = priceData(now);
        data.latest = {
          ...data.latest!,
          startsAt: data.latest!.startsAt.clone(),
        };

        const actual = priceExtremes(
          logger,
          hourlyPrices,
          data,
          now,
          { ranked_hours: 1 },
          { lowest: true },
        );
        expect(actual).toBe(true);
      });
    });
  });

  describe('lowestPricesWithinTimeFrame', () => {
    test('still matches after price refresh clones Moment instances', () => {
      // Mid-day Oslo so the 00:00–23:59 window always contains `now`
      // (parseTimeString builds start/end on the current local date).
      const now = moment.tz('Europe/Oslo').startOf('day').hour(12).minute(17);
      const prices: TransformedPriceEntry[] = [];
      for (let hour = 0; hour < 24; hour += 1) {
        prices.push({
          startsAt: now.clone().startOf('day').hour(hour),
          total: hour === now.hour() ? 0.01 : hour + 1,
          energy: hour + 1,
          tax: 0,
          level: 'NORMAL',
        });
      }
      const current = prices.find((p) => p.startsAt.isSame(now, 'hour'))!;
      const data: PriceData = {
        today: prices,
        latest: { ...current, startsAt: current.startsAt.clone() },
      };

      const actual = lowestPricesWithinTimeFrame(logger, prices, data, now, {
        ranked_hours: 1,
        start_time: '00:00',
        end_time: '23:59',
      });
      expect(actual).toBe(true);
    });
  });
});
