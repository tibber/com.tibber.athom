'use strict';

const 	Homey 				= require('homey'),
		_                   = require('lodash'),
        oauth               = require('../../lib/oauth'),
        tibber              = require('../../lib/tibber');

class MyDriver extends Homey.Driver {
	
	onInit() {
		this.log('Tibber pulse driver has been initialized');
	}
    onPair( socket ) {
        socket.on('list_devices', this.onPairListDevices);
        oauth.initiateOauth(socket);
    }

	onPairListDevices(data, callback) {
        tibber.getHomes()
            .then(data => {
                let devices = _.reject(_.map(_.get(data, 'viewer.homes'), home => {
                    let hasPulse = !!_.get(home, 'features.realTimeConsumptionEnabled');
                    if(!hasPulse)
                        return null;

                    _.assign(home, {t:tibber.getDefaultToken()});
                    let address = _.get(home, 'address.address1');
                    return {
                        data: home,
                        name: `Pulse ${address}`
                    };
                }), _.isNull);

                callback(null, devices.sort(MyDriver._compareHomeyDevice));
            })
            .catch(e => {
                this.log('Error in onPairListDevices', e);
                callback(new Error("Failed to retrieve data."));
            });
	}

	static _compareHomeyDevice(a, b) {
		if (a.name < b.name)
			return -1;
		if (a.name > b.name)
			return 1;
		return 0;
	}
}

module.exports = MyDriver;