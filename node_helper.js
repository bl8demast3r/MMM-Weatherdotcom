/* MagicMirror²
 * Node Helper: MMM-Weatherdotcom
 *
 * Polls the weather sources on the server, so the APIs are called once per
 * update interval no matter how many modules use the data or how many
 * browser windows show the mirror.
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const Log = require("logger");
const { fetchWeather } = require("./weatherdotcom_fetcher");

const MIN_UPDATE_INTERVAL_MINUTES = 1;

module.exports = NodeHelper.create({
    start: function () {
        Log.log(`Starting node helper for: ${this.name}`);
        // One poller per hub configuration (see MMM-Weatherdotcom.js getHubId)
        this.pollers = new Map();
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification !== "WEATHERDOTCOM_START") return;

        const poller = this.pollers.get(payload.id);
        if (poller) {
            // Another browser window, or a reload: send what we have
            if (poller.payload) {
                this.sendSocketNotification("WEATHERDOTCOM_DATA", poller.payload);
            }
            return;
        }
        this.startPolling(payload);
    },

    startPolling: function (config) {
        const log = {
            warn: (msg) => Log.warn(msg),
            error: (msg) => Log.error(msg)
        };
        const options = Object.assign({}, config, { log: log });
        const poller = { options: options, cache: {}, payload: null, timer: null };
        this.pollers.set(config.id, poller);

        const minutes = Math.max(MIN_UPDATE_INTERVAL_MINUTES, Number(config.updateInterval) || 10);
        poller.timer = setInterval(() => this.update(poller), minutes * 60 * 1000);
        this.update(poller);
    },

    update: async function (poller) {
        if (poller.updating) return;
        poller.updating = true;
        try {
            poller.payload = await fetchWeather(poller.options, poller.cache, poller.payload);
            const p = poller.payload;
            if (p.source && !p.stale) {
                Log.info(`weather updated from ${p.sourceLabel}`);
            }
            this.sendSocketNotification("WEATHERDOTCOM_DATA", p);
        } catch (err) {
            Log.error(`update failed: ${err.message}`);
        } finally {
            poller.updating = false;
        }
    },

    stop: function () {
        for (const poller of this.pollers.values()) {
            clearInterval(poller.timer);
        }
    }
});
