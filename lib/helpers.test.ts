import { max, mean, min, sum } from './helpers';

describe('helpers', () => {
  describe('min', () => {
    test('simple', () => {
      const values = [{ value: 7 }, { value: 13 }, { value: 2 }, { value: 5 }];
      const actual = min(values, (item) => item.value);
      expect(actual).toStrictEqual({ value: 2 });
    });
  });

  describe('max', () => {
    test('simple', () => {
      const values = [{ value: 7 }, { value: 13 }, { value: 2 }, { value: 5 }];
      const actual = max(values, (item) => item.value);
      expect(actual).toStrictEqual({ value: 13 });
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
