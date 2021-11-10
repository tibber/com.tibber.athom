import sourceMapSupport from 'source-map-support';
import 'newrelic';

import { App } from 'homey';

sourceMapSupport.install();

// to get some better typing elsewhere since there is no default export of TibberApp
export type AppInstance = TibberApp & {
  cleanupLogs(prefix: string): void;
};

class TibberApp extends App implements AppInstance {
  async onInit() {
    this.log('Tibber app is running...');

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
}

// workaround for `The class exported in '<filepath>' must extend Homey.<classname>` error
module.exports = TibberApp;
