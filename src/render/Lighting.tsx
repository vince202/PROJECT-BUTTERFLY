/**
 * Day / night cycle and weather lighting.
 *
 * Everything is driven by the display clock (`time`, minutes since midnight)
 * read with `useSimStore.getState()` inside useFrame. This component owns the
 * `env` singleton (night factor, rain intensity) consumed by the rest of the
 * scene, and animates the sun, hemisphere light, sky colour, fog and stars.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { CITY_CENTER, activeRealityOf, damp, env, seeded } from './shared';

interface Key {
  t: number; // minutes
  sky: string;
  fog: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  /** Sun elevation in degrees. */
  elev: number;
  night: number;
}

// Key frames of the day. Values are interpolated linearly in between.
const KEYS: Key[] = [
  { t: 0, sky: '#0b1226', fog: '#141d36', sun: '#8ea6ff', sunI: 0.35, hemiSky: '#3a4f86', hemiGround: '#141820', hemiI: 0.35, elev: 40, night: 1 },
  { t: 330, sky: '#1a2547', fog: '#26314f', sun: '#8ea6ff', sunI: 0.35, hemiSky: '#45598f', hemiGround: '#1b1f2a', hemiI: 0.4, elev: 40, night: 1 },
  { t: 375, sky: '#5d6f9e', fog: '#7a7f9c', sun: '#ff9f80', sunI: 0.55, hemiSky: '#8a94c2', hemiGround: '#3a3530', hemiI: 0.55, elev: 4, night: 0.65 },
  { t: 405, sky: '#a8b6d4', fog: '#c9bfc4', sun: '#ffb68a', sunI: 1.2, hemiSky: '#b4c2e0', hemiGround: '#5d5246', hemiI: 0.75, elev: 9, night: 0.25 },
  { t: 420, sky: '#b9cbe3', fog: '#d6d2cf', sun: '#ffc89c', sunI: 1.6, hemiSky: '#c2d2ea', hemiGround: '#6a5e4e', hemiI: 0.85, elev: 13, night: 0 },
  { t: 540, sky: '#a9d0ee', fog: '#d4e2ea', sun: '#fff0d8', sunI: 2.6, hemiSky: '#cfe3f5', hemiGround: '#7d7058', hemiI: 0.95, elev: 36, night: 0 },
  { t: 780, sky: '#9fcdf0', fog: '#d3e5f0', sun: '#ffffff', sunI: 3.0, hemiSky: '#d8eaf8', hemiGround: '#857a62', hemiI: 1.0, elev: 58, night: 0 },
  { t: 1020, sky: '#b3cfe6', fog: '#e3dccb', sun: '#ffd9a0', sunI: 2.6, hemiSky: '#d9e2ea', hemiGround: '#8a7458', hemiI: 0.95, elev: 30, night: 0 },
  { t: 1110, sky: '#e8c39a', fog: '#efcfa8', sun: '#ffb46a', sunI: 2.2, hemiSky: '#ecd2b4', hemiGround: '#7f5f45', hemiI: 0.85, elev: 14, night: 0 },
  { t: 1170, sky: '#e39a78', fog: '#d9957f', sun: '#ff8550', sunI: 1.3, hemiSky: '#d6a094', hemiGround: '#5a4038', hemiI: 0.7, elev: 5, night: 0.2 },
  { t: 1200, sky: '#5b6496', fog: '#6a6a8e', sun: '#9aa6ff', sunI: 0.45, hemiSky: '#7480b6', hemiGround: '#2a2630', hemiI: 0.55, elev: 30, night: 0.7 },
  { t: 1260, sky: '#1f2a4f', fog: '#28324f', sun: '#8ea6ff', sunI: 0.38, hemiSky: '#4a5d96', hemiGround: '#181b26', hemiI: 0.42, elev: 40, night: 1 },
  { t: 1440, sky: '#0b1226', fog: '#141d36', sun: '#8ea6ff', sunI: 0.35, hemiSky: '#3a4f86', hemiGround: '#141820', hemiI: 0.35, elev: 40, night: 1 },
];

const KEY_COLORS = KEYS.map((k) => ({
  sky: new THREE.Color(k.sky),
  fog: new THREE.Color(k.fog),
  sun: new THREE.Color(k.sun),
  hemiSky: new THREE.Color(k.hemiSky),
  hemiGround: new THREE.Color(k.hemiGround),
}));

const RAIN_SKY = new THREE.Color('#7d8794');
const RAIN_SUN = new THREE.Color('#c9d2dc');

/** Sun azimuth: rises in the east (+x) at ~06:30, culminates south (+z), sets west at ~20:00. */
function sunDirection(t: number, elevDeg: number, night: number, out: THREE.Vector3): THREE.Vector3 {
  const a = Math.min(Math.PI, Math.max(0, (Math.PI * (t - 390)) / (1200 - 390)));
  const el = THREE.MathUtils.degToRad(elevDeg);
  const sunDir = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), (0.35 + 0.65 * Math.sin(a)) * Math.cos(el)).normalize();
  // The moon hangs in the south-west at night: keep shadows readable from the default camera.
  const moonDir = new THREE.Vector3(-0.45, Math.sin(el), 0.6).normalize();
  return out.copy(sunDir).lerp(moonDir, night).normalize();
}

const SHADOW_EXTENT = 470;

export function Lighting() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const stars = useRef<THREE.Points>(null);

  // Persistent objects animated every frame.
  const state = useMemo(
    () => ({
      sky: new THREE.Color(),
      fog: new THREE.Color(),
      sunColor: new THREE.Color(),
      dir: new THREE.Vector3(),
      rain: 0,
    }),
    [],
  );

  useEffect(() => {
    scene.background = new THREE.Color('#a9d0ee');
    scene.fog = new THREE.Fog('#d4e2ea', 900, 2600);
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene]);

  // Star field on a large dome.
  const starGeo = useMemo(() => {
    const rnd = seeded(7);
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2;
      // Full sphere: the diorama "floats", so stars also show around its edges.
      const v = Math.asin(rnd() * 2 - 1);
      const r = 2600;
      pos[i * 3] = CITY_CENTER.x + Math.cos(u) * Math.cos(v) * r;
      pos[i * 3 + 1] = Math.sin(v) * r;
      pos[i * 3 + 2] = CITY_CENTER.z + Math.sin(u) * Math.cos(v) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const starMat = useMemo(
    () => new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
    [],
  );

  useEffect(
    () => () => {
      starGeo.dispose();
      starMat.dispose();
    },
    [starGeo, starMat],
  );

  // Attach the sun target to the scene so that the light aims at the city centre.
  useEffect(() => {
    const light = sun.current;
    if (!light) return;
    light.target.position.copy(CITY_CENTER);
    scene.add(light.target);
    return () => {
      scene.remove(light.target);
    };
  }, [scene]);

  useFrame((_, dt) => {
    const s = useSimStore.getState();
    const t = s.time;
    env.time = t;

    // Weather target from the current trace frame.
    const frame = activeRealityOf(s).frameAt(Math.floor(t));
    const rainTarget = frame?.weather === 'rain' ? 1 : 0;
    state.rain += (rainTarget - state.rain) * damp(1.5, Math.min(dt, 0.1));
    env.rain = state.rain;
    const rain = state.rain;

    // Find surrounding key frames.
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const f = Math.min(1, Math.max(0, (t - a.t) / Math.max(1, b.t - a.t)));
    const ca = KEY_COLORS[i];
    const cb = KEY_COLORS[i + 1];
    const lerp = THREE.MathUtils.lerp;

    const night = lerp(a.night, b.night, f);
    env.night = night;

    state.sky.copy(ca.sky).lerp(cb.sky, f).lerp(RAIN_SKY, rain * 0.55 * (1 - night * 0.7));
    state.fog.copy(ca.fog).lerp(cb.fog, f).lerp(RAIN_SKY, rain * 0.6 * (1 - night * 0.7));
    (scene.background as THREE.Color | null)?.copy(state.sky);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(state.fog);
      const d = env.camDistance;
      fog.near = d * (1.05 - rain * 0.4);
      fog.far = d * (3.2 - rain * 1.4);
    }

    const elev = lerp(a.elev, b.elev, f);
    sunDirection(t, elev, night, state.dir);
    if (sun.current) {
      const l = sun.current;
      l.position.copy(CITY_CENTER).addScaledVector(state.dir, 800);
      state.sunColor.copy(ca.sun).lerp(cb.sun, f).lerp(RAIN_SUN, rain * 0.6);
      l.color.copy(state.sunColor);
      l.intensity = lerp(a.sunI, b.sunI, f) * (1 - rain * 0.6);
    }
    if (hemi.current) {
      const h = hemi.current;
      h.color.copy(ca.hemiSky).lerp(cb.hemiSky, f);
      h.groundColor.copy(ca.hemiGround).lerp(cb.hemiGround, f);
      h.intensity = lerp(a.hemiI, b.hemiI, f) * (1 - rain * 0.15);
    }

    starMat.opacity = Math.max(0, night - 0.3) * (1 - rain) * 1.2;
    starMat.visible = starMat.opacity > 0.01;

    // Shared label sizing factor for sprites with sizeAttenuation = false.
    const persp = camera as THREE.PerspectiveCamera;
    env.pxToSprite = (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 38) / 2)) / Math.max(200, size.height);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#cfe3f5', '#7d7058', 0.9]} />
      <directionalLight
        ref={sun}
        castShadow
        intensity={2.6}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.45}
        shadow-camera-near={50}
        shadow-camera-far={1700}
        shadow-camera-left={-SHADOW_EXTENT}
        shadow-camera-right={SHADOW_EXTENT}
        shadow-camera-top={SHADOW_EXTENT}
        shadow-camera-bottom={-SHADOW_EXTENT}
      />
      <points ref={stars} geometry={starGeo} material={starMat} frustumCulled={false} />
    </>
  );
}
