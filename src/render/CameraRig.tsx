/**
 * Orbit camera: smooth continuous zoom from the whole town down to street
 * level (zoom to cursor, polar limits that open up near the ground), animated
 * transitions (follow, lab-mode selection, double-click focus), a slow
 * cinematic drift in spectator mode, and a scripting API:
 *
 *   window.__butterflyCamera.setView({ target: {x, y, z}, distance, azimuth, polar, instant? })
 *   window.__butterflyCamera.focusAgent(id) / focusLocation(id)
 *
 * azimuth 0 looks north from the south (+z), polar 0 is straight down.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { CITY_HEIGHT, CITY_WIDTH, LOCATIONS } from '../sim/city';
import { useSimStore } from '../store/useSimStore';
import { CITY_CENTER, agentWorld, damp, env } from './shared';
import { focusBoxes } from './focus';

const INITIAL_DISTANCE = 830;
const INITIAL_POLAR = 0.98;
const INITIAL_AZIMUTH = 0.36;
export const INITIAL_CAMERA: [number, number, number] = [
  CITY_CENTER.x + INITIAL_DISTANCE * Math.sin(INITIAL_POLAR) * Math.sin(INITIAL_AZIMUTH),
  INITIAL_DISTANCE * Math.cos(INITIAL_POLAR),
  CITY_CENTER.z + INITIAL_DISTANCE * Math.sin(INITIAL_POLAR) * Math.cos(INITIAL_AZIMUTH),
];

const PAN_MARGIN = 80;
/** The town (with its outer sidewalk) should fill about 70 % of the canvas height. */
const FIT_HALF_WIDTH = 345;
const FIT_HALF_HEIGHT = 150;
/** Spectator framing: the central district. */
const SPECTATOR_VIEW = { target: { x: 315, y: 0, z: 195 }, distance: 360, azimuth: 0.42, polar: 1.0 };
const MIN_DISTANCE = 9;
const MAX_DISTANCE = 1100;

export interface ViewSpec {
  target: { x: number; y: number; z: number };
  distance: number;
  azimuth: number;
  polar: number;
  instant?: boolean;
  /** Transition duration in seconds. */
  duration?: number;
}

interface Anim {
  t: number;
  dur: number;
  from: { target: THREE.Vector3; r: number; az: number; pol: number };
  to: { target: THREE.Vector3; r: number; az: number; pol: number };
}

const prev = new THREE.Vector3();
const delta = new THREE.Vector3();
const sph = new THREE.Spherical();
const off = new THREE.Vector3();

function sphericalOf(camera: THREE.Camera, target: THREE.Vector3) {
  off.subVectors(camera.position, target);
  sph.setFromVector3(off);
  return { r: sph.radius, az: sph.theta, pol: sph.phi };
}

function applySpherical(camera: THREE.Camera, target: THREE.Vector3, r: number, az: number, pol: number) {
  sph.set(r, pol, az);
  off.setFromSpherical(sph);
  camera.position.copy(target).add(off);
  camera.lookAt(target);
}

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const framed = useRef(false);
  const anim = useRef<Anim | null>(null);
  const lastInput = useRef(performance.now());
  const lastSel = useRef<string | null>(null);
  const lastMode = useRef<string>('lab');

  // Initial framing: the whole city fits the viewport.
  useEffect(() => {
    if (framed.current || size.width < 10 || size.height < 10) return;
    framed.current = true;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * (size.width / size.height);
    const d = THREE.MathUtils.clamp(Math.max(FIT_HALF_WIDTH / tanH, FIT_HALF_HEIGHT / tanV), 430, 1000);
    const dir = new THREE.Vector3(...INITIAL_CAMERA).sub(CITY_CENTER).normalize();
    camera.position.copy(CITY_CENTER).addScaledVector(dir, d);
    controls.current?.update();
  }, [camera, size]);

  // Scripting / UI API.
  useEffect(() => {
    const start = (v: ViewSpec) => {
      const c = controls.current;
      if (!c) return;
      const to = { target: new THREE.Vector3(v.target.x, v.target.y, v.target.z), r: THREE.MathUtils.clamp(v.distance, MIN_DISTANCE, MAX_DISTANCE), az: v.azimuth, pol: v.polar };
      if (v.instant) {
        anim.current = null;
        c.target.copy(to.target);
        applySpherical(camera, to.target, to.r, to.az, to.pol);
        c.update();
        env.camDistance = to.r;
        return;
      }
      const cur = sphericalOf(camera, c.target);
      // Shortest way round in azimuth.
      let az = to.az;
      while (az - cur.az > Math.PI) az -= Math.PI * 2;
      while (az - cur.az < -Math.PI) az += Math.PI * 2;
      anim.current = { t: 0, dur: v.duration ?? 1.4, from: { target: c.target.clone(), ...cur }, to: { ...to, az } };
    };
    const current = () => {
      const c = controls.current;
      const t = c?.target ?? CITY_CENTER;
      return { target: t.clone(), ...sphericalOf(camera, t) };
    };
    const api = {
      setView: (v: ViewSpec) => start(v),
      getView: () => {
        const v = current();
        return { target: { x: v.target.x, y: v.target.y, z: v.target.z }, distance: v.r, azimuth: v.az, polar: v.pol };
      },
      focusAgent: (id: string, distance?: number) => {
        const a = agentWorld.get(id);
        if (!a) return;
        const v = current();
        start({ target: { x: a.pos.x, y: 1, z: a.pos.z }, distance: distance ?? Math.min(v.r, 60), azimuth: v.az, polar: Math.min(v.pol, 1.15) });
      },
      focusLocation: (id: string, distance?: number) => {
        const box = focusBoxes.get(id);
        const loc = LOCATIONS.find((l) => l.id === id);
        if (!box && !loc) return;
        const c = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(loc!.pos.x, 0, loc!.pos.y);
        const v = current();
        start({ target: { x: c.x, y: 2, z: c.z }, distance: distance ?? 75, azimuth: v.az, polar: Math.min(Math.max(v.pol, 0.9), 1.2) });
      },
    };
    (window as unknown as { __butterflyCamera: typeof api }).__butterflyCamera = api;
    (window as unknown as { __butterflyRender: unknown }).__butterflyRender = {
      scene,
      info: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 }),
      /** Triangles per named object (instances included), largest first. */
      breakdown: () => {
        const rows: Record<string, number> = {};
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.visible) return;
          const g = m.geometry;
          const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
          const n = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
          const key = (m.name || m.parent?.name || 'anon').split(':').slice(0, 2).join(':');
          rows[key] = (rows[key] ?? 0) + tris * n;
        });
        return Object.entries(rows).sort((a, b) => b[1] - a[1]).slice(0, 30);
      },
    };
    return () => {
      delete (window as unknown as { __butterflyCamera?: unknown }).__butterflyCamera;
    };
  }, [camera, gl, scene]);

  // Any user input cancels transitions and the cinematic drift.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      lastInput.current = performance.now();
      anim.current = null;
    };
    c.addEventListener('start', onStart);
    const el = gl.domElement;
    el.addEventListener('wheel', onStart, { passive: true });
    return () => {
      c.removeEventListener('start', onStart);
      el.removeEventListener('wheel', onStart);
    };
  }, [gl]);

  useFrame(({ camera }, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 0.1);
    const s = useSimStore.getState();
    const dist = camera.position.distanceTo(c.target);

    // Polar limits open up near the ground (almost horizontal at street level).
    const near = THREE.MathUtils.smoothstep(dist, 40, 320);
    c.maxPolarAngle = THREE.MathUtils.lerp(1.5, 1.22, near);
    c.minPolarAngle = 0.15;

    // Entering spectator mode frames the central district (unless following someone).
    if (s.uiMode !== lastMode.current) {
      lastMode.current = s.uiMode;
      if (s.uiMode === 'spectator' && !s.followAgentId) {
        const v = sphericalOf(camera, c.target);
        const T = SPECTATOR_VIEW;
        let az = T.azimuth;
        while (az - v.az > Math.PI) az -= Math.PI * 2;
        while (az - v.az < -Math.PI) az += Math.PI * 2;
        anim.current = { t: 0, dur: 2.2, from: { target: c.target.clone(), ...v }, to: { target: new THREE.Vector3(T.target.x, T.target.y, T.target.z), r: T.distance, az, pol: T.polar } };
        lastInput.current = performance.now();
      }
    }
    // Lab-mode selection: glide to the selected inhabitant (keeps the zoom).
    if (s.selectedAgentId !== lastSel.current) {
      lastSel.current = s.selectedAgentId;
      if (s.selectedAgentId && s.uiMode === 'lab' && !s.followAgentId) {
        const a = agentWorld.get(s.selectedAgentId);
        if (a && a.visible) {
          const v = sphericalOf(camera, c.target);
          anim.current = { t: 0, dur: 1.2, from: { target: c.target.clone(), ...v }, to: { target: new THREE.Vector3(a.pos.x, 0, a.pos.z), r: Math.min(v.r, 420), az: v.az, pol: v.pol } };
        }
      }
    }

    if (anim.current) {
      const A = anim.current;
      A.t += dt / A.dur;
      const k = ease(Math.min(1, A.t));
      c.target.lerpVectors(A.from.target, A.to.target, k);
      const r = Math.exp(THREE.MathUtils.lerp(Math.log(A.from.r), Math.log(A.to.r), k));
      applySpherical(camera, c.target, r, THREE.MathUtils.lerp(A.from.az, A.to.az, k), THREE.MathUtils.lerp(A.from.pol, A.to.pol, k));
      if (A.t >= 1) anim.current = null;
    } else {
      prev.copy(c.target);
      const followId = s.followAgentId;
      if (followId) {
        const a = agentWorld.get(followId);
        if (a) {
          c.target.x += (a.pos.x - c.target.x) * damp(3.5, dt);
          c.target.z += (a.pos.z - c.target.z) * damp(3.5, dt);
          c.target.y += (1 - c.target.y) * damp(3.5, dt);
        }
      }
      c.target.x = THREE.MathUtils.clamp(c.target.x, -PAN_MARGIN, CITY_WIDTH + PAN_MARGIN);
      c.target.z = THREE.MathUtils.clamp(c.target.z, -PAN_MARGIN, CITY_HEIGHT + PAN_MARGIN);
      c.target.y = THREE.MathUtils.clamp(c.target.y, 0, 40);
      delta.subVectors(c.target, prev);
      if (delta.lengthSq() > 0) camera.position.add(delta);
      // Cinematic drift in spectator mode, after a few seconds without input.
      if (s.uiMode === 'spectator' && !followId && performance.now() - lastInput.current > 6000) {
        const v = sphericalOf(camera, c.target);
        applySpherical(camera, c.target, v.r, v.az + dt * 0.018, v.pol);
      }
    }
    // Keep the camera above the ground.
    if (camera.position.y < 1.6) camera.position.y = 1.6;
    env.camDistance = camera.position.distanceTo(c.target);
    // Near plane follows the zoom (street level needs a close near plane, the overview depth precision).
    const persp = camera as THREE.PerspectiveCamera;
    const nearWanted = THREE.MathUtils.clamp(env.camDistance * 0.025, 0.25, 8);
    if (Math.abs(persp.near - nearWanted) > nearWanted * 0.15) {
      persp.near = nearWanted;
      persp.updateProjectionMatrix();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[CITY_CENTER.x, 0, CITY_CENTER.z]}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={0.15}
      maxPolarAngle={1.25}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      zoomToCursor
      screenSpacePanning={false}
      rotateSpeed={0.55}
      zoomSpeed={1.0}
      panSpeed={0.9}
    />
  );
}
