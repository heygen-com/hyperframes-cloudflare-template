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
import { consumeOAuthCallback, startOpenRouterLogin } from "../lib/openrouter-oauth";

// The BYOK key is deliberately kept in React state only — never in
// sessionStorage/localStorage. Generated compositions execute in the player's
// iframe with allow-same-origin, so anything in origin storage would be one
// getItem() away from model-generated code. Note this is a bar-raiser, not an
// isolation boundary: same-origin code can still reach window.parent and dig
// the key out of React state or intercept the next request. The real
// blast-radius control is the spend-capped, revocable OAuth key. (The OAuth
// PKCE verifier briefly uses sessionStorage across the login redirect — see
// openrouter-oauth.ts for why that's safe.)
interface Hint {
  className: string;
  text: string;
}

export interface GenerationResult {
  html: string;
  attempts: number;
  lintErrors: LintError[];
}

const EXAMPLE_PROMPTS: Array<{ label: string; prompt: string }> = [
  {
    label: "Startup intro card",
    prompt:
      "A cinematic intro card for a startup called 'Northwind' — deep navy gradient, kinetic typography, the tagline 'we build wind' appears in DM Sans bold, accent in amber.",
  },
  {
    label: "Stats count-up",
    prompt:
      "A punchy stats reveal for a developer tool: three big numbers count up in sequence — '12ms cold starts', '99.99% uptime', '3M requests/day' — dark charcoal background, electric green accents, monospace digits, each stat punches in with a subtle camera shake.",
  },
  {
    label: "Quote reveal",
    prompt:
      "An elegant kinetic-typography quote card: the words 'Simplicity is the ultimate sophistication' appear one word at a time in a large serif face, cream background, ink-black text, a thin gold rule draws itself under the attribution '— Leonardo da Vinci' at the end.",
  },
];

export function AiPanel({ onGenerated }: { onGenerated: (result: GenerationResult) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [oauthConnected, setOauthConnected] = useState(false);
  const [showManualKey, setShowManualKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState<Hint | null>(null);

  // onFinish runs from the stream callback — refs keep it in sync without
  // re-creating the chat client mid-generation.
  const apiKeyRef = useRef("");
  const attemptsRef = useRef(1);
  const startedAtRef = useRef(0);

  // Returning from the OpenRouter consent page: exchange the one-time code
  // for a runtime key. The exchange is memoized in openrouter-oauth.ts, so a
  // second effect run (React strict mode, remount) awaits the same promise
  // and still receives the key even though the one-time code is consumed.
  useEffect(() => {
    let cancelled = false;
    consumeOAuthCallback()
      .then((key) => {
        if (cancelled || !key) return;
        setApiKey(key);
        setOauthConnected(true);
        setHint({ className: "hint", text: "Connected to OpenRouter — describe your video below." });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHint({
          className: "hint error",
          text: err instanceof Error ? err.message : "OpenRouter login failed — please try again.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogin() {
    setHint({ className: "hint", text: "Redirecting to OpenRouter…" });
    void startOpenRouterLogin();
  }

  function handleDisconnect() {
    setApiKey("");
    apiKeyRef.current = "";
    setOauthConnected(false);
    setHint(null);
  }

  // Custom fetcher instead of a connection adapter so each request carries
  // the current BYOK key (adapter `body` is fixed at client creation).
  const { messages, sendMessage, isLoading, error, clear } = useChat({
    fetcher: async ({ messages: history, threadId, runId }, { signal }) => {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history,
          threadId,
          runId,
          forwardedProps: { apiKey: apiKeyRef.current },
        }),
        signal,
      });
      if (!res.ok) {
        // The library's own non-ok handling throws "HTTP error! status: N"
        // without reading the body, discarding the server's actionable message.
        let message = `Request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          /* non-JSON error body — keep the status message */
        }
        throw new Error(message);
      }
      return res;
    },
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
    } catch (err) {
      console.error("lint server fn failed:", err);
      setHint({
        className: "hint warn",
        text: "Validation unavailable — skipping self-heal. Preview anyway; render may fail.",
      });
      onGenerated({ html, attempts: attemptsRef.current, lintErrors: [] });
      return;
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
      setHint({ className: "hint error", text: "Log in with OpenRouter (or paste a key) first." });
      return;
    }
    if (!p) {
      setHint({ className: "hint error", text: "Add a prompt describing the video." });
      return;
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
          Log in with{" "}
          <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">
            OpenRouter
          </a>{" "}
          to mint a key scoped to this app — you can revoke it anytime from your OpenRouter
          dashboard. <strong>Your key is forwarded once to OpenRouter per request and
          discarded</strong> — this worker does not log, persist, or cache it. In the browser it
          is held in memory for this tab only and cleared on reload — but generated compositions
          run with same-origin access in the preview, so treat the key as reachable by generated
          code. <strong>Use a spend-capped key and revoke it when done</strong> — that cap, not
          where the key is stored, is what limits your exposure.
        </p>

        {oauthConnected ? (
          <div className="ai-actions">
            <p className="hint">✓ Connected to OpenRouter</p>
            <button type="button" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="ai-actions">
            <button type="button" onClick={handleLogin}>
              Log in with OpenRouter
            </button>
            <button type="button" className="link-btn" onClick={() => setShowManualKey((v) => !v)}>
              {showManualKey ? "Hide manual key entry" : "…or paste an API key instead"}
            </button>
          </div>
        )}

        {!oauthConnected && showManualKey && (
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
        )}

        <div>
          <label htmlFor="prompt">
            <span className="lbl-detail">Prompt</span> — describe the video you want
          </label>
          <div className="example-prompts">
            <span className="lbl-detail">Try:</span>
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.label}
                type="button"
                className="example-chip"
                disabled={isLoading}
                onClick={() => setPrompt(ex.prompt)}
              >
                {ex.label}
              </button>
            ))}
          </div>
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
