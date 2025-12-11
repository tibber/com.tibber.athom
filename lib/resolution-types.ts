export const resolutionTypes = {
  hourly: 'HOURLY',
  quarterHourly: 'QUARTER_HOURLY',
} as const;

export type ResolutionType =
  (typeof resolutionTypes)[keyof typeof resolutionTypes];

export const getIntervalMinutes = (resolution: ResolutionType): number => {
  switch (resolution) {
    case resolutionTypes.hourly:
      return 60;
    case resolutionTypes.quarterHourly:
      return 15;
    default:
      return 60;
  }
};

export const getTimeUnit = (resolution: ResolutionType): 'hour' | 'minute' => {
  switch (resolution) {
    case resolutionTypes.hourly:
      return 'hour';
    case resolutionTypes.quarterHourly:
      return 'minute';
    default:
      return 'hour';
  }
};
