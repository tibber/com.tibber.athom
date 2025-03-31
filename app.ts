import 'newrelic';
import sourceMapSupport from 'source-map-support';
import { App } from 'homey';
import Homey from 'homey/lib/Homey';
import { setGlobalAttributes } from './lib/newrelic-transaction';
import * as appJson from './app.json';

sourceMapSupport.install();

type HomeyWithMissingTypings = Homey & {
  platformVersion: string;
  platform: string;
};

class TibberApp extends App {
  async onInit() {
    this.log('Tibber app is running...');

    // Init Debugger
    // Adjust the port if needed. If you are using VS Code, launch settings are in `.vscode/launch.json`
    if ((this.homey as HomeyWithMissingTypings).platform === 'local') {
      if (process.env.WAIT_FOR_DEBUGGER === '1') {
        // eslint-disable-next-line global-require,@typescript-eslint/no-var-requires
        require('inspector').waitForDebugger();
      } else if (process.env.DEBUG === '1') {
        try {
          // eslint-disable-next-line global-require,@typescript-eslint/no-var-requires
          require('inspector').open(9291, '0.0.0.0', true);
        } catch (error) {
          //
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
}

// workaround for `The class exported in '<filepath>' must extend Homey.<classname>` error
module.exports = TibberApp;
