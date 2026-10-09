/* MagicMirror²
 * Module: MMM-Weatherdotcom
 *
 * Polls Weather.com (with NOAA as a backup) and shares the weather data
 * with other modules through the WEATHERDOTCOM_DATA notification, so that
 * several weather modules don't each poll the same source.
 *
 * Also hosts the weather icon sets used by the modules that display the data.
 *
 * MIT Licensed.
 */

Module.register("MMM-Weatherdotcom", {
    defaults: {
        apiKey: "",
        lat: "",
        lon: "",
        units: config.units,
        language: "en-US",
        updateInterval: 10, // minutes
        noaaFallback: true,
        fetchAlerts: true,
        maxAlertDetails: 10,
        timeFormat: config.timeFormat
    },

    requiresVersion: "2.15.0",

    getScripts: function () {
        return ["moment.js"];
    },

    start: function () {
        Log.info(`Starting module: ${this.name}`);
        this.weatherData = null;

        if (this.config.lat === "" || this.config.lon === "") {
            Log.error(`${this.name}: location (lat and lon) must be specified`);
            return;
        }
        if (!this.config.apiKey) {
            Log.warn(`${this.name}: no apiKey set, using NOAA only`);
        }

        this.hubId = this.getHubId();
        this.sendSocketNotification(
            "WEATHERDOTCOM_START",
            Object.assign({}, this.config, { id: this.hubId })
        );
    },

    // Identifies this configuration's poller in the node helper. The API key
    // is left out because the id is broadcast with the data.
    getHubId: function () {
        return [
            Number(this.config.lat),
            Number(this.config.lon),
            this.config.units,
            this.config.language,
            this.config.updateInterval,
            this.config.noaaFallback,
            this.config.fetchAlerts
        ].join("|");
    },

    socketNotificationReceived: function (notification, payload) {
        if (notification !== "WEATHERDOTCOM_DATA" || payload.id !== this.hubId) {
            return;
        }
        // Where modules find the shared icon sets, e.g. iconPath + "/1c/rain.svg"
        payload.iconPath = this.file("icons");
        this.weatherData = payload;
        this.sendNotification("WEATHERDOTCOM_DATA", payload);
        // The status line is only shown when the module has a position
        if (this.data.position) {
            this.updateDom();
        }
    },

    notificationReceived: function (notification) {
        // Modules that start after the data arrived ask for it again
        if (notification === "WEATHERDOTCOM_REQUEST" && this.weatherData) {
            this.sendNotification("WEATHERDOTCOM_DATA", this.weatherData);
        }
    },

    // Only shown when the module is given a position: a one-line status
    getDom: function () {
        const wrapper = document.createElement("div");
        wrapper.className = "xsmall dimmed";
        const data = this.weatherData;
        if (!data) {
            wrapper.innerText = this.translate("LOADING");
            return wrapper;
        }
        const items = [`Source: ${data.sourceLabel}`];
        const format = this.config.timeFormat === 12 ? "h:mm a" : "HH:mm";
        if (data.updatedAt) {
            items.push(`Updated ${moment(data.updatedAt).format(format)}`);
        }
        if (data.expiresAt) {
            items.push(`Expires ${moment(data.expiresAt).format(format)}`);
        }
        if (data.stale) items.push("offline");
        wrapper.innerText = items.join(" · ");
        if (data.error) wrapper.title = data.error;
        return wrapper;
    }
});
