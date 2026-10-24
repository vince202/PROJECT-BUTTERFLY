/**
 * Day / night cycle and weather lighting.
 *
 * Everything is driven by the display clock (`time`, minutes since midnight)
 * read with `useSimStore.getState()` inside useFrame. This component owns the
 * `env` singleton (night factor, rain intensity) consumed by the rest of the
 * scene, and animates the sun, hemisphere light, sky colour, fog and stars.
 */

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
import { useSimStore } from '../store/useSimStore';
import { CITY_CENTER, activeRealityOf, damp, env, seeded } from './shared';
import { U } from './materials';
import { SIGN_MATERIALS, U_SKY } from './kit';

/** Warm night lights of the café block (no shadows). */
const NIGHT_LIGHTS: [number, number, number, number][] = [
  [300, 5.5, 146, 1],
  [300, 4, 128, 0.6],
  [146, 4.5, 180, 0.8],
  [420, 5, 146, 0.8],
  [432, 4, 113, 0.5],
  [360, 4.5, 256, 0.55],
  [240, 4.5, 128, 0.45],
  [360, 4.5, 128, 0.45],
];
const tmpTarget = new THREE.Vector3();

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
  { t: 0, sky: '#0b1226', fog: '#141d36', sun: '#9fb4ff', sunI: 0.42, hemiSky: '#4a5d96', hemiGround: '#181c28', hemiI: 0.45, elev: 40, night: 1 },
  { t: 330, sky: '#1a2547', fog: '#26314f', sun: '#9fb4ff', sunI: 0.42, hemiSky: '#4f6299', hemiGround: '#1b1f2a', hemiI: 0.48, elev: 40, night: 1 },
  { t: 375, sky: '#5d6f9e', fog: '#7a7f9c', sun: '#ff9f80', sunI: 0.55, hemiSky: '#8a94c2', hemiGround: '#3a3530', hemiI: 0.55, elev: 4, night: 0.65 },
  { t: 405, sky: '#a8b6d4', fog: '#c9bfc4', sun: '#ffb68a', sunI: 1.2, hemiSky: '#b4c2e0', hemiGround: '#5d5246', hemiI: 0.75, elev: 9, night: 0.25 },
  { t: 420, sky: '#b9cbe3', fog: '#d6d2cf', sun: '#ffc89c', sunI: 1.6, hemiSky: '#c2d2ea', hemiGround: '#6a5e4e', hemiI: 0.85, elev: 13, night: 0 },
  { t: 540, sky: '#a9d0ee', fog: '#d4e2ea', sun: '#fff0d8', sunI: 2.6, hemiSky: '#cfe3f5', hemiGround: '#7d7058', hemiI: 0.95, elev: 36, night: 0 },
  { t: 780, sky: '#9fcdf0', fog: '#d3e5f0', sun: '#fffaf0', sunI: 3.0, hemiSky: '#d8eaf8', hemiGround: '#857a62', hemiI: 1.0, elev: 52, night: 0 },
  { t: 1020, sky: '#b3cfe6', fog: '#e3dccb', sun: '#ffd9a0', sunI: 2.6, hemiSky: '#d9e2ea', hemiGround: '#8a7458', hemiI: 0.95, elev: 30, night: 0 },
  { t: 1080, sky: '#e9cfa8', fog: '#efd6b4', sun: '#ffb46a', sunI: 2.8, hemiSky: '#a9bcdf', hemiGround: '#8a6a4c', hemiI: 0.85, elev: 13, night: 0 },
  { t: 1120, sky: '#f0b98f', fog: '#eebc9c', sun: '#ff9457', sunI: 2.7, hemiSky: '#93a8d8', hemiGround: '#7a5848', hemiI: 0.8, elev: 7, night: 0 },
  { t: 1160, sky: '#e99a86', fog: '#e2a594', sun: '#ff7f63', sunI: 2.1, hemiSky: '#8494cc', hemiGround: '#5e4440', hemiI: 0.72, elev: 3.5, night: 0.12 },
  { t: 1200, sky: '#5b6496', fog: '#6a6a8e', sun: '#9aa6ff', sunI: 0.45, hemiSky: '#7480b6', hemiGround: '#2a2630', hemiI: 0.55, elev: 30, night: 0.7 },
  { t: 1260, sky: '#1f2a4f', fog: '#28324f', sun: '#9fb4ff', sunI: 0.45, hemiSky: '#55689f', hemiGround: '#1c2030', hemiI: 0.5, elev: 40, night: 1 },
  { t: 1440, sky: '#0b1226', fog: '#141d36', sun: '#9fb4ff', sunI: 0.42, hemiSky: '#4a5d96', hemiGround: '#181c28', hemiI: 0.45, elev: 40, night: 1 },
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

/**
 * Sun direction (pointing towards the sun). Stylised path: rises east-south-east
 * at ~06:30, passes south-west in the early afternoon and sets west-north-west at
 * ~20:00, so that shadows fall where the default three-quarter camera sees them.
 */
function sunDirection(t: number, elevDeg: number, night: number, out: THREE.Vector3): THREE.Vector3 {
  const f = Math.min(1, Math.max(0, (t - 390) / (1200 - 390)));
  const phi = THREE.MathUtils.degToRad(30 + 180 * f);
  const el = THREE.MathUtils.degToRad(elevDeg);
  const sunDir = tmpSun.set(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el)).normalize();
  // The moon hangs in the south-west at night: keep shadows readable from the default camera.
  const moonDir = tmpMoon.set(-0.45, Math.sin(el), 0.6).normalize();
  return out.copy(sunDir).lerp(moonDir, night).normalize();
}

const SHADOW_EXTENT = 470;
const tmpTop = new THREE.Color();
const tmpSun = new THREE.Vector3();
const tmpMoon = new THREE.Vector3();

export function Lighting() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const stars = useRef<THREE.Points>(null);
  const nightLights = useRef<(THREE.PointLight | null)[]>([]);
  const lastTime = useRef(-1000);
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;

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

  // The sky is a CSS gradient behind the (transparent) canvas: cheap and smooth.
  const gl = useThree((s) => s.gl);
  const lastSky = useRef('');
  useEffect(() => {
    scene.background = null;
    scene.fog = new THREE.Fog('#d4e2ea', 900, 2600);
    return () => {
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
    // R3F sets the shadow camera bounds but does not refresh its projection.
    light.shadow.camera.updateProjectionMatrix();
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
    // Smooth weather changes, but snap after a seek (big jump of the clock).
    if (Math.abs(t - lastTime.current) > 3) state.rain = rainTarget;
    else state.rain += (rainTarget - state.rain) * damp(1.5, Math.min(dt, 0.1));
    lastTime.current = t;
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
    const top = `#${tmpTop.copy(state.sky).multiplyScalar(0.8).getHexString()}`;
    const mid = `#${state.sky.getHexString()}`;
    const bottom = `#${state.fog.getHexString()}`;
    const css = `linear-gradient(to bottom, ${top} 0%, ${mid} 38%, ${bottom} 75%, ${bottom} 100%)`;
    if (css !== lastSky.current) {
      lastSky.current = css;
      gl.domElement.style.background = css;
    }
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(state.fog);
      const d = env.camDistance;
      fog.near = Math.max(260, d * 1.6) * (1 - rain * 0.35);
      fog.far = Math.max(1100, d * 5.2) * (1 - rain * 0.4);
    }

    const elev = lerp(a.elev, b.elev, f);
    sunDirection(t, elev, night, state.dir);
    if (sun.current) {
      const l = sun.current;
      // Tight shadow frustum around what the camera looks at (snapped to texels to avoid shimmering).
      const extent = THREE.MathUtils.clamp(env.camDistance * 0.85, 45, SHADOW_EXTENT);
      const cam = l.shadow.camera as THREE.OrthographicCamera;
      if (Math.abs(cam.right - extent) > extent * 0.04) {
        cam.left = -extent;
        cam.right = extent;
        cam.top = extent;
        cam.bottom = -extent;
        cam.updateProjectionMatrix();
      }
      const texel = (extent * 2) / 2048;
      tmpTarget.copy(controls?.target ?? CITY_CENTER);
      tmpTarget.x = Math.round(tmpTarget.x / texel) * texel;
      tmpTarget.z = Math.round(tmpTarget.z / texel) * texel;
      tmpTarget.y = 0;
      l.target.position.copy(tmpTarget);
      l.position.copy(tmpTarget).addScaledVector(state.dir, 800);
      state.sunColor.copy(ca.sun).lerp(cb.sun, f).lerp(RAIN_SUN, rain * 0.6);
      l.color.copy(state.sunColor);
      l.intensity = lerp(a.sunI, b.sunI, f) * (1 - rain * 0.6);
    }
    if (hemi.current) {
      const h = hemi.current;
      h.color.copy(ca.hemiSky).lerp(cb.hemiSky, f);
      h.groundColor.copy(ca.hemiGround).lerp(cb.hemiGround, f);
      h.intensity = lerp(a.hemiI, b.hemiI, f) * (1 - rain * 0.15) * 0.72 + night * 0.22;
    }

    // Shared uniforms: sky reflection in glass and water, haze colour, time.
    U.uTime.value = performance.now() / 1000;
    U.uNight.value = night;
    U.uSky.value.copy(state.sky).multiplyScalar(1 - night * 0.85);
    U_SKY.value.copy(state.sky).multiplyScalar(0.75 * (1 - night * 0.9));
    U.uHazeColor.value.copy(state.fog);
    U.uHazeK.value = THREE.MathUtils.smoothstep(env.camDistance, 60, 260);
    // Image-based light for the materials: lower at golden hour so the warm sun reads, faint at night.
    const golden = THREE.MathUtils.smoothstep(t, 1020, 1110) * (1 - THREE.MathUtils.smoothstep(t, 1170, 1200)) + (1 - THREE.MathUtils.smoothstep(t, 400, 450));
    scene.environmentIntensity = THREE.MathUtils.lerp(0.34 - golden * 0.14, 0.035, night) * (1 - rain * 0.3);
    for (const m of SIGN_MATERIALS) m.emissiveIntensity = 0.04 + THREE.MathUtils.smoothstep(night, 0.2, 0.7) * 0.55;
    const on = THREE.MathUtils.smoothstep(night, 0.15, 0.6);
    nightLights.current.forEach((pl, i) => {
      if (!pl) return;
      pl.intensity = on * 45 * NIGHT_LIGHTS[i][3];
    });
    starMat.opacity = Math.max(0, night - 0.3) * (1 - rain) * 1.2;
    starMat.visible = starMat.opacity > 0.01;

    // Shared label sizing factor for sprites with sizeAttenuation = false.
    const persp = camera as THREE.PerspectiveCamera;
    env.pxToSprite = (2 * Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 38) / 2)) / Math.max(200, size.height);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#cfe3f5', '#7d7058', 0.9]} />
      <Suspense fallback={null}>
        <Environment files="/models/hdri/dusseldorf_bridge_1k.hdr" background={false} environmentIntensity={0.5} />
      </Suspense>
      {NIGHT_LIGHTS.map(([x, y, z], i) => (
        <pointLight
          key={i}
          ref={(el) => {
            nightLights.current[i] = el;
          }}
          position={[x, y, z]}
          color="#ffbf73"
          intensity={0}
          distance={38}
          decay={1.8}
        />
      ))}
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
