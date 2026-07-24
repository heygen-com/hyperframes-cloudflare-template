import { useEffect, useRef, useState } from "react";
import { useChat } from "@tanstack/ai-react";
import {
  DEFAULT_MODEL,
  MAX_GENERATE_ATTEMPTS,
  buildFixMessage,
  stripMarkdownFence,
  type LintError,
} from "../lib/generation";
import { lintComposition } from "../lib/server-fns";

// Restore the key across regenerations within a tab. sessionStorage
// (not localStorage) so closing the tab clears it.
const STORED_KEY = "openrouter-key";

interface Hint {
  className: string;
  text: string;
}

export interface GenerationResult {
  html: string;
  attempts: number;
  lintErrors: LintError[];
}

export function AiPanel({ onGenerated }: { onGenerated: (result: GenerationResult) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState<Hint | null>(null);

  // onFinish runs from the stream callback — refs keep it in sync without
  // re-creating the chat client mid-generation.
  const apiKeyRef = useRef("");
  const attemptsRef = useRef(1);
  const startedAtRef = useRef(0);

  useEffect(() => {
    try {
      const k = sessionStorage.getItem(STORED_KEY);
      if (k) {
        setApiKey(k);
        apiKeyRef.current = k;
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, []);

  // Custom fetcher instead of a connection adapter so each request carries
  // the current BYOK key (adapter `body` is fixed at client creation).
  const { messages, sendMessage, isLoading, error, clear } = useChat({
    fetcher: ({ messages: history, threadId, runId }, { signal }) =>
      fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history,
          threadId,
          runId,
          forwardedProps: { apiKey: apiKeyRef.current },
        }),
        signal,
      }),
    onFinish: (message) => {
      const html = stripMarkdownFence(
        message.parts
          .filter((p) => p.type === "text")
          .map((p) => ("content" in p && typeof p.content === "string" ? p.content : ""))
          .join(""),
      );
      void handleAssistantTurn(html);
    },
  });

  async function handleAssistantTurn(html: string) {
    if (!html) {
      setHint({ className: "hint error", text: "The model returned no HTML. Try again." });
      return;
    }

    setHint({ className: "hint", text: "Validating composition…" });
    let errors: LintError[];
    try {
      ({ errors } = await lintComposition({ data: { html } }));
    } catch {
      errors = [];
    }

    if (errors.length > 0 && attemptsRef.current < MAX_GENERATE_ATTEMPTS) {
      attemptsRef.current += 1;
      setHint({
        className: "hint",
        text: `Lint found ${errors.length} error${errors.length > 1 ? "s" : ""} — self-healing (attempt ${attemptsRef.current}/${MAX_GENERATE_ATTEMPTS})…`,
      });
      void sendMessage(buildFixMessage(errors));
      return;
    }

    const secs = ((Date.now() - startedAtRef.current) / 1000).toFixed(1);
    const attempts = attemptsRef.current;
    if (errors.length === 0) {
      setHint({
        className: "hint",
        text: `Done in ${secs}s (${attempts} pass${attempts > 1 ? "es" : ""}, model: ${DEFAULT_MODEL}). Click "Render MP4" to capture.`,
      });
    } else {
      setHint({
        className: "hint warn",
        text: `Generated with ${errors.length} lint error${errors.length > 1 ? "s" : ""} after ${attempts} attempts. Preview anyway — render may fail.`,
      });
    }
    onGenerated({ html, attempts, lintErrors: errors });
  }

  function handleGenerate() {
    const key = apiKey.trim();
    const p = prompt.trim();
    if (!key) {
      setHint({ className: "hint error", text: "Paste your OpenRouter key first." });
      return;
    }
    if (!p) {
      setHint({ className: "hint error", text: "Add a prompt describing the video." });
      return;
    }
    try {
      sessionStorage.setItem(STORED_KEY, key);
    } catch {
      /* sessionStorage unavailable */
    }

    apiKeyRef.current = key;
    attemptsRef.current = 1;
    startedAtRef.current = Date.now();
    setHint({ className: "hint", text: "Generating composition — streaming…" });
    clear();
    void sendMessage(p);
  }

  // Live view of the composition streaming in from the model.
  const streamingText = isLoading
    ? (messages.findLast((m) => m.role === "assistant")?.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => ("content" in p && typeof p.content === "string" ? p.content : ""))
        .join("")
    : "";

  const hintText = error && !isLoading ? { className: "hint error", text: error.message } : hint;

  return (
    <details className="ai-panel" open>
      <summary>
        Generate from a prompt
        <span className="badge">BYOK</span>
      </summary>
      <div className="ai-body">
        <p className="security-note">
          Bring your own{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
            OpenRouter API key
          </a>
          . <strong>Your key is forwarded once to OpenRouter and discarded</strong> — this worker
          does not log, persist, or cache it. The key lives in your tab's <code>sessionStorage</code>{" "}
          only; closing the tab clears it.
        </p>

        <div>
          <label htmlFor="api-key">
            <span className="lbl-detail">OpenRouter API key</span>
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="prompt">
            <span className="lbl-detail">Prompt</span> — describe the video you want
          </label>
          <textarea
            id="prompt"
            placeholder="e.g. A cinematic intro card for a startup called 'Northwind' — deep navy gradient, kinetic typography, the tagline 'we build wind' appears in DM Sans bold, accent in amber."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="ai-actions">
          <button onClick={handleGenerate} disabled={isLoading}>
            Generate composition
          </button>
          {hintText && <p className={hintText.className}>{hintText.text}</p>}
        </div>

        {isLoading && streamingText && (
          <div className="stream-view">
            <pre>{streamingText.slice(-2000)}</pre>
          </div>
        )}
      </div>
    </details>
  );
}
