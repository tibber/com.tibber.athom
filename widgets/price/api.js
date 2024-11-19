'use strict';

module.exports = {

    async triggerRealtimeData({ homey, query }) {
        return await homey.app.apiTriggerRealtimeData( );
    }

};