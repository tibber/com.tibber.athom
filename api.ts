import Homey from 'homey/lib/Homey';
import { HomeDevice } from './drivers/home/device';
import { isSomeString } from './lib/helpers';

type GetHomeDevicesQuery = { name?: string };
type GetPulseDevicesQuery = { name?: string };
type GetDeviceDataQuery = { deviceId?: string };

module.exports = {
  async getHomeDeviceData({
    homey,
    query,
  }: {
    homey: Homey;
    query?: GetDeviceDataQuery;
  }) {
    const deviceId = query?.deviceId;
    homey.app.log('API: getHomeDeviceData; deviceId: ', deviceId);
    const [homeDevice] = homey.drivers
      .getDriver('home')
      .getDevices()
      .filter((device) => {
        if (isSomeString(deviceId)) return device.getData().id === deviceId;
        return device;
      });
    return homeDevice !== undefined
      ? (homeDevice as HomeDevice).getDeviceData()
      : {};
  },

  async getHomeDevices({
    homey,
    query,
  }: {
    homey: Homey;
    query?: GetHomeDevicesQuery;
  }) {
    const name = query?.name?.toLowerCase();
    const homeDevices = homey.drivers.getDriver('home').getDevices();
    return homeDevices
      .filter(
        (device) =>
          name === undefined ||
          name.length === 0 ||
          device.getName().toLowerCase().includes(name),
      )
      .map((device) => ({
        name: device.getName(),
        id: device.getData().id,
      }));
  },

  async getPulseDevices({
    homey,
    query,
  }: {
    homey: Homey;
    query?: GetPulseDevicesQuery;
  }) {
    const name = query?.name?.toLowerCase();
    const pulseDevices = [
      ...homey.drivers.getDriver('pulse').getDevices(),
      ...homey.drivers.getDriver('watty').getDevices(),
    ];
    return pulseDevices
      .filter(
        (device) =>
          name === undefined ||
          name.length === 0 ||
          device.getName().toLowerCase().includes(name),
      )
      .map((device) => ({
        name: device.getName(),
        id: device.getData().id,
      }));
  },
};
