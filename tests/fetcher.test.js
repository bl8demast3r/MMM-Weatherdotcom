/* Tests for weatherdotcom_fetcher.js. Run with `npm test` (node --test). */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    fetchWeather,
    weatherComIconName,
    noaaIconName
} = require("../weatherdotcom_fetcher");

const silentLog = { warn: () => {}, error: () => {} };

const options = (overrides) =>
    Object.assign(
        {
            id: "test",
            apiKey: "test-key",
            lat: "40.7829",
            lon: "-73.9654",
            units: "imperial",
            language: "en-US",
            noaaFallback: true,
            fetchAlerts: true,
            maxAlertDetails: 10,
            log: silentLog
        },
        overrides
    );

const json = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status: status,
    json: async () => body
});

// Minimal Weather.com responses
const weatherCom = {
    current: { validTimeUtc: 1791575228, expirationTimeUtc: 1791575828, iconCode: 30, dayOrNight: "D", temperature: 66 },
    daily: {
        validTimeUtc: [1791543600],
        expirationTimeUtc: [1791575749],
        daypart: [{ iconCode: [null, 29], dayOrNight: [null, "N"] }]
    },
    hourly: { validTimeUtc: [1791576000], expirationTimeUtc: [1791575828], iconCode: [12], dayOrNight: ["D"] }
};

// Minimal NOAA responses
const noaa = {
    points: {
        properties: {
            forecast: "https://api.weather.gov/forecast",
            forecastHourly: "https://api.weather.gov/forecast/hourly",
            forecastGridData: "https://api.weather.gov/grid",
            observationStations: "https://api.weather.gov/stations"
        }
    },
    forecast: {
        properties: {
            updateTime: "2026-10-09T18:36:22+00:00",
            periods: [{ icon: "https://api.weather.gov/icons/land/day/few?size=medium", isDaytime: true }]
        }
    },
    forecastHourly: {
        properties: {
            periods: [{ icon: "https://api.weather.gov/icons/land/night/rain_showers,20/tsra,60", isDaytime: false }]
        }
    },
    stations: { features: [{ id: "https://api.weather.gov/stations/KNYC" }] },
    observation: { properties: { timestamp: "2026-10-09T19:30:00+00:00" } }
};

// Route requests by URL; `failing` lists URL fragments that return HTTP 401/500
function mockFetch(t, { failing = [], alerts = null } = {}) {
    const requested = [];
    t.mock.method(global, "fetch", async (url) => {
        requested.push(url);
        if (failing.some((f) => url.includes(f))) {
            return json({}, url.includes("weather.com") ? 401 : 500);
        }
        if (url.includes("observations/current")) return json(structuredClone(weatherCom.current));
        if (url.includes("daily/15day")) return json(structuredClone(weatherCom.daily));
        if (url.includes("hourly/15day")) return json(structuredClone(weatherCom.hourly));
        if (url.includes("alerts/headlines")) return alerts ? json(alerts) : json(null, 204);
        if (url.includes("alerts/detail")) {
            return json({ alertDetail: { texts: [{ description: "Details" }] } });
        }
        if (url.includes("/points/")) return json(noaa.points);
        if (url.endsWith("/forecast/hourly")) return json(structuredClone(noaa.forecastHourly));
        if (url.endsWith("/forecast")) return json(structuredClone(noaa.forecast));
        if (url.endsWith("/grid")) return json({ properties: {} });
        if (url.endsWith("/stations")) return json(noaa.stations);
        if (url.endsWith("/observations/latest")) return json(noaa.observation);
        if (url.includes("alerts/active")) return json({ features: [] });
        throw new Error("unexpected request " + url);
    });
    return requested;
}

test("maps Weather.com icon codes to bundled icons", () => {
    assert.equal(weatherComIconName(32, "D"), "clear-day");
    assert.equal(weatherComIconName(31, "N"), "clear-night");
    assert.equal(weatherComIconName(30, "D"), "partly-cloudy-day");
    assert.equal(weatherComIconName(12, "D"), "rain");
    assert.equal(weatherComIconName(4, "N"), "thunderstorm");
    assert.equal(weatherComIconName(16, "D"), "snow");
    assert.equal(weatherComIconName(25, "N"), "clear-night");
    assert.equal(weatherComIconName(44, "D"), null);
    assert.equal(weatherComIconName(null, "D"), null);
});

test("every Weather.com icon maps to a file in every icon set", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const iconsDir = path.join(__dirname, "..", "icons");
    const sets = fs
        .readdirSync(iconsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    assert.ok(sets.length >= 12);
    for (let code = 0; code <= 47; code++) {
        for (const dayOrNight of ["D", "N"]) {
            const name = weatherComIconName(code, dayOrNight);
            if (name === null) continue;
            for (const set of sets) {
                assert.ok(
                    fs.existsSync(path.join(iconsDir, set, name + ".svg")),
                    `${set}/${name}.svg missing for code ${code}`
                );
            }
        }
    }
});

test("maps NOAA icon URLs to bundled icons", () => {
    assert.equal(noaaIconName("https://api.weather.gov/icons/land/day/few?size=small"), "partly-cloudy-day");
    assert.equal(noaaIconName("https://api.weather.gov/icons/land/night/skc"), "clear-night");
    assert.equal(noaaIconName("https://api.weather.gov/icons/land/day/rain_showers,20/tsra,60"), "rain");
    assert.equal(noaaIconName("https://api.weather.gov/icons/land/day/wind_bkn"), "cloudy");
    assert.equal(noaaIconName("https://api.weather.gov/icons/land/day/tsra_hi,40"), "thunderstorm");
    assert.equal(noaaIconName(undefined), null);
});

test("uses Weather.com when it works", async (t) => {
    const requested = mockFetch(t);
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.source, "weathercom");
    assert.equal(payload.sourceLabel, "Weather.com");
    assert.equal(payload.isFallback, false);
    assert.equal(payload.stale, false);
    assert.equal(payload.error, null);
    assert.equal(payload.noaa, null);
    assert.equal(payload.weathercom.units, "e");
    assert.deepEqual(payload.weathercom.alerts, []);
    assert.ok(!requested.some((url) => url.includes("weather.gov")));
});

test("reports the observation time published by Weather.com, not the fetch time", async (t) => {
    mockFetch(t);
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.updatedAt, 1791575228 * 1000);
    assert.equal(payload.currentUpdatedAt, 1791575228 * 1000);
    assert.equal(payload.forecastUpdatedAt, null);
    assert.notEqual(payload.fetchedAt, payload.updatedAt);
});

test("reports when the Weather.com data expires: the earliest expiration time", async (t) => {
    mockFetch(t);
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.expiresAt, 1791575749 * 1000);
});

test("adds icon names to the Weather.com data", async (t) => {
    mockFetch(t);
    const { weathercom } = await fetchWeather(options(), {});

    assert.equal(weathercom.current.iconName, "partly-cloudy-day");
    assert.deepEqual(weathercom.hourly.iconName, ["rain"]);
    assert.deepEqual(weathercom.daily.daypart[0].iconName, [null, "partly-cloudy-night"]);
});

test("requests metric units for metric configurations", async (t) => {
    const requested = mockFetch(t);
    const payload = await fetchWeather(options({ units: "metric" }), {});

    assert.equal(payload.weathercom.units, "m");
    assert.equal(payload.units, "metric");
    assert.ok(requested.filter((u) => u.includes("weather.com/v3/wx")).every((u) => u.includes("units=m")));
});

test("fetches the text of each Weather.com alert", async (t) => {
    mockFetch(t, { alerts: { alerts: [{ detailKey: "abc", eventDescription: "Flood Watch" }] } });
    const { weathercom } = await fetchWeather(options(), {});

    assert.equal(weathercom.alerts.length, 1);
    assert.deepEqual(weathercom.alerts[0].texts, [{ description: "Details" }]);
});

test("a failing alerts request does not fail the update", async (t) => {
    mockFetch(t, { failing: ["alerts/headlines"] });
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.source, "weathercom");
    assert.deepEqual(payload.weathercom.alerts, []);
});

test("falls back to NOAA when Weather.com fails", async (t) => {
    mockFetch(t, { failing: ["api.weather.com"] });
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.source, "noaa");
    assert.equal(payload.sourceLabel, "NOAA (backup)");
    assert.equal(payload.isFallback, true);
    assert.match(payload.error, /Weather\.com: .*HTTP 401/);
    assert.ok(!payload.error.includes("test-key"), "API key must not leak into errors");
    assert.equal(payload.weathercom, null);
    assert.equal(payload.noaa.forecast.properties.periods[0].iconName, "partly-cloudy-day");
    assert.equal(payload.noaa.forecastHourly.properties.periods[0].iconName, "rain");
});

test("reports the times published by NOAA", async (t) => {
    mockFetch(t, { failing: ["api.weather.com"] });
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.currentUpdatedAt, Date.parse("2026-10-09T19:30:00Z"));
    assert.equal(payload.forecastUpdatedAt, Date.parse("2026-10-09T18:36:22Z"));
    assert.equal(payload.updatedAt, payload.currentUpdatedAt);
    // NOAA publishes no expiration time
    assert.equal(payload.expiresAt, null);
});

test("uses NOAA without the backup label when no API key is set", async (t) => {
    const requested = mockFetch(t);
    const payload = await fetchWeather(options({ apiKey: "" }), {});

    assert.equal(payload.source, "noaa");
    assert.equal(payload.sourceLabel, "NOAA");
    assert.equal(payload.isFallback, false);
    assert.equal(payload.error, null);
    assert.ok(!requested.some((url) => url.includes("weather.com")));
});

test("does not fall back when noaaFallback is off", async (t) => {
    mockFetch(t, { failing: ["api.weather.com"] });
    const payload = await fetchWeather(options({ noaaFallback: false }), {});

    assert.equal(payload.source, null);
    assert.equal(payload.sourceLabel, "Unavailable");
    assert.match(payload.error, /Weather\.com/);
});

test("caches the NOAA gridpoint lookup", async (t) => {
    const requested = mockFetch(t);
    const cache = {};
    await fetchWeather(options({ apiKey: "" }), cache);
    await fetchWeather(options({ apiKey: "" }), cache);

    assert.equal(requested.filter((url) => url.includes("/points/")).length, 1);
});

test("keeps the last data, marked stale, when every source fails", async (t) => {
    mockFetch(t);
    const previous = await fetchWeather(options(), {});
    t.mock.restoreAll();
    mockFetch(t, { failing: ["api.weather.com", "api.weather.gov"] });
    const payload = await fetchWeather(options(), {}, previous);

    assert.equal(payload.source, "weathercom");
    assert.equal(payload.sourceLabel, "Weather.com");
    assert.equal(payload.stale, true);
    assert.equal(payload.updatedAt, previous.updatedAt);
    assert.match(payload.error, /Weather\.com: .*; NOAA: /);
});

test("reports an error when every source fails and there is no earlier data", async (t) => {
    mockFetch(t, { failing: ["api.weather.com", "api.weather.gov"] });
    const payload = await fetchWeather(options(), {});

    assert.equal(payload.source, null);
    assert.equal(payload.stale, false);
    assert.match(payload.error, /NOAA: /);
});
