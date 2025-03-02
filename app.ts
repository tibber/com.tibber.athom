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
  
  // App API ============================================================================
  async apiTriggerRealtimeData(){
    // Trigger a realtime event for Home device to publish current data to listening apps
    this.homey.drivers.getDriver('home').getDevices().forEach( (device ) => {
      (device as HomeDevice).triggerRealtimeData();
    });
    return { success: true };
  }

  async apiGetHomeDevices(query: any){
    // Return a list of Home devices matching the query string
    let homes: { name: string; id: any; }[] = [];
    let devices = this.homey.drivers.getDriver('home').getDevices();
    devices.forEach(device => {
        homes.push({
          name: device.getName(),
          id: device.getData().id
        })
    });
    return homes.filter((item) => item.name.toLowerCase().includes(query.search.toLowerCase()));  
  }

  async apiGetPulseDevices(query: any){
    // Return a list of Pulse devices matching the query string
    let homes: { name: string; id: any; }[] = [];
    let devices = this.homey.drivers.getDriver('pulse').getDevices();
    devices.forEach(device => {
        homes.push({
          name: device.getName(),
          id: device.getData().id
        })
    });
    return homes.filter((item) => item.name.toLowerCase().includes(query.search.toLowerCase()));
}

}

// workaround for `The class exported in '<filepath>' must extend Homey.<classname>` error
module.exports = TibberApp;
