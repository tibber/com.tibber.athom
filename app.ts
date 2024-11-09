import 'newrelic';
import sourceMapSupport from 'source-map-support';
import { App } from 'homey';
import Homey from 'homey/lib/Homey';
import { setGlobalAttributes } from './lib/newrelic-transaction';
import * as appJson from './app.json';
import { HomeDevice } from './drivers/home/device';

sourceMapSupport.install();

type HomeyWithMissingTypings = Homey & {
  platformVersion: string;
};

class TibberApp extends App {
  async onInit() {
    this.log('Tibber app is running...');

    // Init Debugger
    if (process.env.DEBUG === '1') {
      // @ts-expect-error
      if (this.homey.platform == "local") {
        try {
          require('inspector').waitForDebugger();
        }
        catch (error) {
          require('inspector').open(9291, '0.0.0.0', true);
        }
      }
    }
    
    const { version: firmwareVersion, platformVersion } = this
      .homey as HomeyWithMissingTypings;
    const { version: appVersion } = appJson;

    this.log(`platformVersion:`, platformVersion);
    this.log(`firmwareVersion:`, firmwareVersion);
    this.log(`appVersion:`, appVersion);

    setGlobalAttributes({ firmwareVersion, platformVersion, appVersion });

    const v = this.homey.settings.get('v');
    if (v !== 2) {
      this.log('Cleaning logs');
      this.homey.settings.set('v', 2);
      this.cleanupLogs('*').catch(console.error);
    }
    this.#initWidgets();
  }

  async cleanupLogs(prefix: string) {
    if (prefix !== '*') return;
    const logs = await this.homey.insights.getLogs();

    await Promise.all(
      logs
        .filter(({ name }) => name.startsWith(prefix))
        .map((log) => {
          console.log('Deleting log', log.name);
          return this.homey.insights.deleteLog(log);
        }),
    );
  }

  async onUninit() {
    this.log('Tibber app is stopping');
  }

  // WIDGET Settings ==============================================================================
  async #initWidgets(){
    // @ts-expect-error
    this.homey.dashboards.getWidget('price').registerSettingAutocompleteListener('device_home', async (query: string, settings: any) => { 
      let homes: { name: string; id: any; }[] = [];
      let devices = this.homey.drivers.getDriver('home').getDevices();
      devices.forEach(device => {
          homes.push({
            name: device.getName(),
            id: device.getData().id
          })
      });
      return homes.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
    });
    // @ts-expect-error
    this.homey.dashboards.getWidget('price').registerSettingAutocompleteListener('device_pulse', async (query: string, settings: any) => { 
      let homes: { name: string; id: any; }[] = [];
      let devices = this.homey.drivers.getDriver('pulse').getDevices();
      devices.forEach(device => {
          homes.push({
            name: device.getName(),
            id: device.getData().id
          })
      });
      return homes.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
    });
  }
  
  // WIDGET API ============================================================================
  async apiTriggerRealtimeData(){
    // let device = this.homey.drivers.getDriver('home').getDevices()[0] as HomeDevice;
    this.homey.drivers.getDriver('home').getDevices().forEach( (device ) => {
      (device as HomeDevice).triggerRealtimeData();
    });
  }

}

// workaround for `The class exported in '<filepath>' must extend Homey.<classname>` error
module.exports = TibberApp;
