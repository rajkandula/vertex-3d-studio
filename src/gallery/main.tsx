/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GalleryApp } from "./GalleryApp";
import "../index.css";
import "../features/studio/studio.css";
import "./gallery.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GalleryApp />
  </StrictMode>,
);
