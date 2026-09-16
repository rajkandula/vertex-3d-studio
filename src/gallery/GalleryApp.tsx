/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, Github, Loader2 } from "lucide-react";
import { DotSpace } from "../features/studio/DotSpace";
import { expandProgram, type PartsProgram } from "../features/studio/engine/primitives";
import { EXPORT_FORMATS, exportModel, type ExportFormat } from "../features/studio/exporters";
import type { Shape3D } from "../types";
import type { ViewSettings } from "../features/studio/state/types";
import { CATALOG, modelUrl, thumbUrl, type GalleryItem } from "./catalog";

const REPO = "https://github.com/rajkandula/vertex-3d-studio";

const DEFAULT_VIEW: ViewSettings = {
  dots: true,
  mesh: false,
  meshOpacity: 0.45,
  wireframe: false,
  field: true,
  reasoning: false,
  detail: "normal",
  autoRotate: true,
  rotateSpeed: 1.2,
};

type Toggle = { key: "dots" | "mesh" | "wireframe" | "field" | "autoRotate"; label: string };

const TOGGLES: Toggle[] = [
  { key: "dots", label: "Dots" },
  { key: "mesh", label: "Mesh" },
  { key: "wireframe", label: "Wireframe" },
  { key: "field", label: "Grid" },
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
                  <span className="gal-parts">{m.parts} parts</span>
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
  const [program, setProgram] = useState<PartsProgram | null>(null);
  const [shape, setShape] = useState<Shape3D | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  useEffect(() => {
    let live = true;
    setShape(null);
    setError(null);
    fetch(modelUrl(item.id))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the model (${r.status}).`))))
      .then((parts: PartsProgram) => {
        if (!live) return;
        setProgram(parts);
        setShape(expandProgram(parts));
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [item.id]);

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
      {shape && <DotSpace shape={shape} fitKey={1} view={view} />}

      <button className="gal-back" onClick={onBack}>
        <ArrowLeft size={16} /> All models
      </button>

      <aside className="gal-panel">
        <h2>{item.title}</h2>
        <code>{item.prompt}</code>
        <p>{item.note}</p>

        <div className="acct-label">Show</div>
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
            <Loader2 size={13} className="space-spin" /> Loading {item.parts} parts…
          </div>
        )}
      </aside>
    </div>
  );
}
