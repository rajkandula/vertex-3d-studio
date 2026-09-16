/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Shape3D } from "../../types";
import { buildField, fieldExtent, shapeToDots, type DotCloud } from "./dots";
import { shapeToEdges, shapeToMesh } from "./mesh";
import { DETAIL } from "./detail";
import type { ViewSettings } from "./state/types";

const BG = "#02040a";
const VIEW_DIR = new THREE.Vector3(0.75, 0.55, 1).normalize();
const EMPTY_RADIUS = 350;
const REVEAL_SECONDS = 1.2;

/** Full-screen space: a faint lattice of dots, with the current model lit up inside it. */
export function DotSpace({ shape, fitKey, view }: { shape: Shape3D; fitKey: number; view: ViewSettings }) {
  const cloud = useMemo(() => shapeToDots(shape, DETAIL[view.detail]), [shape, view.detail]);
  const extent = fieldExtent(cloud ? Math.hypot(...cloud.center) + cloud.radius : 0);

  return (
    <Canvas camera={{ position: [640, 470, 850], fov: 45, near: 1, far: 20000 }} dpr={[1, 2]} gl={{ antialias: true }}>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 1000, 2600]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[300, 600, 400]} intensity={1.3} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        autoRotate={view.autoRotate}
        autoRotateSpeed={view.rotateSpeed}
      />
      {view.field && <Field extent={extent} />}
      {view.dots && cloud && <ModelDots cloud={cloud} />}
      {view.mesh && <ModelMesh shape={shape} opacity={view.meshOpacity} />}
      {view.wireframe && <ModelEdges shape={shape} />}
      <Framing cloud={cloud} fitKey={fitKey} />
    </Canvas>
  );
}

function ModelMesh({ shape, opacity }: { shape: Shape3D; opacity: number }) {
  const geo = useMemo(() => shapeToMesh(shape), [shape]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial
        vertexColors
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={opacity >= 1}
        roughness={0.6}
        metalness={0.1}
      />
    </mesh>
  );
}

function ModelEdges({ shape }: { shape: Shape3D }) {
  const geo = useMemo(() => shapeToEdges(shape), [shape]);
  useEffect(() => () => geo?.dispose(), [geo]);
  if (!geo) return null;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#cbd5e1" transparent opacity={0.45} />
    </lineSegments>
  );
}

// Millions of lattice dots: sized by distance, faded toward the horizon and right in front of
// the lens, and dimmed (not shrunk) below a pixel so the dense far layers read as depth, not moiré.
const FIELD_VERTEX = /* glsl */ `
  uniform float uSize;       // dot size in CSS px at the orbit-target distance
  uniform float uRef;        // camera -> orbit target distance
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = -mv.z;
    gl_Position = projectionMatrix * mv;
    float s = uSize * uRef / max(d, 1.0);
    gl_PointSize = clamp(s, 1.0, 4.0) * uPixelRatio;
    float far = 1.0 - smoothstep(uRef * 0.5, uRef * 2.2, d);
    float near = smoothstep(uRef * 0.03, uRef * 0.2, d);
    // Sub-pixel dots keep their true coverage (area = s²) so ~80 layers of depth don't sum into a carpet.
    float coverage = min(s * s, 1.0);
    vAlpha = far * near * coverage;
  }
`;

// Tuned for ~15% screen coverage before opacity: sqrt(0.15 * step³ / (0.83² * 2.2)) with step 25.
const FIELD_COVERAGE = 39;

const FIELD_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(uColor, uOpacity * vAlpha);
  }
`;

function Field({ extent }: { extent: number }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(buildField(extent), 3));
    return g;
  }, [extent]);
  useEffect(() => () => geo.dispose(), [geo]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Vector3(0.62, 0.7, 0.84) },
          uOpacity: { value: 0.7 },
          uSize: { value: 1.0 },
          uRef: { value: 1000 },
          uPixelRatio: { value: 1 },
        },
        vertexShader: FIELD_VERTEX,
        fragmentShader: FIELD_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, controls, gl, size }) => {
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    const ref = Math.max(1, target ? camera.position.distanceTo(target) : camera.position.length());
    material.uniforms.uRef.value = ref;
    // Screen coverage grows with ref³ (bigger dots × more visible layers) and shrinks with the
    // viewport height², so size dots to keep it roughly constant at any zoom and window size.
    material.uniforms.uSize.value = THREE.MathUtils.clamp((FIELD_COVERAGE * size.height) / Math.pow(ref, 1.5), 0.2, 3);
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <points geometry={geo} material={material} frustumCulled={false} />;
}

function ModelDots({ cloud }: { cloud: DotCloud }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(cloud.colors, 3));
    g.setDrawRange(0, 0);
    return g;
  }, [cloud]);
  useEffect(() => () => geo.dispose(), [geo]);

  // Light the dots up from the ground over REVEAL_SECONDS whenever the model changes.
  const reveal = useRef<{ geo: THREE.BufferGeometry | null; start: number }>({ geo: null, start: 0 });
  useFrame(({ clock }) => {
    if (reveal.current.geo !== geo) reveal.current = { geo, start: clock.elapsedTime };
    const t = Math.min(1, (clock.elapsedTime - reveal.current.start) / REVEAL_SECONDS);
    geo.setDrawRange(0, Math.ceil(cloud.count * (1 - Math.pow(1 - t, 3))));
  });

  return (
    <points geometry={geo}>
      <pointsMaterial vertexColors size={cloud.step * 1.4} sizeAttenuation />
    </points>
  );
}

/** Frame the model (or the empty field) whenever a fit is requested. */
function Framing({ cloud, fitKey }: { cloud: DotCloud | null; fitKey: number }) {
  const last = useRef<number | null>(null);
  const settle = useRef(0);

  useFrame((state) => {
    if (last.current !== fitKey) {
      last.current = fitKey;
      settle.current = 24; // hold the frame for a few frames so OrbitControls damping settles
    }
    if (settle.current <= 0) return;
    settle.current -= 1;

    const target = cloud ? new THREE.Vector3(...cloud.center) : new THREE.Vector3();
    const radius = cloud ? cloud.radius : EMPTY_RADIUS;
    const camera = state.camera as THREE.PerspectiveCamera;
    const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.35;

    camera.position.copy(target).addScaledVector(VIEW_DIR, dist);
    camera.near = Math.max(0.05, dist / 500);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();

    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = dist - radius;
      fog.far = dist + radius * 2.5;
    }

    const controls = state.controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (controls) {
      controls.target.copy(target);
      controls.update();
    } else {
      camera.lookAt(target);
    }
  });
  return null;
}
