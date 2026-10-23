export interface MeterState {
  base?: number;
  last?: number;
  total?: number;
}

// accumulatedConsumption values this much lower than the last one mean a new day, not noise
const RESET_TOLERANCE_KWH = 0.001;

/**
 * Advances an ever-increasing kWh total from `accumulatedConsumption`, which restarts at zero every
 * midnight. Homey Energy needs meter_power to only increase.
 */
export const advanceMeter = (
  state: MeterState | undefined,
  accumulated: number,
): Required<MeterState> => {
  const { base = 0, last, total: previousTotal = 0 } = state ?? {};
  // A drop means a new day started, possibly while the app wasn't running. Whatever was used between
  // the last frame and midnight is then lost, which is at most a few minutes' worth.
  const rolledOver =
    last !== undefined && accumulated < last - RESET_TOLERANCE_KWH;
  const nextBase = rolledOver ? base + last! : base;
  return {
    base: nextBase,
    last: accumulated,
    total: Math.max(previousTotal, nextBase + accumulated),
  };
};
