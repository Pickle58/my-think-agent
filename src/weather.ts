const WEATHER_API = "https://api.weatherapi.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const BRIEFING_HOURS = new Set([6, 8, 10, 12, 14, 16, 18, 20, 22]);

interface RawForecastResponse {
	location: {
		name: string;
		region: string;
		country: string;
		localtime: string;
	};
	forecast: {
		forecastday: Array<{
			day: {
				maxtemp_c: number;
				mintemp_c: number;
				maxtemp_f: number;
				mintemp_f: number;
				maxwind_kph: number;
				totalprecip_mm: number;
				daily_chance_of_rain: number;
				daily_chance_of_snow: number;
				uv: number;
				condition: { text: string };
			};
			hour: Array<{
				time: string;
				temp_c: number;
				temp_f: number;
				chance_of_rain: number;
				uv: number;
				condition: { text: string };
			}>;
		}>;
	};
	alerts?: { alert: Array<{ headline: string }> };
}

export interface DailyForecast {
	location: RawForecastResponse["location"];
	day: Omit<
		RawForecastResponse["forecast"]["forecastday"][number]["day"],
		"condition"
	> & {
		condition: string;
	};
	hourly: Array<{
		time: string;
		temp_c: number;
		temp_f: number;
		chance_of_rain: number;
		uv: number;
		condition: string;
	}>;
	alerts: string[];
}

function weatherUrl(
	endpoint: "current" | "forecast",
	apiKey: string,
	city: string,
) {
	const url = new URL(`${WEATHER_API}/${endpoint}.json`);
	url.searchParams.set("key", apiKey);
	url.searchParams.set("q", city);
	if (endpoint === "forecast") {
		url.searchParams.set("days", "1");
		url.searchParams.set("aqi", "no");
		url.searchParams.set("alerts", "yes");
	}
	return url;
}

export async function fetchCurrentWeather(apiKey: string, city: string) {
	const res = await fetch(weatherUrl("current", apiKey, city), {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!res.ok) {
		return { error: `Weather request failed (${res.status})` };
	}
	return res.json();
}

export async function fetchDailyForecast(
	apiKey: string,
	city: string,
): Promise<DailyForecast> {
	const res = await fetch(weatherUrl("forecast", apiKey, city), {
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`Forecast request failed (${res.status})`);
	}
	const raw = (await res.json()) as RawForecastResponse;
	const today = raw.forecast.forecastday[0];
	if (!today) {
		throw new Error("Forecast response contained no days");
	}
	return {
		location: raw.location,
		day: { ...today.day, condition: today.day.condition.text },
		hourly: today.hour
			.filter((h) =>
				BRIEFING_HOURS.has(new Date(h.time.replace(" ", "T")).getHours()),
			)
			.map((h) => ({
				time: h.time,
				temp_c: h.temp_c,
				temp_f: h.temp_f,
				chance_of_rain: h.chance_of_rain,
				uv: h.uv,
				condition: h.condition.text,
			})),
		alerts: raw.alerts?.alert.map((a) => a.headline) ?? [],
	};
}
