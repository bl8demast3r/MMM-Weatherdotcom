/* MagicMirror²
 * Module: MMM-Weatherdotcom
 *
 * Fetches weather from Weather.com, with the NOAA National Weather Service
 * API as a backup, and packages it into the payload that is broadcast to
 * other modules. Kept free of MagicMirror dependencies so it can be tested
 * on its own.
 *
 * MIT Licensed.
 */

const WEATHER_COM_API_BASE = "https://api.weather.com/v3/";
const NOAA_API_BASE = "https://api.weather.gov/";
const NOAA_USER_AGENT = "MMM-Weatherdotcom (MagicMirror²)";
const REQUEST_TIMEOUT_MS = 30 * 1000;

// Weather.com icon codes (0-47) mapped to the bundled icon names. Codes not
// listed here have a day and a night variant, see getDayNightIcon().
// See "TWC Icon Codes" in https://github.com/jaydeethree/Home-Assistant-weatherdotcom
const WEATHER_COM_ICONS = {
    0: "tornado",
    1: "thunderstorm", // tropical storm
    2: "tornado", // hurricane
    3: "thunderstorm",
    4: "thunderstorm",
    5: "snow", // rain and snow
    6: "sleet", // rain and sleet
    7: "sleet", // wintry mix
    8: "sleet", // freezing drizzle
    9: "rain", // drizzle
    10: "sleet", // freezing rain
    11: "rain", // showers
    12: "rain",
    13: "snow", // flurries
    14: "snow", // snow showers
    15: "snow", // blowing / drifting snow
    16: "snow",
    17: "hail",
    18: "sleet",
    19: "fog", // blowing dust / sandstorm
    20: "fog",
    21: "fog", // haze
    22: "fog", // smoke
    23: "wind", // breezy
    24: "wind",
    26: "cloudy",
    27: "cloudy", // mostly cloudy (night)
    28: "cloudy", // mostly cloudy (day)
    29: "partly-cloudy-night",
    30: "partly-cloudy-day",
    31: "clear-night",
    32: "clear-day",
    33: "partly-cloudy-night", // fair / mostly clear (night)
    34: "partly-cloudy-day", // fair / mostly sunny (day)
    35: "hail", // mixed rain and hail
    36: "clear-day", // hot
    37: "thunderstorm",
    38: "thunderstorm",
    39: "rain", // scattered showers (day)
    40: "rain", // heavy rain
    41: "snow", // scattered snow showers (day)
    42: "snow", // heavy snow
    43: "snow", // blizzard
    45: "rain", // scattered showers (night)
    46: "snow", // scattered snow showers (night)
    47: "thunderstorm" // scattered thunderstorms (night)
};

// 25 (cold / frigid) has no dedicated icon, so it shows as clear
const getDayNightIcon = (isDay) => (isDay ? "clear-day" : "clear-night");

/**
 * Map a Weather.com icon code to a bundled icon name.
 * @param {number|null} iconCode Weather.com icon code (0-47)
 * @param {string} dayOrNight "D" or "N"
 * @returns {string|null} icon name, e.g. "partly-cloudy-day"
 */
function weatherComIconName(iconCode, dayOrNight) {
    if (iconCode === null || iconCode === undefined) return null;
    if (iconCode === 25) return getDayNightIcon(dayOrNight !== "N");
    return WEATHER_COM_ICONS[iconCode] || null;
}

// NOAA conditions mapped to the bundled icon names, matching MMM-NOAAForecast.
// "clear" and "partly-cloudy" get a -day or -night suffix.
// See https://api.weather.gov/icons
const NOAA_ICONS = {
    skc: "clear",
    few: "partly-cloudy",
    sct: "partly-cloudy",
    bkn: "cloudy",
    ovc: "cloudy",
    snow: "snow",
    rain_snow: "snow",
    rain_sleet: "sleet",
    snow_sleet: "snow",
    fzra: "sleet",
    rain_fzra: "rain",
    snow_fzra: "snow",
    sleet: "sleet",
    rain: "rain",
    rain_showers: "rain",
    rain_showers_hi: "rain",
    tsra: "thunderstorm",
    tsra_sct: "thunderstorm",
    tsra_hi: "thunderstorm",
    tornado: "tornado",
    hurricane: "tornado",
    tropical_storm: "thunderstorm",
    dust: "fog",
    smoke: "fog",
    haze: "fog",
    hot: "clear",
    cold: "clear",
    blizzard: "snow",
    fog: "fog"
};

/**
 * Map a NOAA icon URL (e.g. ".../icons/land/day/rain_showers,20/tsra,60?size=small")
 * to a bundled icon name. The first condition in the URL is used.
 * @param {string} url NOAA icon URL
 * @param {boolean} [isDaytime] used when the URL has no day/night part
 * @returns {string|null} icon name, e.g. "rain"
 */
function noaaIconName(url, isDaytime) {
    if (typeof url !== "string") return null;
    const match = url.match(/\/icons\/[^/]+\/(day|night)\/([^/?,]+)/);
    if (!match) return null;
    const isDay = match[1] ? match[1] === "day" : isDaytime !== false;
    const icon = NOAA_ICONS[match[2].replace(/^wind_/, "")];
    if (!icon) return null;
    if (icon === "clear" || icon === "partly-cloudy") {
        return icon + (isDay ? "-day" : "-night");
    }
    return icon;
}

class HttpError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

const redactUrl = (url) => url.replace(/apiKey=[^&]*/, "apiKey=***");

/**
 * GET a URL and parse its JSON body.
 * @param {string} url URL to fetch
 * @param {object} [headers] request headers
 * @returns {Promise<object|null>} parsed JSON, or null for 204 No Content
 */
async function fetchJSON(url, headers) {
    let res;
    try {
        res = await fetch(url, {
            headers: headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (err) {
        throw new Error(`request to ${redactUrl(url)} failed: ${err.message}`);
    }
    if (res.status === 204) return null;
    if (!res.ok) {
        throw new HttpError(
            `request to ${redactUrl(url)} failed (HTTP ${res.status})`,
            res.status
        );
    }
    return res.json();
}

/**
 * Fetch the current conditions, 15-day daily and hourly forecasts and active
 * alerts from Weather.com, and add bundled icon names to them.
 * @param {object} options hub configuration (apiKey, lat, lon, units, language, fetchAlerts, maxAlertDetails)
 * @returns {Promise<object>} { units, current, daily, hourly, alerts }
 */
async function fetchWeatherCom(options) {
    const units = options.units === "imperial" ? "e" : "m";
    const params =
        `?geocode=${Number(options.lat)},${Number(options.lon)}` +
        `&format=json&language=${encodeURIComponent(options.language)}` +
        `&units=${units}&apiKey=${encodeURIComponent(options.apiKey)}`;
    const base = WEATHER_COM_API_BASE;

    const [current, daily, hourly, alerts] = await Promise.all([
        fetchJSON(base + "wx/observations/current" + params),
        fetchJSON(base + "wx/forecast/daily/15day" + params),
        fetchJSON(base + "wx/forecast/hourly/15day" + params),
        options.fetchAlerts ? fetchWeatherComAlerts(options, params) : []
    ]);
    if (!current || !daily || !hourly) {
        throw new Error("Weather.com returned an empty response");
    }

    current.iconName = weatherComIconName(current.iconCode, current.dayOrNight);
    hourly.iconName = hourly.iconCode.map((code, i) =>
        weatherComIconName(code, hourly.dayOrNight[i])
    );
    for (const daypart of daily.daypart || []) {
        daypart.iconName = daypart.iconCode.map((code, i) =>
            weatherComIconName(code, daypart.dayOrNight[i])
        );
    }

    return { units: units, current: current, daily: daily, hourly: hourly, alerts: alerts };
}

// Alerts are optional extras, so failures here never fail the whole update.
// The headlines endpoint has no alert text, so the detail of each alert is
// fetched too and added as `texts`.
async function fetchWeatherComAlerts(options, params) {
    let headlines;
    try {
        headlines = await fetchJSON(WEATHER_COM_API_BASE + "alerts/headlines" + params);
    } catch (err) {
        options.log.warn(`Weather.com alerts unavailable: ${err.message}`);
        return [];
    }
    const alerts = (headlines && headlines.alerts) || [];
    const detailParams =
        `&format=json&language=${encodeURIComponent(options.language)}` +
        `&apiKey=${encodeURIComponent(options.apiKey)}`;
    await Promise.all(
        alerts.slice(0, options.maxAlertDetails).map(async (alert) => {
            try {
                const detail = await fetchJSON(
                    WEATHER_COM_API_BASE +
                        "alerts/detail?alertId=" +
                        encodeURIComponent(alert.detailKey) +
                        detailParams
                );
                alert.texts = (detail && detail.alertDetail && detail.alertDetail.texts) || [];
            } catch (err) {
                options.log.warn(`Weather.com alert detail unavailable: ${err.message}`);
            }
        })
    );
    return alerts;
}

/**
 * Fetch the forecast, hourly forecast, gridpoint data, latest station
 * observation and active alerts from NOAA, and add bundled icon names to the
 * forecast periods.
 * @param {object} options hub configuration (lat, lon, fetchAlerts)
 * @param {object} cache per-location cache; the gridpoint lookup is kept in cache.points
 * @returns {Promise<object>} { forecast, forecastHourly, forecastGridData, observation, alerts }
 */
async function fetchNOAA(options, cache) {
    const headers = { "User-Agent": NOAA_USER_AGENT, Accept: "application/geo+json" };
    // NOAA redirects coordinates with more than 4 decimal places
    const lat = parseFloat(Number(options.lat).toFixed(4)),
        lon = parseFloat(Number(options.lon).toFixed(4));
    const optional = (promise, what) =>
        promise.catch((err) => {
            options.log.warn(`NOAA ${what} unavailable: ${err.message}`);
            return null;
        });

    try {
        if (!cache.points) {
            try {
                cache.points = (await fetchJSON(`${NOAA_API_BASE}points/${lat},${lon}`, headers)).properties;
            } catch (err) {
                if (err.status === 404) {
                    err.message += " (NOAA only covers the United States and its territories)";
                }
                throw err;
            }
        }
        const points = cache.points;

        const [forecast, forecastHourly, forecastGridData, observation, alerts] = await Promise.all([
            fetchJSON(points.forecast, headers),
            fetchJSON(points.forecastHourly, headers),
            // Gridpoint data is flaky at times; the forecasts work without it
            optional(fetchJSON(points.forecastGridData, headers), "gridpoint data"),
            optional(fetchNOAAObservation(points.observationStations, headers), "observation"),
            options.fetchAlerts
                ? optional(fetchJSON(`${NOAA_API_BASE}alerts/active?point=${lat},${lon}`, headers), "alerts")
                : null
        ]);

        for (const data of [forecast, forecastHourly]) {
            for (const period of data.properties.periods) {
                period.iconName = noaaIconName(period.icon, period.isDaytime);
            }
        }

        return {
            forecast: forecast,
            forecastHourly: forecastHourly,
            forecastGridData: forecastGridData,
            observation: observation,
            alerts: alerts
        };
    } catch (err) {
        // Look up the gridpoint again next time in case it has moved
        cache.points = null;
        throw err;
    }
}

async function fetchNOAAObservation(stationsUrl, headers) {
    if (!stationsUrl) return null;
    const stations = await fetchJSON(stationsUrl, headers);
    const station = stations && stations.features && stations.features[0];
    if (!station) return null;
    return fetchJSON(`${station.id}/observations/latest`, headers);
}

const toMs = (time) => {
    const ms = typeof time === "number" ? time * 1000 : Date.parse(time);
    return isNaN(ms) ? null : ms;
};

/**
 * Times when the data was last updated on the provider's side (not when it
 * was fetched), as epoch milliseconds or null when the provider has none.
 *
 * Weather.com publishes the time of the current conditions observation, but
 * no issue time for its forecasts. NOAA publishes both.
 *
 * expiresAt is when Weather.com says the data is due to be refreshed: the
 * earliest expiration time of the current conditions and the forecasts.
 * NOAA has none.
 */
function getUpdateTimes(source, data) {
    if (source === "weathercom") {
        const current = toMs(data.current.validTimeUtc);
        const expirations = [data.current.expirationTimeUtc]
            .concat(data.daily.expirationTimeUtc || [], data.hourly.expirationTimeUtc || [])
            .filter((t) => typeof t === "number");
        return {
            updatedAt: current,
            currentUpdatedAt: current,
            forecastUpdatedAt: null,
            expiresAt: expirations.length ? Math.min(...expirations) * 1000 : null
        };
    }
    const props = (json) => (json && json.properties) || {};
    const current = toMs(props(data.observation).timestamp) || toMs(props(data.forecastHourly).generatedAt);
    const forecast =
        toMs(props(data.forecast).updateTime) ||
        toMs(props(data.forecastHourly).updateTime) ||
        toMs(props(data.forecast).generatedAt);
    return {
        updatedAt: current || forecast,
        currentUpdatedAt: current,
        forecastUpdatedAt: forecast,
        expiresAt: null
    };
}

/**
 * Fetch weather for one hub configuration: Weather.com when an API key is
 * set, falling back to NOAA when Weather.com fails or no key is set.
 *
 * When every source fails, the previous payload is returned again marked as
 * stale, so modules keep showing the last good data.
 *
 * @param {object} options hub configuration
 * @param {object} cache per-location cache, kept between calls
 * @param {object} [previous] the last payload returned for this configuration
 * @returns {Promise<object>} payload broadcast as WEATHERDOTCOM_DATA
 */
async function fetchWeather(options, cache, previous) {
    const errors = [];
    let source = null,
        data = null;

    if (options.apiKey) {
        try {
            data = await fetchWeatherCom(options);
            source = "weathercom";
        } catch (err) {
            errors.push(`Weather.com: ${err.message}`);
            options.log.warn(`Weather.com failed: ${err.message}`);
        }
    }
    if (!source && options.noaaFallback) {
        if (options.apiKey) options.log.warn("falling back to NOAA");
        try {
            data = await fetchNOAA(options, cache);
            source = "noaa";
        } catch (err) {
            errors.push(`NOAA: ${err.message}`);
            options.log.error(`NOAA failed: ${err.message}`);
        }
    }

    const now = Date.now();
    if (!source) {
        if (!options.apiKey && !options.noaaFallback) {
            errors.push("no source configured: set apiKey or enable noaaFallback");
        }
        const error = errors.join("; ");
        if (previous && previous.source) {
            return Object.assign({}, previous, { stale: true, error: error, lastAttemptAt: now });
        }
        return {
            id: options.id,
            source: null,
            sourceLabel: "Unavailable",
            isFallback: false,
            stale: false,
            error: error,
            lastAttemptAt: now
        };
    }

    const isFallback = source === "noaa" && Boolean(options.apiKey);
    return Object.assign(
        {
            id: options.id,
            source: source,
            sourceLabel: source === "weathercom" ? "Weather.com" : isFallback ? "NOAA (backup)" : "NOAA",
            isFallback: isFallback,
            stale: false,
            // Errors that caused a fallback are still reported
            error: errors.length ? errors.join("; ") : null,
            fetchedAt: now,
            lastAttemptAt: now,
            location: { lat: Number(options.lat), lon: Number(options.lon) },
            units: options.units === "imperial" ? "imperial" : "metric",
            weathercom: source === "weathercom" ? data : null,
            noaa: source === "noaa" ? data : null
        },
        getUpdateTimes(source, data)
    );
}

module.exports = {
    fetchWeather,
    fetchWeatherCom,
    fetchNOAA,
    getUpdateTimes,
    weatherComIconName,
    noaaIconName
};
