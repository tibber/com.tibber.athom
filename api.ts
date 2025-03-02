module.exports = {
    async triggerRealtimeData({homey, query}: any)
    {
        return await homey.app.apiTriggerRealtimeData();
    },

    async getHomeDevices({homey, query}: any)
    {
        return await homey.app.apiGetHomeDevices(query);
    },

    async getPulseDevices({homey, query}: any)
    {
        return await homey.app.apiGetPulseDevices(query);
    }

};