/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { Download, Loader2, Settings2, X } from "lucide-react";
import { useStudio } from "./state/studioStore";
import { totalTokens } from "./generate/generateClient";
import { DETAIL, DETAIL_LEVELS } from "./detail";
import { EXPORT_FORMATS, exportModel, type ExportFormat } from "./exporters";
import type { ViewSettings } from "./state/types";

type Toggle = { key: "dots" | "mesh" | "wireframe" | "field" | "reasoning"; label: string; hint?: string };

const SHOW_TOGGLES: Toggle[] = [
  { key: "dots", label: "Model dots", hint: "The object itself, drawn as dots" },
  { key: "mesh", label: "Mesh", hint: "Solid surface" },
  { key: "wireframe", label: "Wireframe", hint: "Part edges" },
  { key: "field", label: "Space dots", hint: "The background lattice — heavier" },
  { key: "reasoning", label: "Reasoning", hint: "Expand Claude’s thinking on every reply" },
];

const fmt = (n: number) => n.toLocaleString();

/** Left-side panel: what to draw, detail, motion, export, and what the last AI build cost in tokens. */
export function SettingsPanel() {
  const { state, dispatch } = useStudio();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const { view, lastBuild: build } = state;
  const hasModel = state.shape.nodes.length > 0;
  const set = (patch: Partial<ViewSettings>) => dispatch({ type: "SET_VIEW", patch });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const runExport = async (format: ExportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      await exportModel(format, state.shape, state.partsProgram);
    } catch (e: any) {
      setExportError(e?.message || "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const stats: [string, string][] = build
    ? [
        ["Input", fmt(build.inputTokens)],
        ["Output (incl. thinking)", fmt(build.outputTokens)],
        ...(build.cacheReadTokens ? ([["Cache read", fmt(build.cacheReadTokens)]] as [string, string][]) : []),
        ...(build.cacheWriteTokens ? ([["Cache write", fmt(build.cacheWriteTokens)]] as [string, string][]) : []),
        ["Time", `${(build.ms / 1000).toFixed(1)}s`],
        ["Model", build.model],
      ]
    : [];

  return (
    <div className="settings-anchor">
      <button className="acct-btn" onClick={() => setOpen((o) => !o)} aria-label="Settings" aria-expanded={open}>
        <Settings2 size={17} />
      </button>

      {open && (
        <aside className="settings">
          <div className="settings-head">
            <span>Settings</span>
            <button className="settings-x" onClick={() => setOpen(false)} aria-label="Close settings">
              <X size={16} />
            </button>
          </div>

          <section>
            <div className="acct-label">Show</div>
            {SHOW_TOGGLES.map((t) => (
              <div key={t.key}>
                <label className="settings-row">
                  <span>
                    {t.label}
                    {t.hint && <small>{t.hint}</small>}
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={view[t.key]}
                    onChange={(e) => set({ [t.key]: e.target.checked })}
                  />
                </label>
                {t.key === "mesh" && view.mesh && (
                  <label className="settings-row col settings-sub">
                    <span>
                      Opacity <small className="inline">{Math.round(view.meshOpacity * 100)}%</small>
                    </span>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={view.meshOpacity}
                      onChange={(e) => set({ meshOpacity: Number(e.target.value) })}
                    />
                  </label>
                )}
              </div>
            ))}
          </section>

          <section>
            <div className="acct-label">Detail</div>
            <div className="seg-group" role="radiogroup" aria-label="Detail level">
              {DETAIL_LEVELS.map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={view.detail === d}
                  className={"seg-btn" + (view.detail === d ? " on" : "")}
                  onClick={() => set({ detail: d })}
                >
                  {DETAIL[d].label}
                </button>
              ))}
            </div>
            <small className="settings-note">
              {DETAIL[view.detail].hint}. Applies to new builds and edits; curves and dots update now.
            </small>
          </section>

          <section>
            <div className="acct-label">Motion</div>
            <label className="settings-row">
              <span>Auto-rotate</span>
              <input
                type="checkbox"
                className="switch"
                checked={view.autoRotate}
                onChange={(e) => set({ autoRotate: e.target.checked })}
              />
            </label>
            <label className="settings-row col">
              <span>
                Speed <small className="inline">{view.rotateSpeed}×</small>
              </span>
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.5}
                value={view.rotateSpeed}
                disabled={!view.autoRotate}
                onChange={(e) => set({ rotateSpeed: Number(e.target.value) })}
              />
            </label>
            <button className="settings-btn" onClick={() => dispatch({ type: "REFIT" })} disabled={!hasModel}>
              Reset view
            </button>
          </section>

          <section>
            <div className="acct-label">Export</div>
            <div className="export-grid">
              {EXPORT_FORMATS.map((f) => (
                <button
                  key={f.id}
                  className="settings-btn export-btn"
                  title={f.hint}
                  disabled={!hasModel || exporting !== null}
                  onClick={() => runExport(f.id)}
                >
                  {exporting === f.id ? <Loader2 size={13} className="space-spin" /> : <Download size={13} />}
                  {f.label}
                </button>
              ))}
            </div>
            <small className="settings-note">
              GLB keeps colours · STL for 3D printing · OBJ is shape only. Sizes are in model units (slicers read STL as mm).
            </small>
            {exportError && <div className="acct-error">{exportError}</div>}
          </section>

          <section>
            <div className="acct-label">Last build</div>
            {build ? (
              <>
                <div className="settings-total">
                  <strong>{fmt(totalTokens(build))}</strong> tokens
                </div>
                <div className="settings-build" title={build.prompt}>
                  {build.kind === "edit" ? "Edit" : "Build"} · {build.title}
                </div>
                <dl className="settings-stats">
                  {stats.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <div className="acct-muted">Build something to see how many tokens it used.</div>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}
