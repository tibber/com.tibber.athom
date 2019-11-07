'use strict';

const 	Homey 				= require('homey'),
		_					= require('lodash');

class TibberApp extends Homey.App {
	
	onInit() {
		this.log('Tibber app is running...');

        let v = Homey.ManagerSettings.get('v');
        if(v !== 2) {
            this.log('Cleaning logs');
            Homey.ManagerSettings.set('v', 2);
            this.cleanupLogs('*').catch(console.error);
        }
	}

    async cleanupLogs(prefix) {
        let logs = await Homey.ManagerInsights.getLogs();
        _.each(logs, async log => {
            if(prefix === '*' || _.startsWith(log.name, prefix)) {
                console.log('Deleting log', log.name);
                await Homey.ManagerInsights.deleteLog(log);
            }
        })
    }
}

module.exports = TibberApp;