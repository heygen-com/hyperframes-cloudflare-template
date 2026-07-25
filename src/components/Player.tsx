import { useEffect, useRef } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        width?: string | number;
        height?: string | number;
        controls?: boolean;
      };
    }
  }
}

/**
 * Wraps the <hyperframes-player> web component (loaded from
 * /_hyperframes/player.js). Plays the bundled composition via /api/preview
 * until a generated composition's HTML is supplied, then swaps to srcdoc.
 */
export function Player({ html }: { html: string | null }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (html) {
      el.removeAttribute("src");
      el.setAttribute("srcdoc", html);
    } else {
      el.removeAttribute("srcdoc");
      el.setAttribute("src", "/api/preview");
    }
  }, [html]);

  return (
    <section className="player-wrap">
      <hyperframes-player ref={ref} src="/api/preview" width="1920" height="1080" controls />
    </section>
  );
}
