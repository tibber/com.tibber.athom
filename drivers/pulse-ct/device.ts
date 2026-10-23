import { Device } from 'homey';
import { getDataApi } from '../../lib/data-api';
import {
  capabilityValues,
  DataApiLiveMeasurement,
  toNumber,
} from '../../lib/data-api/measurement';
import { advanceMeter, MeterState } from '../../lib/data-api/meter-counter';

const METER_PERSIST_INTERVAL_MS = 5 * 60 * 1000;
const WHOLE_HOME_ENERGY = {
  cumulative: true,
  cumulativeImportedCapability: 'meter_power',
};

class PulseCtDevice extends Device {
  #meter: MeterState = {};
  #meterPersistedAt = 0;
  #unsubscribe?: () => void;

  async onInit() {
    const { id, homeId } = this.getData();
    this.#meter = this.getStoreValue('meter') ?? {};
    this.#meterPersistedAt = Date.now();
    this.#unsubscribe = getDataApi(this.homey).liveStreams.subscribe(
      homeId,
      id,
      {
        onMeasurement: (frame) => {
          this.#onMeasurement(frame).catch((e) =>
            this.error('Updating from a frame failed', e),
          );
        },
        onStatus: ({ message }) => {
          this.setUnavailable(message).catch((e) => this.error(e));
        },
      },
    );
  }

  async #onMeasurement(frame: DataApiLiveMeasurement) {
    if (!this.getAvailable()) await this.setAvailable();

    const values = capabilityValues(frame);
    const accumulated = toNumber(frame.accumulatedConsumption);
    if (accumulated !== undefined)
      values.meter_power = this.#advanceMeter(accumulated);

    for (const [capability, value] of Object.entries(values)) {
      if (
        this.hasCapability(capability) &&
        this.getCapabilityValue(capability) !== value
      )
        // eslint-disable-next-line no-await-in-loop
        await this.setCapabilityValue(capability, value);
    }
  }

  /** The ever-increasing kWh total for meter_power. */
  #advanceMeter(accumulated: number): number {
    const previousBase = this.#meter.base;
    this.#meter = advanceMeter(this.#meter, accumulated);
    // Stored at each midnight rollover and every few minutes, so a restart neither double-counts
    // nor loses the day so far
    if (
      this.#meter.base !== previousBase ||
      Date.now() - this.#meterPersistedAt > METER_PERSIST_INTERVAL_MS
    )
      this.#persistMeter();
    return Math.round(this.#meter.total! * 1000) / 1000;
  }

  #persistMeter() {
    this.#meterPersistedAt = Date.now();
    this.setStoreValue('meter', this.#meter).catch((e) => {
      // Homey also uninitialises a device it is deleting, and by then its store is gone
      if (e.statusCode !== 404) this.error('Storing the meter total failed', e);
    });
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: unknown };
    newSettings: { [key: string]: unknown };
    changedKeys: string[];
  }) {
    if (!changedKeys.includes('whole_home')) return;
    // An empty object restores the manifest, which has no energy settings
    await this.setEnergy(newSettings.whole_home ? WHOLE_HOME_ENERGY : {});
  }

  async onUninit() {
    this.#stopStreaming();
    if (this.#meter.last !== undefined) this.#persistMeter();
  }

  async onDeleted() {
    this.#stopStreaming();
  }

  #stopStreaming() {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}

module.exports = PulseCtDevice;
