import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AiPanel } from "../components/AiPanel";
import { Player } from "../components/Player";
import { RenderControls } from "../components/RenderControls";
import { getAppConfig } from "../lib/server-fns";

export const Route = createFileRoute("/")({
  loader: () => getAppConfig(),
  component: Home,
});

function Home() {
  const { aiGenEnabled } = Route.useLoaderData();
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);

  return (
    <main>
      <header>
        <h1>HyperFrames on Cloudflare</h1>
        <p>
          HTML-based video compositions — previewed in the browser, rendered server-side in a
          Cloudflare Container. Generation streams through TanStack AI.
        </p>
      </header>

      {aiGenEnabled ? (
        <AiPanel onGenerated={(result) => setGeneratedHtml(result.html)} />
      ) : (
        <div className="ai-disabled">
          AI generation is disabled on this deployment. To enable: set{" "}
          <code>ENABLE_AI_GEN: "true"</code> in <code>wrangler.jsonc</code> vars and redeploy.
        </div>
      )}

      <Player html={generatedHtml} />

      <RenderControls generatedHtml={generatedHtml} onReset={() => setGeneratedHtml(null)} />

      <footer>
        <a
          href="https://github.com/heygen-com/hyperframes"
          target="_blank"
          rel="noopener noreferrer"
        >
          HyperFrames on GitHub
        </a>
        <span>·</span>
        <a href="https://hyperframes.heygen.com" target="_blank" rel="noopener noreferrer">
          Docs
        </a>
        <span>·</span>
        <a href="https://tanstack.com/ai" target="_blank" rel="noopener noreferrer">
          TanStack AI
        </a>
      </footer>
    </main>
  );
}
