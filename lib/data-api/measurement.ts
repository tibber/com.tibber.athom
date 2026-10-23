/** A frame from the Data API live-events stream. All fields are optional. */
export interface DataApiLiveMeasurement {
  deviceId: string;
  timestamp?: string;
  power?: number | string;
  powerProduction?: number | string;
  accumulatedConsumption?: number | string;
  currentL1?: number | string;
  currentL2?: number | string;
  currentL3?: number | string;
  voltageL1?: number | string;
  voltageL2?: number | string;
  voltageL3?: number | string;
  [field: string]: unknown;
}

/** Reads a Data API number, which may arrive as a JSON number or a numeric string. */
export const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const round = (value: number, decimals: number) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

const PHASES = ['L1', 'L2', 'L3'] as const;

/** Maps a frame to Homey capability values, leaving out fields the frame lacks. */
export const capabilityValues = (
  frame: DataApiLiveMeasurement,
): Record<string, number> => {
  const values: Record<string, number> = {};

  const power = toNumber(frame.power);
  const production = toNumber(frame.powerProduction);
  // Homey shows production as negative power
  if (production !== undefined && production > 0 && !power)
    values.measure_power = round(-production, 1);
  else if (power !== undefined) values.measure_power = round(power, 1);

  PHASES.forEach((phase) => {
    const current = toNumber(frame[`current${phase}`]);
    if (current !== undefined)
      values[`measure_current.${phase}`] = round(current, 2);
  });

  // A Pulse CT reports the same voltage for all three phases, so one value is shown
  const voltage = PHASES.map((phase) =>
    toNumber(frame[`voltage${phase}`]),
  ).find((v) => v !== undefined);
  if (voltage !== undefined) values.measure_voltage = round(voltage, 1);

  return values;
};
