/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point3D {
  id: string;
  x: number;
  y: number;
  z: number;
  label?: string;
  color?: string; // HEX color code representing node's custom color
  isGridPoint?: boolean; // True if it belongs to the background guides grid
}

export interface Edge3D {
  id: string;
  source: string;
  target: string;
  color?: string; // Optional HEX color code representing edge line color
}

export interface Face3D {
  id: string;
  nodeIds: string[]; // Ordered list of node ID strings that form the polygon boundary
  color?: string;    // HEX color code for this specific surface panel
  opacity?: number;  // Opacity factor (0.0 to 1.0)
}

export interface Shape3D {
  title: string;
  description: string;
  nodes: Point3D[];
  edges: Edge3D[];
  faces?: Face3D[]; // Array of polygon faces for solid mesh rendering
}