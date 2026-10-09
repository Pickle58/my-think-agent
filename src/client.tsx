import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/think/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./client.css";

function Chat() {
	const agent = useAgent({ agent: "MyAgent" });
	const { messages, sendMessage, status } = useAgentChat({ agent });

	return (
		<div>
			<h1>Think Agent</h1>
			{messages.map((msg) => (
				<div key={msg.id}>
					<strong>{msg.role}:</strong>
					{msg.parts.map((part, i) =>
						part.type === "text" ? (
							msg.role === "assistant" ? (
								<div key={i} className="markdown">
									<ReactMarkdown remarkPlugins={[remarkGfm]}>
										{part.text}
									</ReactMarkdown>
								</div>
							) : (
								<span key={i}>{part.text}</span>
							)
						) : null,
					)}
				</div>
			))}

			<form
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
				<input name="input" placeholder="Send a message..." />
				<button type="submit">Send</button>
			</form>

			<p>Status: {status}</p>
		</div>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<Chat />);
}