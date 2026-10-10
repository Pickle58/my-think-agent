import {
	Think,
	type Session,
	type SessionMessage,
	type ThinkScheduledTaskContext,
	type ThinkScheduledTasks,
	type ThinkTime,
} from "@cloudflare/think";
import { tool, type LanguageModel, type ToolSet } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { z } from "zod";
import {
	fetchCurrentWeather,
	fetchDailyForecast,
	type DailyForecast,
} from "./weather";
import { sendDiscordMessage } from "./discord";

type BriefingSettings = {
	city: string;
	timezone: string;
	time: ThinkTime;
	enabled: boolean;
};

type LastBriefing = {
	occurrenceKey: string;
	text: string;
	sent: boolean;
};

type AgentState = {
	briefing: BriefingSettings;
	lastBriefing: LastBriefing | null;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TTS_SPEAKER = "asteria";
const TTS_MAX_CHARS = 2000;
const TTS_MESSAGE_ID_MAX = 128;
const TTS_MODEL = "@cf/deepgram/aura-2-en" as const;

function isValidTimezone(timezone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return true;
	} catch {
		return false;
	}
}

function messageText(message: SessionMessage): string {
	return message.parts
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("")
		.trim();
}

/** Strip markdown/code so TTS reads spoken prose only. */
function speakableText(raw: string): string {
	return raw
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/https?:\/\/\S+/gi, " ")
		.replace(/[#>*_~\[\](){}|\\]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function truncateAtSentence(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const slice = text.slice(0, maxChars);
	const sentenceEnd = Math.max(
		slice.lastIndexOf(". "),
		slice.lastIndexOf("! "),
		slice.lastIndexOf("? "),
	);
	if (sentenceEnd >= maxChars * 0.5) {
		return slice.slice(0, sentenceEnd + 1).trim();
	}
	const wordEnd = slice.lastIndexOf(" ");
	return (wordEnd > 0 ? slice.slice(0, wordEnd) : slice).trim();
}

async function audioBytesFromAiResult(output: unknown): Promise<Uint8Array> {
	if (output instanceof Response) {
		return new Uint8Array(await output.arrayBuffer());
	}
	if (output instanceof Uint8Array) {
		return output;
	}
	if (output instanceof ArrayBuffer) {
		return new Uint8Array(output);
	}
	if (output instanceof ReadableStream) {
		const reader = (output as ReadableStream<Uint8Array>).getReader();
		const chunks: Uint8Array[] = [];
		let totalLength = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			totalLength += value.length;
		}
		const result = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result;
	}
	if (typeof output === "object" && output !== null) {
		const audio = (output as { audio?: unknown }).audio;
		if (typeof audio === "string") {
			return Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
		}
	}
	throw new Error(
		`Unexpected TTS output type: ${Object.prototype.toString.call(output)}`,
	);
}

function buildBriefingPrompt(forecast: DailyForecast): string {
	return [
		`[Scheduled] Daily weather briefing for ${forecast.location.name}, ${forecast.location.region}.`,
		"Using ONLY the forecast data below (do not call tools), write a friendly morning briefing under 1200 characters with:",
		"- Umbrella advice based on chance of rain",
		"- What to wear",
		"- Notable temperature swings through the day (give the times)",
		"- A UV warning if UV is 6 or higher at any hour",
		"- Any active weather alerts",
		"",
		"```json",
		JSON.stringify(forecast),
		"```",
	].join("\n");
}

export class MyAgent extends Think<Env, AgentState> {
	initialState: AgentState = {
		briefing: {
			city: this.env.BRIEFING_DEFAULT_CITY,
			timezone: this.env.BRIEFING_DEFAULT_TIMEZONE,
			time: "07:00",
			enabled: true,
		},
		lastBriefing: null,
	};

	getModel(): LanguageModel {
		return createWorkersAI({ binding: this.env.AI })(
			"@cf/zai-org/glm-4.7-flash",
		);
	}

	async onRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method !== "GET" || !url.pathname.endsWith("/tts")) {
			return new Response("Not found", { status: 404 });
		}

		const messageId = url.searchParams.get("messageId")?.trim() ?? "";
		if (!messageId || messageId.length > TTS_MESSAGE_ID_MAX) {
			return new Response("Bad request", { status: 400 });
		}

		const message = await this.session.getMessage(messageId);
		if (!message || message.role !== "assistant") {
			return new Response("Not found", { status: 404 });
		}

		const text = truncateAtSentence(
			speakableText(messageText(message)),
			TTS_MAX_CHARS,
		);
		if (!text) {
			return new Response(null, { status: 204 });
		}

		try {
			const result = await this.env.AI.run(
				TTS_MODEL,
				{
					text,
					speaker: TTS_SPEAKER,
					encoding: "mp3",
				},
				{ returnRawResponse: true },
			);

			if (result instanceof Response && !result.ok) {
				const errorBody = await result
					.text()
					.catch(() => "<unable to read response body>");
				console.error("tts binding error", {
					model: TTS_MODEL,
					messageId,
					status: result.status,
					errorBody,
				});
				return new Response("TTS failed", { status: 502 });
			}

			const audio = await audioBytesFromAiResult(result);
			const body = new Uint8Array(audio.byteLength);
			body.set(audio);
			return new Response(body, {
				status: 200,
				headers: {
					"Content-Type": "audio/mpeg",
					"Cache-Control": "private, max-age=3600",
				},
			});
		} catch (error) {
			console.error("tts failed", {
				model: TTS_MODEL,
				messageId,
				error: error instanceof Error ? error.message : String(error),
			});
			return new Response("TTS failed", { status: 502 });
		}
	}

	configureSession(session: Session) {
		return session
			.withContext("soul", {
				provider: {
					get: async () =>
						"You are a helpful assistant with access to a workspace filesystem. Remember important facts about the user.",
				},
			})
			.withContext("memory", {
				description: "Important facts about the user and conversation.",
				maxTokens: 2000,
			})
			.withCachedPrompt();
	}

	getScheduledTasks(): ThinkScheduledTasks {
		const { briefing } = this.state;
		if (!briefing.enabled) {
			return {};
		}
		return {
			dailyWeatherBriefing: {
				schedule: `every day at ${briefing.time}`,
				timezone: briefing.timezone,
				retry: { maxAttempts: 3 },
				handler: (ctx) => this.generateDailyBriefing(ctx),
			},
		};
	}

	async generateDailyBriefing(ctx: ThinkScheduledTaskContext): Promise<void> {
		const previous = this.state.lastBriefing;
		if (previous?.occurrenceKey === ctx.occurrenceKey && previous.sent) {
			return;
		}

		const { city } = this.state.briefing;
		let text =
			previous?.occurrenceKey === ctx.occurrenceKey ? previous.text : "";

		if (!text) {
			const forecast = await fetchDailyForecast(this.env.WEATHER_KEY, city);
			const result = await this.runTurn({
				input: buildBriefingPrompt(forecast),
			});
			if (result.status !== "completed" || !result.message) {
				throw new Error(
					`Briefing turn ${result.status}: ${result.error ?? "no message"}`,
				);
			}
			text = messageText(result.message);
			if (!text) {
				throw new Error("Briefing turn produced no text");
			}
			this.setState({
				...this.state,
				lastBriefing: {
					occurrenceKey: ctx.occurrenceKey,
					text,
					sent: false,
				},
			});
		}

		await sendDiscordMessage(
			this.env.DISCORD_WEBHOOK_URL,
			`**Weather briefing: ${city}**\n${text}`,
		);
		this.setState({
			...this.state,
			lastBriefing: {
				occurrenceKey: ctx.occurrenceKey,
				text,
				sent: true,
			},
		});
		console.log("daily briefing sent", {
			occurrenceKey: ctx.occurrenceKey,
			city,
		});
	}

	getTools(): ToolSet {
		return {
			getWeather: tool({
				description: "Get the current weather for a city",
				inputSchema: z.object({
					city: z.string().describe("City name"),
				}),
				execute: async ({ city }) =>
					fetchCurrentWeather(this.env.WEATHER_KEY, city),
			}),
			getBriefingSettings: tool({
				description: "Read the user's daily weather briefing settings",
				inputSchema: z.object({}),
				execute: async () => this.state.briefing,
			}),
			setBriefingSettings: tool({
				description:
					"Update the daily weather briefing: city, IANA timezone, local delivery time (24h HH:mm), or enable/disable it.",
				inputSchema: z.object({
					city: z.string().trim().min(1).max(100).optional(),
					timezone: z
						.string()
						.refine(
							isValidTimezone,
							"Must be an IANA timezone like America/Los_Angeles",
						)
						.optional(),
					time: z.string().regex(TIME_PATTERN, "Use 24h HH:mm").optional(),
					enabled: z.boolean().optional(),
				}),
				execute: async (input) => {
					const current = this.state.briefing;
					const briefing: BriefingSettings = {
						city: input.city ?? current.city,
						timezone: input.timezone ?? current.timezone,
						time: (input.time as ThinkTime | undefined) ?? current.time,
						enabled: input.enabled ?? current.enabled,
					};
					this.setState({ ...this.state, briefing });
					await this.internal_reconcileScheduledTasks();
					return { ok: true, briefing };
				},
			}),
		};
	}
}

export default {
	async fetch(request: Request, env: Env) {
		return (
			(await routeAgentRequest(request, env)) ||
			new Response("Not found", { status: 404 })
		);
	},
} satisfies ExportedHandler<Env>;
