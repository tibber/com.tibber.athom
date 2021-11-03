import sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

import { App } from 'homey';
import _ from 'lodash';

// to get some better typing elsewhere since there is no default export of TibberApp
export type AppInstance = TibberApp & {
    cleanupLogs(prefix: string): void;
}

class TibberApp extends App implements AppInstance {
    async onInit() {
         this.log('Tibber app is running...');

        let v = this.homey.settings.get('v');
        if (v !== 2) {
            this.log('Cleaning logs');
            this.homey.settings.set('v', 2);
            this.cleanupLogs('*').catch(console.error);

        }
        //@/ts-expect-error
        //this.homey.flow.getDeviceTriggerCard();
    }

    async cleanupLogs(prefix: string) {
        let logs = await this.homey.insights.getLogs();

        for (const log of logs) {
            if (prefix === '*' || _.startsWith(log.name, prefix)) {
                console.log('Deleting log', log.name);
                await this.homey.insights.deleteLog(log);
            }
        }
    }
}

// workaround for `The class exported in '<filepath>' must extend Homey.<classname>` error
module.exports = TibberApp;