import moment from 'moment-timezone';

export const parseTimeString = (time: TimeString): moment.Moment => {
  const [h, m] = time.split(':');
  return moment
    .tz('Europe/Oslo')
    .hour(Number(h))
    .minute(Number(m))
    .startOf('minute');
};

// takes from end of array if `quantity` is negative
export const takeFromStartOrEnd = <T>(arr: T[], quantity?: number): T[] => {
  if (quantity === undefined) return [];

  let startIndex;
  let endIndex;
  if (Math.sign(quantity) === -1) {
    startIndex = quantity;
    endIndex = undefined;
  } else {
    startIndex = 0;
    endIndex = quantity;
  }
  return arr.slice(startIndex, endIndex);
};

export const mean = <T>(arr: T[], func: (item: T) => number): number =>
  sum(arr, func) / arr.length;

export const sum = <T>(arr: T[], func: (item: T) => number): number => {
  let result = 0;
  for (const item of arr) result += func(item);
  return result;
};

export const min = <T>(arr: T[], predicate: (item: T) => number) => {
  const minimum = Math.min(...arr.map(predicate));
  return arr.find((item) => predicate(item) === minimum);
};

export const max = <T>(arr: T[], predicate: (item: T) => number) => {
  const maximum = Math.max(...arr.map(predicate));
  return arr.find((item) => predicate(item) === maximum);
};

type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type TimeString = `${Digit}${Digit}:${Digit}${Digit}`;

export const randomBetweenRange = (
  lowerLimit: number,
  upperLimitExclusive: number,
) =>
  Math.floor(Math.random() * (upperLimitExclusive - lowerLimit) + lowerLimit);
