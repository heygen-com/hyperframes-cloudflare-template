import { useState } from "react";

interface Hint {
  className: string;
  html?: { url: string };
  text?: string;
}

export function RenderControls({
  generatedHtml,
  onReset,
}: {
  generatedHtml: string | null;
  onReset: () => void;
}) {
  const [rendering, setRendering] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);

  async function handleRender() {
    setRendering(true);
    setHint({
      className: "hint",
      text: "Rendering. Cold renders take 1–2 minutes; warm renders are ~25s.",
    });

    try {
      const init: RequestInit = { method: "POST" };
      if (generatedHtml) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify({ html: generatedHtml });
      }
      const res = await fetch("/api/render", init);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Render failed (${res.status})`);
      }
      const data = (await res.json()) as { url: string };
      setHint({ className: "hint", html: { url: data.url } });
    } catch (err) {
      setHint({
        className: "hint error",
        text: err instanceof Error ? err.message : "Render failed",
      });
    } finally {
      setRendering(false);
    }
  }

  return (
    <section className="controls">
      <button onClick={handleRender} disabled={rendering}>
        Render MP4
      </button>
      {generatedHtml && (
        <button
          className="secondary"
          onClick={() => {
            setHint(null);
            onReset();
          }}
        >
          Reset to bundled composition
        </button>
      )}
      {hint &&
        (hint.html ? (
          <p className={hint.className}>
            Done —{" "}
            <a href={hint.html.url} target="_blank" rel="noopener noreferrer">
              open MP4
            </a>
          </p>
        ) : (
          <p className={hint.className}>{hint.text}</p>
        ))}
    </section>
  );
}
