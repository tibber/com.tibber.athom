import { SseParser } from './sse';
import { capabilityValues, toNumber } from './measurement';
import { advanceMeter } from './meter-counter';
import { deviceName, isPulseCt } from './device-kind';

// The frame a Pulse CT sent on 2026-10-23, with the device id shortened
const CT_FRAME = {
  deviceId: 'ct',
  estimatedAccumulatedConsumptionCurrentHour: 5.574,
  effectiveHourlyConsumptionLimit: 17,
  timestamp: '2026-10-23T10:10:27.000+02:00',
  power: 5921.15316741311,
  minPower: 5.894429381843219,
  averagePower: 260.7,
  maxPower: 5964.993044423446,
  accumulatedConsumption: 2.653123,
  accumulatedProduction: 0,
  accumulatedConsumptionLastHour: 0.676148,
  accumulatedProductionLastHour: 0,
  voltageL1: 229.1668,
  voltageL2: 229.1668,
  voltageL3: 229.1668,
  currentL1: 8.590315,
  currentL2: 8.54194,
  currentL3: 8.755808,
};

const CT_ID =
  'dGliYmVyIHB1bHNlIGN0OjQxY2Q2YTRkLTE1M2MtNGJmMi05ZjE2LTFiZGRlZTAyY2YzZA';
const P1_ID =
  'dGliYmVyIHB1bHNlIHAxOmVlODQ5YTUwLTRjMDUtNDQxMC1iNzBkLWE4MGIyNzE4YzljMA';

describe('SseParser', () => {
  test('handles frames split across chunks, a split CRLF, comments and pings', () => {
    const parser = new SseParser();
    const text =
      ': hello\r\n\r\nevent: ping\r\n\r\nevent: measurement\r\ndata: {"deviceId":"a","power":1}\r\n\r\n';
    const events = [];
    for (let i = 0; i < text.length; i += 7)
      events.push(...parser.push(text.slice(i, i + 7)));
    expect(events.map((e) => e.event)).toEqual([
      'message',
      'ping',
      'measurement',
    ]);
    expect(events[2].data).toEqual({ deviceId: 'a', power: 1 });
  });

  test('keeps invalid JSON as raw text', () => {
    const [event] = new SseParser().push('event: stream_error\ndata: nope\n\n');
    expect(event.data).toBeUndefined();
    expect(event.raw).toBe('nope');
  });
});

describe('measurement mapping', () => {
  test('toNumber accepts numbers and numeric strings only', () => {
    expect(toNumber(1.5)).toBe(1.5);
    expect(toNumber('-2.25')).toBe(-2.25);
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('abc')).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
    expect(toNumber(Number.NaN)).toBeUndefined();
  });

  test('maps the real CT frame', () => {
    expect(capabilityValues(CT_FRAME)).toEqual({
      measure_power: 5921.2,
      'measure_current.L1': 8.59,
      'measure_current.L2': 8.54,
      'measure_current.L3': 8.76,
      measure_voltage: 229.2,
    });
  });

  test('shows production as negative power and skips missing fields', () => {
    expect(
      capabilityValues({ deviceId: 'x', power: 0, powerProduction: '1200' }),
    ).toEqual({ measure_power: -1200 });
    expect(
      capabilityValues({ deviceId: 'x', power: 300, powerProduction: 0 }),
    ).toEqual({ measure_power: 300 });
    expect(capabilityValues({ deviceId: 'x', voltageL2: 231 })).toEqual({
      measure_voltage: 231,
    });
    expect(capabilityValues({ deviceId: 'x' })).toEqual({});
  });
});

describe('advanceMeter', () => {
  test('only increases, across a midnight reset and a restart', () => {
    let state = advanceMeter(undefined, 1.0);
    expect(state.total).toBe(1.0);
    state = advanceMeter(state, 2.5);
    expect(state.total).toBe(2.5);
    // midnight
    state = advanceMeter(state, 0.1);
    expect(state.base).toBe(2.5);
    expect(state.total).toBeCloseTo(2.6);
    // a restart later the same day, from a stored state that's a few minutes behind
    state = advanceMeter({ ...state }, 0.4);
    expect(state.total).toBeCloseTo(2.9);
    // noise smaller than the tolerance is not a reset, and never makes the total go down
    const noisy = advanceMeter(state, 0.3995);
    expect(noisy.base).toBe(2.5);
    expect(noisy.total).toBeGreaterThanOrEqual(state.total);
  });

  test('counts a reset that happened while the app was stopped', () => {
    const beforeMidnight = advanceMeter(advanceMeter(undefined, 0), 30);
    expect(advanceMeter(beforeMidnight, 4).total).toBe(34);
  });
});

describe('device kind', () => {
  test('recognises a Pulse CT and leaves other meters out', () => {
    expect(isPulseCt({ id: CT_ID })).toBe(true);
    expect(isPulseCt({ id: P1_ID })).toBe(false);
    expect(isPulseCt({ id: 'opaque-123456' })).toBe(false);
  });

  test('names devices from info.name, then the kind in the id, then a short id', () => {
    expect(deviceName({ id: 'x', info: { name: 'Tibber Pulse' } })).toBe(
      'Tibber Pulse',
    );
    expect(deviceName({ id: CT_ID })).toBe('Tibber Pulse CT');
    expect(deviceName({ id: CT_ID, info: {} }, 'Cabin')).toBe(
      'Tibber Pulse CT (Cabin)',
    );
    expect(deviceName({ id: '!!!opaque-123456' })).toBe('Tibber meter 123456');
  });
});
