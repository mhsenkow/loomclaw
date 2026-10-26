import { useEffect, useRef } from "react";
import embed, { type VisualizationSpec } from "vega-embed";

/** Vega-Lite render target. Charts are evidence, so they re-render on spec change only. */
export function Chart({ spec, height = 200 }: { spec: Record<string, unknown>; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let view: { finalize: () => void } | null = null;
    let cancelled = false;

    embed(ref.current, { width: "container", height, ...spec } as VisualizationSpec, {
      actions: false,
      renderer: "canvas",
    })
      .then((r) => {
        if (cancelled) r.view.finalize();
        else view = r.view;
      })
      .catch((e) => {
        if (ref.current) {
          ref.current.innerHTML = `<div style="font-size:11px;color:var(--loom-warning)">chart failed: ${String(e).slice(0, 120)}</div>`;
        }
      });

    return () => { cancelled = true; view?.finalize(); };
  }, [spec, height]);

  return <div className="chart" ref={ref} />;
}
