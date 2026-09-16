/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StudioProvider } from "../features/studio/state/studioStore";
import { StudioPage } from "../features/studio/StudioPage";
import "../features/studio/studio.css";

/** Application root: a full-screen space of dots, a prompt bar, and an account button. */
export default function App() {
  return (
    <StudioProvider>
      <StudioPage />
    </StudioProvider>
  );
}
