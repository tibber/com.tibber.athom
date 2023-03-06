import moment from 'moment-timezone';
import { isSameDay, mean, sum } from './helpers';

describe('helpers', () => {
  describe('isSameDay', () => {
    test('start of day', () => {
      const tz = 'Europe/Oslo';
      const todayString = moment.tz(tz).format();
      const startOfToday = moment.tz(tz).startOf('day');
      const actual = isSameDay(todayString, startOfToday, tz);
      expect(actual).toBe(true);
    });
  });

  describe('sum', () => {
    test('simple', () => {
      const values = [2, 5, 7, 13];
      const actual = sum(values, (item) => item);
      expect(actual).toBe(27);
    });
  });

  describe('mean', () => {
    test('simple', () => {
      const values = [2, 5, 7, 13];
      const actual = mean(values, (item) => item);
      expect(actual).toBe(6.75);
    });

    test('empty array', () => {
      const values: number[] = [];
      const actual = mean(values, (item) => item);
      expect(actual).toBeNaN();
    });
  });
});
