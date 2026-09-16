/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Github, Loader2, Settings2, X } from "lucide-react";
import { DotSpace } from "../features/studio/DotSpace";
import { expandProgram, type PartsProgram } from "../features/studio/engine/primitives";
import { EXPORT_FORMATS, exportModel, type ExportFormat } from "../features/studio/exporters";
import { DETAIL, DETAIL_LEVELS } from "../features/studio/detail";
import type { Shape3D } from "../types";
import type { ViewSettings } from "../features/studio/state/types";
import { CATALOG, modelUrl, thumbUrl, type GalleryItem } from "./catalog";

const REPO = "https://github.com/rajkandula/vertex-3d-studio";

// Models open as a solid surface with its edges, on plain black — switch the dots on to see
// how the studio draws them.
const DEFAULT_VIEW: ViewSettings = {
  dots: false,
  mesh: true,
  meshOpacity: 0.45,
  wireframe: true,
  field: false,
  reasoning: false,
  detail: "normal",
  autoRotate: true,
  rotateSpeed: 1.2,
};

type Toggle = { key: "dots" | "mesh" | "wireframe" | "field" | "autoRotate"; label: string };

const TOGGLES: Toggle[] = [
  { key: "dots", label: "Model dots" },
  { key: "mesh", label: "Mesh" },
  { key: "wireframe", label: "Wireframe" },
  { key: "field", label: "Space dots" },
  { key: "autoRotate", label: "Rotate" },
];

/** A static gallery of finished models: no account, no API key, nothing to install. */
export function GalleryApp() {
  const [openId, setOpenId] = useState<string | null>(() => window.location.hash.slice(1) || null);

  useEffect(() => {
    const onHash = () => setOpenId(window.location.hash.slice(1) || null);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const item = CATALOG.find((m) => m.id === openId);

  // The viewer is full-screen, so the page behind it shouldn't scroll; the grid should.
  useEffect(() => {
    document.body.classList.toggle("viewing", !!item);
    return () => document.body.classList.remove("viewing");
  }, [item]);
  const open = (id: string | null) => {
    window.location.hash = id ?? "";
    setOpenId(id);
  };

  return item ? <Viewer item={item} onBack={() => open(null)} /> : <Grid onOpen={open} />;
}

function Grid({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="gal">
      <header className="gal-head">
        <div>
          <div className="brand">
            <span className="brand-dot" />
            <span>Vertex 3D Studio</span>
          </div>
          <h1>Built from one sentence each.</h1>
          <p>
            Claude designs every object as parametric parts; the app lights up the lattice dots on their
            surfaces. Open any model to orbit it, switch how it's drawn, and export it.
          </p>
        </div>
        <a className="gal-repo" href={REPO} target="_blank" rel="noreferrer">
          <Github size={16} /> Source & recipes
        </a>
      </header>

      <ul className="gal-grid">
        {CATALOG.map((m) => (
          <li key={m.id}>
            <button className="gal-card" onClick={() => onOpen(m.id)}>
              <img src={thumbUrl(m.id)} alt={m.title} loading="lazy" />
              <div className="gal-card-body">
                <div className="gal-card-top">
                  <h2>{m.title}</h2>
                  <span className="gal-parts">
                    {m.parts} {m.unit ?? "parts"}
                  </span>
                </div>
                <code>{m.prompt}</code>
                <p>{m.note}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <footer className="gal-foot">
        Every model here is one prompt to Claude Opus 5, unedited except where noted. Apache-2.0 — fork the
        recipes, or run the studio yourself and build your own.
      </footer>
    </div>
  );
}

function Viewer({ item, onBack }: { item: GalleryItem; onBack: () => void }) {
  // A model file is either a parts recipe (AI-built) or a finished Shape3D (computed math).
  const [data, setData] = useState<PartsProgram | Shape3D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [fitKey, setFitKey] = useState(0);
  // One button opens the controls; on a phone they start closed so the model gets the screen.
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia("(max-width: 760px)").matches);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(modelUrl(item.id))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the model (${r.status}).`))))
      .then((json) => live && setData(json))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [item.id]);

  const program = data && "parts" in data ? (data as PartsProgram) : null;

  // Detail rebuilds a parts model with smoother curves and denser dots — no AI call needed.
  const shape = useMemo(() => {
    if (!data) return null;
    return program ? expandProgram(program, { curveScale: DETAIL[view.detail].curveScale }) : (data as Shape3D);
  }, [data, program, view.detail]);

  // Re-frame the camera once the model exists, and again whenever it is rebuilt.
  useEffect(() => {
    if (shape) setFitKey((k) => k + 1);
  }, [shape]);

  const runExport = useCallback(
    async (format: ExportFormat) => {
      if (!shape) return;
      setExporting(format);
      try {
        await exportModel(format, shape, program);
      } catch (e: any) {
        setError(e?.message || "Export failed.");
      } finally {
        setExporting(null);
      }
    },
    [shape, program],
  );

  return (
    <div className="space">
      {shape && <DotSpace shape={shape} fitKey={fitKey} view={view} />}

      {shape && !view.dots && !view.mesh && !view.wireframe && (
        <div className="nothing-hint">Nothing to draw — turn on Model dots, Mesh or Wireframe.</div>
      )}

      <button className="gal-back" onClick={onBack}>
        <ArrowLeft size={16} /> All models
      </button>

      <button
        className="acct-btn gal-gear"
        onClick={() => setPanelOpen((o) => !o)}
        aria-label="View settings"
        aria-expanded={panelOpen}
      >
        <Settings2 size={17} />
      </button>

      {panelOpen && (
      <aside className="gal-panel">
        <div className="gal-panel-head">
          <span>
            <h2>{item.title}</h2>
            <code>{item.prompt}</code>
          </span>
          <button className="settings-x" onClick={() => setPanelOpen(false)} aria-label="Close settings">
            <X size={16} />
          </button>
        </div>
        <p>{item.note}</p>

        <div className="acct-label">Show</div>
        <div className="gal-toggles">
          {TOGGLES.map((t) => (
            <label key={t.key} className="settings-row">
              <span>{t.label}</span>
              <input
                type="checkbox"
                className="switch"
                checked={view[t.key]}
                onChange={(e) => setView((v) => ({ ...v, [t.key]: e.target.checked }))}
              />
            </label>
          ))}
        </div>

        <div className="acct-label">Detail</div>
        <div className="seg-group" role="radiogroup" aria-label="Detail level">
          {DETAIL_LEVELS.map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={view.detail === d}
              className={"seg-btn" + (view.detail === d ? " on" : "")}
              onClick={() => setView((v) => ({ ...v, detail: d }))}
            >
              {DETAIL[d].label}
            </button>
          ))}
        </div>
        <small className="settings-note">More detail = smoother curves and denser dots. Runs in your browser.</small>

        <div className="acct-label">Export</div>
        <div className="export-grid">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              className="settings-btn export-btn"
              title={f.hint}
              disabled={!shape || exporting !== null}
              onClick={() => runExport(f.id)}
            >
              {exporting === f.id ? <Loader2 size={13} className="space-spin" /> : <Download size={13} />}
              {f.label}
            </button>
          ))}
        </div>

        {error && <div className="acct-error">{error}</div>}
        {!shape && !error && (
          <div className="acct-muted">
            <Loader2 size={13} className="space-spin" /> Loading {item.parts} {item.unit ?? "parts"}…
          </div>
        )}
        <a className="gal-build" href={REPO} target="_blank" rel="noreferrer">
          <Github size={14} /> Build your own
        </a>
      </aside>
      )}
    </div>
  );
}
