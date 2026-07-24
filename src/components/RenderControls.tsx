import { useState } from "react";

type Hint =
  | { kind: "link"; url: string }
  | { kind: "message"; className: string; text: string };

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
      kind: "message",
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
        const raw = await res.text();
        let message = raw || `Render failed (${res.status})`;
        try {
          // /api/render errors are {"error": "..."} — show the message, not the envelope.
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          /* non-JSON error body — show as-is */
        }
        throw new Error(message);
      }
      const data = (await res.json()) as { url: string };
      setHint({ kind: "link", url: data.url });
    } catch (err) {
      setHint({
        kind: "message",
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
        (hint.kind === "link" ? (
          <p className="hint">
            Done —{" "}
            <a href={hint.url} target="_blank" rel="noopener noreferrer">
              open MP4
            </a>
          </p>
        ) : (
          <p className={hint.className}>{hint.text}</p>
        ))}
    </section>
  );
}
