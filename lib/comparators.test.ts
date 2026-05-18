import each from 'jest-each';
import moment from 'moment-timezone';
import { priceExtremes } from './comparators';
import { PriceData, TransformedPriceEntry } from './tibber-api';

const logger = () => {};

const yesterday = '2023-01-31T00:00:00+01:00';
const today = '2023-02-01T00:00:00+01:00';
const tomorrow = '2023-02-02T00:00:00+01:00';

const quarterHourlyPrices: TransformedPriceEntry[] = [];

for (const [dayOffset, day] of [yesterday, today, tomorrow].entries()) {
  const startsAt = moment(day);
  const valueBase = 1 + dayOffset * 100; // Different base for each day to ensure uniqueness
  for (let i = 0; i < 96; i += 1) {
    quarterHourlyPrices.push({
      startsAt: startsAt.clone(),
      total: valueBase + i,
      energy: valueBase + i,
      tax: valueBase + i,
      level: 'NORMAL',
    });
    startsAt.add(15, 'minutes');
  }
}

const priceData = (now: moment.Moment): PriceData => ({
  today: quarterHourlyPrices.slice(96, 192),
  latest: quarterHourlyPrices.find((p) => p.startsAt.isSame(now)),
  lowestToday: quarterHourlyPrices[96],
  highestToday: quarterHourlyPrices[191],
});

describe('comparators (quarter-hourly)', () => {
  describe('priceExtremes', () => {
    describe('today', () => {
      each`
        now                            | expectedLowest | expectedHighest
        ${'2023-02-01T00:15:00+01:00'} | ${true}        | ${false}
        ${'2023-02-01T12:00:00+01:00'} | ${false}       | ${false}
        ${'2023-02-01T23:45:00+01:00'} | ${false}       | ${true}
      `.describe('slot: $now', ({ now, expectedLowest, expectedHighest }) => {
        test('lowest', () => {
          const actual = priceExtremes(
            logger,
            quarterHourlyPrices,
            priceData(moment(now)),
            moment(now),
            {},
            { lowest: true },
          );
          expect(actual).toBe(expectedLowest);
        });

        test('highest', () => {
          const actual = priceExtremes(
            logger,
            quarterHourlyPrices,
            priceData(moment(now)),
            moment(now),
            {},
            { lowest: false },
          );
          expect(actual).toBe(expectedHighest);
        });
      });

      test('for the next X hours', () => {
        const now = moment('2023-02-01T00:15:00+01:00');
        const actual = priceExtremes(
          logger,
          quarterHourlyPrices,
          priceData(now),
          now,
          { hours: 3 },
          { lowest: false },
        );
        expect(actual).toBe(false);
      });

      test('among the X for the next Y hours', () => {
        const now = moment('2023-02-01T00:15:00+01:00');
        const actual = priceExtremes(
          logger,
          quarterHourlyPrices,
          priceData(now),
          now,
          { ranked_slots: 3, hours: 12 },
          { lowest: false },
        );
        expect(actual).toBe(false);
      });
    });
  });
});
