import moment from 'moment-timezone';
import { priceExtremes } from './comparators';
import { PriceData, TransformedPriceEntry } from './api';

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

const priceData = (latestIndex: number): PriceData => ({
  today: hourlyPrices.slice(24, 48),
  latest: hourlyPrices[latestIndex],
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
    describe('lowest', () => {
      test('today', () => {
        const timeTodayWithLowestPrice = moment('2023-02-01T00:32:27+01:00');
        const actual = priceExtremes(
          logger,
          hourlyPrices,
          priceData(0),
          timeTodayWithLowestPrice,
          {},
          { lowest: true },
        );
        expect(actual).toBe(true);
      });

      test('for the next X hours', () => {
        const timeTodayWithLowestPrice = moment('2023-02-01T00:32:27+01:00');
        const actual = priceExtremes(
          logger,
          hourlyPrices,
          priceData(0),
          timeTodayWithLowestPrice,
          { hours: 3 },
          { lowest: true },
        );
        expect(actual).toBe(true);
      });

      test('among the X for the next Y hours', () => {
        const timeTodayWithLowestPrice = moment('2023-02-01T00:32:27+01:00');
        const actual = priceExtremes(
          logger,
          hourlyPrices,
          priceData(0),
          timeTodayWithLowestPrice,
          { ranked_hours: 3, hours: 12 },
          { lowest: true },
        );
        expect(actual).toBe(false);
      });
    });
  });
});
