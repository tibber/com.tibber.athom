import moment from 'moment-timezone';
import { isSameDay } from './helpers';

describe('isSameDay', () => {
  test('start of day', () => {
    const tz = 'Europe/Oslo';
    const todayString = moment.tz(tz).format();
    const startOfToday = moment.tz(tz).startOf('day');
    const actual = isSameDay(todayString, startOfToday, tz);
    expect(actual).toBe(true);
  });
});
