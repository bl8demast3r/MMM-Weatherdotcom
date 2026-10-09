# MMM-Weatherdotcom

A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) module that polls [Weather.com](https://weather.com/) for weather data, with the [NOAA National Weather Service API](https://www.weather.gov/documentation/services-web-api) as a backup, and shares that data with other modules.

Several weather modules on one mirror usually each poll the same weather source. With MMM-Weatherdotcom, the weather is fetched **once** per update interval, on the MagicMirror server, and every module that needs it receives the same data. That holds no matter how many modules use the data or how many browsers show the mirror.

MMM-Weatherdotcom also hosts the weather icon sets used by the modules that display the data.

Modules that use MMM-Weatherdotcom:

- [MMM-WeatherdotcomForecast](https://github.com/bl8demast3r/MMM-WeatherdotcomForecast): current conditions, hourly and daily forecast, and weather alerts
- [MMM-WeatherdotcomChart](https://github.com/bl8demast3r/MMM-WeatherdotcomChart): hourly and daily forecast charts

## Weather.com API key

> [!IMPORTANT]
> **A Weather.com API key must be purchased directly from Weather.com (The Weather Company).** No API keys are included in this repository, and you must not commit your key to a public repository.
>
> Without an API key, MMM-Weatherdotcom uses NOAA only. NOAA needs no key, but it only covers the United States and its territories.

## Installation

```sh
cd ~/MagicMirror/modules
git clone https://github.com/bl8demast3r/MMM-Weatherdotcom.git
```

There are no dependencies to install. Node.js 22 or later is required, which MagicMirror² already requires.

Then install the modules that display the data, such as [MMM-WeatherdotcomForecast](https://github.com/bl8demast3r/MMM-WeatherdotcomForecast) or [MMM-WeatherdotcomChart](https://github.com/bl8demast3r/MMM-WeatherdotcomChart).

## Configuration

Add MMM-Weatherdotcom to the `modules` array in `config/config.js`, once, along with the modules that display the data:

```js
{
    module: "MMM-Weatherdotcom",
    config: {
        apiKey: "<your Weather.com API key>",
        lat: "40.7128",
        lon: "-74.0060"
    }
},
{
    module: "MMM-WeatherdotcomForecast",
    position: "top_right",
    header: "Forecast",
    config: { iconset: "4c" }
},
{
    module: "MMM-WeatherdotcomChart",
    position: "top_left",
    config: { dataType: "daily", units: "imperial", showIcon: true, iconset: "4c" }
},
```

MMM-Weatherdotcom doesn't need a `position`. If you give it one, it shows a one-line status, e.g. `Source: Weather.com · Updated 15:47 · Expires 15:55`.

| Option | Default | Description |
|:-------|:--------|:------------|
| `apiKey` | `""` | Your [Weather.com API key](#weathercom-api-key). If empty, only NOAA is used. |
| `lat` | (required) | Latitude of the location to get weather for |
| `lon` | (required) | Longitude of the location to get weather for |
| `units` | `config.units` | `imperial` or `metric`: the units Weather.com data is requested in. Modules showing the data convert it to their own units if they differ. |
| `language` | `"en-US"` | Language of Weather.com text such as forecast narratives and alerts |
| `updateInterval` | `10` | How often to poll, in minutes (at least 1). Weather.com refreshes its forecasts roughly every 10 minutes. |
| `noaaFallback` | `true` | Use NOAA when Weather.com fails (or when no `apiKey` is set). NOAA only covers the United States and its territories. |
| `fetchAlerts` | `true` | Also fetch active weather alerts |
| `maxAlertDetails` | `10` | Maximum number of alerts to fetch the full text of (Weather.com only) |
| `timeFormat` | `config.timeFormat` | `12` or `24`: time format of the status line |

## How the weather sources are used

1. When `apiKey` is set, the current conditions, 15-day daily and hourly forecasts and active alerts are fetched from Weather.com.
2. If a Weather.com request fails (for example, the key has expired or the service is down), NOAA is used for that update instead, and Weather.com is tried again on the next one. NOAA is always used when there is no `apiKey`.
3. If every source fails, the last good data is sent again, marked as stale, so the mirror keeps showing it.

Modules show the source currently in use, so you can tell when the backup is in use:

| Source status | Meaning |
|:--------------|:--------|
| `Weather.com` | Data is from Weather.com |
| `NOAA (backup)` | Weather.com failed, so data is from NOAA. Modules highlight this status. |
| `NOAA` | No `apiKey` is set, so NOAA is the only source |
| *(any of the above)* `(offline)` | Every source failed; the last good data is shown |

The reason for a fallback is logged on the MagicMirror server, with the API key masked.

### Update times

The update time sent with the data is when the weather source updated it, not when MMM-Weatherdotcom fetched it:

- **Weather.com**: the time of the current conditions observation (`validTimeUtc`). Weather.com doesn't publish an issue time for its forecasts.
- **NOAA**: the time of the latest station observation, and the time the National Weather Service last updated the forecast.

Weather.com also publishes when its data expires, i.e. is due to be refreshed. This is sent as `expiresAt`: the earliest `expirationTimeUtc` of the current conditions and forecasts, usually about 10 minutes after the observation. NOAA publishes no expiration time.

## For module developers

MMM-Weatherdotcom broadcasts the `WEATHERDOTCOM_DATA` notification to all modules after each update. A module that starts after the data was sent can send `WEATHERDOTCOM_REQUEST` (for example on `ALL_MODULES_STARTED`) to have the latest data sent again.

```js
notificationReceived: function (notification, payload) {
    if (notification === "ALL_MODULES_STARTED") {
        this.sendNotification("WEATHERDOTCOM_REQUEST");
    } else if (notification === "WEATHERDOTCOM_DATA" && payload.source) {
        // use payload.weathercom or payload.noaa
    }
}
```

The payload:

| Field | Description |
|:------|:------------|
| `source` | `"weathercom"`, `"noaa"`, or `null` when no data could be fetched yet |
| `sourceLabel` | `"Weather.com"`, `"NOAA (backup)"`, `"NOAA"` or `"Unavailable"` |
| `isFallback` | `true` when NOAA is used because Weather.com failed |
| `stale` | `true` when every source failed and this is the last good data |
| `error` | Why a source failed, or `null` |
| `updatedAt` | When the source last updated the data (epoch ms) |
| `currentUpdatedAt` | When the current conditions were observed (epoch ms) |
| `forecastUpdatedAt` | When the forecast was issued (epoch ms), or `null` (Weather.com doesn't publish this) |
| `expiresAt` | When Weather.com says the data is due to be refreshed (epoch ms), or `null` (NOAA doesn't publish this) |
| `fetchedAt` | When MMM-Weatherdotcom fetched the data (epoch ms) |
| `location` | `{ lat, lon }` |
| `units` | `"imperial"` or `"metric"` |
| `iconPath` | URL of the icon sets, e.g. `iconPath + "/1c/rain.svg"` |
| `weathercom` | Weather.com data, or `null`. `{ units, current, daily, hourly, alerts }`: the responses of the Weather.com v3 APIs `wx/observations/current`, `wx/forecast/daily/15day`, `wx/forecast/hourly/15day` and `alerts/headlines` (each alert with its `texts` from `alerts/detail`). `units` is `"e"` (English) or `"m"` (metric). |
| `noaa` | NOAA data, or `null`. `{ forecast, forecastHourly, forecastGridData, observation, alerts }`: the [NWS API](https://www.weather.gov/documentation/services-web-api) responses. `forecastGridData`, `observation` and `alerts` may be `null`. |

To make the icon sets easy to use, an icon name is added to the data:

- Weather.com: `current.iconName`, `hourly.iconName[i]` and `daily.daypart[0].iconName[i]`, alongside the `iconCode` arrays
- NOAA: `iconName` on each period of `forecast` and `forecastHourly`

Icon names are `clear-day`, `clear-night`, `partly-cloudy-day`, `partly-cloudy-night`, `cloudy`, `fog`, `rain`, `sleet`, `snow`, `hail`, `thunderstorm`, `tornado` or `wind`, or `null` when the source gives no condition.

### Tests

```sh
npm test
```

## Icon sets

Each set is a folder in `icons/`: `1c`–`5c` (color), `1m`–`5m` (monochrome), and `6fa` / `6oa` (animated SVG). Besides the weather icons, each set has inline icons for wind, rain, snow, humidity, dew point, sunrise, sunset, pressure, UV index and visibility (`i-wind`, `i-rain`, …).

![Icon Sets](icons/iconsets.gif?raw=true "Icon Sets")

Open `icons/icon-preview.html` in a browser to preview every set.

## Attributions

The icon sets were collected by [MMM-NOAAForecast](https://github.com/bl8demast3r/MMM-NOAAForecast) (Marcus Markiewicz and bl8demast3r), which built on [MMM-OpenWeatherForecast](https://github.com/Tom-Hirschberger/MMM-OpenWeatherForecast) by Jeff Clarke and Tom Hirschberger. The icons were made by:

**Climacons by Adam Whitcroft**<br />
http://adamwhitcroft.com/climacons/

**Free Weather Icons by Svilen Petrov**<br />
https://www.behance.net/gallery/12410195/Free-Weather-Icons

**Weather Icons by Thom**<br />
(Designed for DuckDuckGo)<br />
https://dribbble.com/shots/1832162-Weather-Icons

**Sets 4 and 5** were found on Graphberry, but the original artists couldn't be found.<br />
https://www.graphberry.com/item/weather-icons<br />
https://www.graphberry.com/item/weathera-weather-forecast-icons

**Sets 6fa and 6oa: Meteocons by Bas Milius** (MIT License)<br />
https://github.com/basmilius/weather-icons

**Inline condition icons** (`i-humidity`, `i-dewpoint`, `i-sunrise`, `i-sunset`, `i-pressure`, `i-uv`, `i-visibility`) were added in [bl8demast3r/MMM-NOAAForecast](https://github.com/bl8demast3r/MMM-NOAAForecast).

Some of the icons were modified to better work with the modules' structure and aesthetic.

The Weather.com icon code mapping follows the "TWC Icon Codes" table in [Home-Assistant-weatherdotcom](https://github.com/jaydeethree/Home-Assistant-weatherdotcom).

**Data from [Weather.com](https://weather.com/)** and **[NOAA](https://www.weather.gov/documentation/services-web-api)**.
