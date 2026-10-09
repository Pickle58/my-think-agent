# my-think-agent

A personal chat agent on Cloudflare Workers, built with [`@cloudflare/think`](https://developers.cloudflare.com/agents/) and Durable Objects. It chats in the browser, looks up weather, and sends a daily weather briefing to Discord on a schedule.

## What it does

- Chat UI (React + Vite) talking to a `MyAgent` Durable Object over the Agents protocol.
- Workers AI model `@cf/zai-org/glm-4.7-flash`.
- Weather tool backed by [WeatherAPI.com](https://www.weatherapi.com/).
- Daily briefing: a Durable Object alarm runs `getScheduledTasks()`, fetches today's forecast, writes a summary into the chat, and posts it to a Discord webhook.

The schedule lives inside the Durable Object. No Worker cron trigger is required. The task id is stable, so waking the object or redeploying does not create duplicate jobs. Each occurrence is sent once, keyed by `occurrenceKey`.

## Project layout

| Path | Role |
| --- | --- |
| `src/server.ts` | `MyAgent` class, tools, schedule, briefing handler |
| `src/weather.ts` | WeatherAPI client (current conditions and daily forecast) |
| `src/discord.ts` | Discord webhook sender |
| `src/client.tsx` | Chat UI |
| `wrangler.jsonc` | Worker, Durable Object, vars, required secrets |

## Prerequisites

- [pnpm](https://pnpm.io/) 12 (`packageManager` is pinned to `12.10.1`)
- A Cloudflare account with Workers AI enabled
- A WeatherAPI.com API key
- A Discord incoming webhook URL (Channel settings → Integrations → Webhooks)

## Setup

```bash
pnpm install
```

Create `.env` in the project root (gitignored). Vite and Wrangler load it for local dev only. It is not deployed.

```bash
WEATHER_KEY="your-weatherapi-key"
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
```

Default briefing city and timezone are plain vars in `wrangler.jsonc`:

- `BRIEFING_DEFAULT_CITY` — `Seattle`
- `BRIEFING_DEFAULT_TIMEZONE` — `America/Los_Angeles`

These seed agent state the first time the Durable Object starts. After that, change them in chat.

## Local development

```bash
pnpm exec vite dev
```

Open the printed URL (usually `http://localhost:5173`). Workers AI calls remote resources even in local dev.

Useful chat prompts:

- "What's the weather in Colfax, CA?"
- "What are my daily weather briefing settings?"
- "Set my briefing to Colfax, CA, America/Los_Angeles, at 07:00 and enable it."
- "Disable my daily weather briefing."

To test the schedule without waiting until morning, set the time a couple of minutes ahead in `HH:mm` (24-hour, in the briefing timezone). The briefing should appear in chat and in the Discord channel the webhook belongs to. Restarting the dev server does not send that occurrence again.

## Deploy

Secrets in `.env` stay local. Set them on the Worker before the first deploy:

```bash
pnpm exec wrangler login
pnpm exec wrangler secret put WEATHER_KEY
pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
pnpm exec vite build
pnpm exec wrangler deploy
```

Production starts a new Durable Object with the default briefing (Seattle, 07:00 Pacific, enabled). Visit the deployed URL once and set your city and time in chat. Local history and settings do not carry over.

Watch logs:

```bash
pnpm exec wrangler tail
```

A successful run logs `daily briefing sent`. Logs are also in the Cloudflare dashboard under Workers → my-think-agent → Observability.

## Security

`/agents/*` and the chat UI have no authentication. Anyone who can reach the Worker can chat (using your Workers AI and WeatherAPI quota) and change briefing settings. API keys and the Discord webhook URL stay on the server and are not sent to the browser.

Before sharing the URL widely, put the Worker behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/) (or another auth layer) and turn off the public `workers.dev` route.
