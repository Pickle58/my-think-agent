import {
	isValidElement,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./client.css";

const JSON_FENCE = /```json\r?\n([\s\S]*?)\r?\n```/g;
const AUTO_READ_KEY = "think-agent-auto-read";
const TTS_PATH = "/agents/my-agent/default/tts";

function prettyJson(text: string): string | null {
	const trimmed = text.trim();
	if (!/^[[{]/.test(trimmed)) return null;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return null;
	}
}

function jsonFence(json: string): string {
	return `\`\`\`json\n${json}\n\`\`\``;
}

function toMarkdownSource(text: string): string {
	const pretty = prettyJson(text);
	if (pretty) return jsonFence(pretty);
	return text.replace(JSON_FENCE, (block, body: string) => {
		const formatted = prettyJson(body);
		return formatted ? jsonFence(formatted) : block;
	});
}

function ttsUrl(messageId: string): string {
	return `${TTS_PATH}?messageId=${encodeURIComponent(messageId)}`;
}

function useSpeech() {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const generationRef = useRef(0);
	const [playingId, setPlayingId] = useState<string | null>(null);
	const [loadingId, setLoadingId] = useState<string | null>(null);

	useEffect(() => {
		const audio = new Audio();
		audioRef.current = audio;

		const onEnded = () => {
			setPlayingId(null);
			setLoadingId(null);
		};
		const onError = () => {
			if (!audio.getAttribute("src")) return;
			setPlayingId(null);
			setLoadingId(null);
		};
		const onPlaying = () => {
			setLoadingId(null);
		};
		audio.addEventListener("ended", onEnded);
		audio.addEventListener("error", onError);
		audio.addEventListener("playing", onPlaying);

		return () => {
			generationRef.current += 1;
			audio.pause();
			audio.removeAttribute("src");
			audio.removeEventListener("ended", onEnded);
			audio.removeEventListener("error", onError);
			audio.removeEventListener("playing", onPlaying);
			audioRef.current = null;
		};
	}, []);

	const stop = () => {
		generationRef.current += 1;
		const audio = audioRef.current;
		if (audio) {
			audio.pause();
			audio.removeAttribute("src");
		}
		setPlayingId(null);
		setLoadingId(null);
	};

	const play = async (messageId: string): Promise<"ok" | "blocked" | "error"> => {
		const audio = audioRef.current;
		if (!audio) return "error";

		const generation = ++generationRef.current;
		audio.pause();
		audio.removeAttribute("src");
		setLoadingId(messageId);
		setPlayingId(messageId);
		audio.src = ttsUrl(messageId);

		try {
			await audio.play();
			if (generation !== generationRef.current) return "ok";
			return "ok";
		} catch (error) {
			if (generation !== generationRef.current) return "ok";
			setPlayingId(null);
			setLoadingId(null);
			if (
				error instanceof DOMException &&
				error.name === "NotAllowedError"
			) {
				return "blocked";
			}
			return "error";
		}
	};

	return { play, stop, playingId, loadingId };
}

function useAutoReadPreference() {
	const [enabled, setEnabled] = useState(() => {
		try {
			return localStorage.getItem(AUTO_READ_KEY) === "1";
		} catch {
			return false;
		}
	});

	const setAutoRead = (next: boolean) => {
		setEnabled(next);
		try {
			localStorage.setItem(AUTO_READ_KEY, next ? "1" : "0");
		} catch {
			/* ignore quota / private mode */
		}
	};

	return [enabled, setAutoRead] as const;
}

const markdownComponents: Components = {
	pre({ node: _node, children, ...props }) {
		const block = <pre {...props}>{children}</pre>;
		const isJson =
			isValidElement<{ className?: string }>(children) &&
			children.props.className?.includes("language-json");
		if (!isJson) return block;
		return (
			<details className="json-block">
				<summary>
					<span className="json-show">Show data</span>
					<span className="json-hide">Hide data</span>
				</summary>
				{block}
			</details>
		);
	},
};

function Chat() {
	const agent = useAgent({ agent: "MyAgent" });
	const { messages, sendMessage, status } = useAgentChat({ agent });
	const { play, stop, playingId, loadingId } = useSpeech();
	const [autoRead, setAutoRead] = useAutoReadPreference();
	const spokenIdsRef = useRef<Set<string>>(new Set());
	const seededRef = useRef(false);
	const prevStatusRef = useRef(status);

	useEffect(() => {
		if (seededRef.current) return;
		if (messages.length === 0) return;
		if (status === "streaming" || status === "submitted") return;
		spokenIdsRef.current = new Set(messages.map((m) => m.id));
		seededRef.current = true;
	}, [messages, status]);

	const onTurnReady = useEffectEvent(async () => {
		if (!autoRead) return;
		const lastAssistant = [...messages]
			.reverse()
			.find((m) => m.role === "assistant");
		if (!lastAssistant) return;
		if (spokenIdsRef.current.has(lastAssistant.id)) return;

		spokenIdsRef.current.add(lastAssistant.id);
		seededRef.current = true;
		const result = await play(lastAssistant.id);
		if (result === "blocked") {
			setAutoRead(false);
		}
	});

	useEffect(() => {
		const prev = prevStatusRef.current;
		prevStatusRef.current = status;
		if (
			(prev === "streaming" || prev === "submitted") &&
			status === "ready"
		) {
			void onTurnReady();
		}
	}, [status]);

	const handleAutoReadToggle = () => {
		const next = !autoRead;
		setAutoRead(next);
		if (!next) stop();
	};

	return (
		<div className="flex h-full flex-col bg-canvas text-ink">
			<header className="shrink-0 border-b border-border bg-panel/80 px-4 py-3 backdrop-blur">
				<div className="mx-auto flex max-w-3xl items-center gap-3">
					<span
						className="size-2.5 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"
						aria-hidden
					/>
					<h1 className="text-lg font-semibold tracking-tight text-ink">
						Think Agent
					</h1>
					<label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted select-none">
						<input
							type="checkbox"
							checked={autoRead}
							onChange={handleAutoReadToggle}
							className="accent-[var(--color-accent)]"
						/>
						Auto-read
					</label>
				</div>
			</header>

			<main className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
				<div className="flex-1 space-y-4 overflow-y-auto scrollbar-none px-4 py-6">
					{messages.length === 0 ? (
						<div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center">
							<p className="text-base font-medium text-ink">
								Start a conversation
							</p>
							<p className="max-w-sm text-sm text-muted">
								Ask about the weather, briefing settings, or anything else.
							</p>
						</div>
					) : (
						messages.map((msg) => {
							const isUser = msg.role === "user";
							const isPlaying = playingId === msg.id;
							const isLoading = loadingId === msg.id;
							return (
								<div
									key={msg.id}
									className={`flex ${isUser ? "justify-end" : "justify-start"}`}
								>
									<div
										className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
											isUser
												? "bg-bubble text-ink"
												: "border border-border bg-panel text-ink"
										}`}
									>
										{!isUser && (
											<div className="mb-1 flex items-center gap-2">
												<p className="text-xs font-medium uppercase tracking-wide text-muted">
													Assistant
												</p>
												<button
													type="button"
													onClick={() => {
														if (isPlaying || isLoading) {
															stop();
															return;
														}
														spokenIdsRef.current.add(msg.id);
														void play(msg.id);
													}}
													className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent transition hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
												>
													{isLoading
														? "Loading…"
														: isPlaying
															? "Stop"
															: "Listen"}
												</button>
											</div>
										)}
										{msg.parts.map((part, i) =>
											part.type === "text" ? (
												<div key={i} className="markdown">
													<ReactMarkdown
														remarkPlugins={[remarkGfm]}
														rehypePlugins={[rehypeHighlight]}
														components={markdownComponents}
													>
														{toMarkdownSource(part.text)}
													</ReactMarkdown>
												</div>
											) : null,
										)}
									</div>
								</div>
							);
						})
					)}
				</div>

				<div className="shrink-0 border-t border-border bg-panel/60 px-4 py-3 backdrop-blur">
					<form
						className="flex gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							const input = e.currentTarget.elements.namedItem(
								"input",
							) as HTMLInputElement;
							if (!input.value.trim()) return;
							sendMessage({ text: input.value });
							input.value = "";
						}}
					>
						<input
							name="input"
							placeholder="Send a message..."
							className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/40"
						/>
						<button
							type="submit"
							className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
						>
							Send
						</button>
					</form>
					<p className="mt-2 text-xs text-muted">Status: {status}</p>
				</div>
			</main>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Chat />);
}
