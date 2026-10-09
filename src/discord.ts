const DISCORD_WEBHOOK_PATTERN =
	/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;
const DISCORD_MAX_CONTENT = 2000;
const REQUEST_TIMEOUT_MS = 10_000;

export async function sendDiscordMessage(
	webhookUrl: string,
	content: string,
): Promise<void> {
	if (!DISCORD_WEBHOOK_PATTERN.test(webhookUrl)) {
		throw new Error("DISCORD_WEBHOOK_URL is not a valid Discord webhook URL");
	}
	const body =
		content.length > DISCORD_MAX_CONTENT
			? `${content.slice(0, DISCORD_MAX_CONTENT - 1)}…`
			: content;
	const res = await fetch(webhookUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			content: body,
			allowed_mentions: { parse: [] },
		}),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`Discord webhook failed (${res.status})`);
	}
}
