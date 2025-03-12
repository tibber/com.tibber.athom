import { Device } from 'homey';
import Homey from 'homey/lib/Homey';
import { HomeDevice } from './drivers/home/device';

type GetHomeDevicesQuery = { name: string } | undefined;
type GetPulseDevicesQuery = { name: string } | undefined;
type GetDeviceDataQuery = { device_id: string };

module.exports = {
  async getHomeDeviceData({
    homey,
    query,
  }: {
    homey: Homey;
    query: GetDeviceDataQuery;
  }) {
    // Trigger a realtime event for Home device to publish current data to listening apps
    homey.app.log('API: getHomeDeviceData device_id: ', query?.device_id);
    const homeDevice = homey.drivers //    (device: CustomDevice) =>
      .getDriver('home')
      .getDevices()
      .filter((device: Device) => device.getData().id === query?.device_id)[0];
    return homeDevice !== undefined
      ? (homeDevice as HomeDevice).getDeviceData()
      : {};
  },

  async getHomeDevices({
    homey,
    query,
  }: {
    homey: Homey;
    query: GetHomeDevicesQuery;
  }) {
    const homeDevices = homey.drivers.getDriver('home').getDevices();
    return homeDevices
      .filter(
        (device: Device) =>
          query === undefined ||
          device.getName().toLowerCase().includes(query.name.toLowerCase()),
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
    query: GetPulseDevicesQuery;
  }) {
    const pulseDevices = [
      ...homey.drivers.getDriver('pulse').getDevices(),
      ...homey.drivers.getDriver('watty').getDevices(),
    ];
    return pulseDevices
      .filter(
        (device: Device) =>
          query === undefined ||
          device.getName().toLowerCase().includes(query.name.toLowerCase()),
      )
      .map((device) => ({
        name: device.getName(),
        id: device.getData().id,
      }));
  },
};
