import { isValidElement } from "react";
import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "./client.css";

const JSON_FENCE = /```json\r?\n([\s\S]*?)\r?\n```/g;

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
											<p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
												Assistant
											</p>
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
