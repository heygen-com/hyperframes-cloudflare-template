import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { chat, toServerSentEventsResponse } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";

type OpenRouterModel = Parameters<typeof createOpenRouterText>[0];
import { SYSTEM_PROMPT_WITH_EXAMPLE, buildUserPrompt } from "../../lib/hyperframes-skill";
import { DEFAULT_MODEL } from "../../lib/generation";
import { isJsonRequest, jsonError, msg, utf8ByteLength } from "../../lib/server/assets";

const MAX_PROMPT_BYTES = 8 * 1024;
const MAX_KEY_BYTES = 1024;
const MAX_OUTPUT_TOKENS = 16000;
// durationSec is only a prompt hint, but an absurd value could steer the
// model toward a very long composition that inflates render time/cost.
const MAX_DURATION_SEC = 120;

interface GenerateRequestBody {
  messages?: Array<Record<string, unknown>>;
  forwardedProps?: {
    apiKey?: unknown;
    model?: unknown;
    durationSec?: unknown;
  };
}

/**
 * Wrap the first user message (the raw prompt from the panel) in the
 * HyperFrames task template. Later user turns are lint-fix requests and pass
 * through untouched, as does everything the model said.
 */
function wrapFirstUserMessage(
  messages: Array<Record<string, unknown>>,
  durationSec: number | undefined,
): Array<Record<string, unknown>> {
  let wrapped = false;
  return messages.map((m) => {
    if (wrapped || m.role !== "user") return m;
    wrapped = true;
    if (typeof m.content === "string") {
      return { ...m, content: buildUserPrompt(m.content, durationSec) };
    }
    if (Array.isArray(m.parts)) {
      return {
        ...m,
        parts: m.parts.map((p: Record<string, unknown>) =>
          p.type === "text" && typeof p.content === "string"
            ? { ...p, content: buildUserPrompt(p.content, durationSec) }
            : p,
        ),
      };
    }
    return m;
  });
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (env.ENABLE_AI_GEN !== "true") {
          return jsonError(
            'AI generation is disabled on this deployment. Set ENABLE_AI_GEN="true" in wrangler.jsonc vars to enable BYOK generation.',
            403,
          );
        }

        if (!isJsonRequest(request)) {
          return jsonError("expected application/json", 415);
        }

        let body: GenerateRequestBody;
        try {
          body = (await request.json()) as GenerateRequestBody;
        } catch {
          return jsonError("invalid JSON body", 400);
        }

        const props = body.forwardedProps ?? {};
        const apiKey = props.apiKey;
        if (!apiKey || typeof apiKey !== "string") {
          return jsonError("missing apiKey (your OpenRouter key)", 400);
        }
        if (apiKey.length > MAX_KEY_BYTES) {
          return jsonError("apiKey too long", 400);
        }

        const messages = body.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          return jsonError("missing messages", 400);
        }
        for (const m of messages) {
          if (m.role !== "user" && m.role !== "assistant") {
            return jsonError("invalid message role", 400);
          }
          if (m.role !== "user") continue;
          const text =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(m.parts)
                ? m.parts
                    .map((p: Record<string, unknown>) =>
                      typeof p.content === "string" ? p.content : "",
                    )
                    .join("")
                : "";
          if (utf8ByteLength(text) > MAX_PROMPT_BYTES) {
            return jsonError(`prompt exceeds ${MAX_PROMPT_BYTES} bytes`, 413);
          }
        }

        // Deliberate widening: BYOK callers may pass any OpenRouter model id,
        // not just the ones in the adapter's union. OpenRouter rejects unknown
        // ids upstream and the error streams back to the client.
        const model = (
          typeof props.model === "string" ? props.model : DEFAULT_MODEL
        ) as OpenRouterModel;
        const durationSec =
          typeof props.durationSec === "number" &&
          Number.isFinite(props.durationSec) &&
          props.durationSec > 0
            ? Math.min(props.durationSec, MAX_DURATION_SEC)
            : undefined;

        // Fix turns (any conversation with more than one user message) run
        // cooler than the initial creative pass.
        const userTurns = messages.filter((m) => m.role === "user").length;
        const temperature = userTurns > 1 ? 0.3 : 0.7;

        // The user's key is used for this one upstream call and never stored.
        const adapter = createOpenRouterText(model, apiKey, {
          httpReferer: request.headers.get("origin") ?? new URL(request.url).origin,
          appTitle: "HyperFrames Cloudflare Template",
        });

        try {
          const stream = chat({
            adapter,
            messages: wrapFirstUserMessage(messages, durationSec) as Parameters<
              typeof chat
            >[0]["messages"],
            systemPrompts: [SYSTEM_PROMPT_WITH_EXAMPLE],
            modelOptions: {
              temperature,
              maxCompletionTokens: MAX_OUTPUT_TOKENS,
            },
          });

          return toServerSentEventsResponse(stream);
        } catch (err) {
          return jsonError(`generation failed: ${msg(err)}`, 500);
        }
      },
    },
  },
});
