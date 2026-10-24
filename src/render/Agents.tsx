/**
 * The twenty inhabitants.
 *
 * Near the camera each inhabitant is an animated Quaternius character
 * (characters.ts: Idle / Walk / SitDown / Victory / PickUp, clothes tinted
 * with the profile colour); far away, or while the models load, a cheap
 * procedural figure that grows with distance so people stay readable on the
 * overview. Positions are always the interpolated trace positions; on top of
 * them the view adds: right-hand sidewalk offset while walking, facing the
 * partner during a conversation (with a speech bubble), sitting on the seats
 * placed at the standing spots (café terrace...), waiting on the sidewalk at
 * bus stops, sleep dimming with "z z z".
 *
 * Mood (trace `mood`, -1..1, interpolated) is shown by a coloured ring at the
 * feet, a pictogram for strong moods and the posture of the far figure.
 * Names only appear for the hovered / selected / followed inhabitant.
 * Nothing here triggers React re-renders while the clock runs.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LOCATIONS, getCity } from '../sim/city';
import { AGENTS } from '../sim/population';
import type { AgentProfile } from '../sim/types';
import { useSimStore } from '../store/useSimStore';
import { MOOD_HIGH, MOOD_LOW, type StreetSample, activeRealityOf, agentMood, agentWorld, angleDelta, damp, env, hashString, labelMaterial, makeLabel, moodColor, radialTexture, sampleFrames, sizeLabel, streetLerp } from './shared';
import { CURB_H, STOP_PUSH, onRoad } from './layout';
import { seatAt } from './seats';
import { type CharacterRig, type ClipName, CharacterCast, playClip } from './characters';
import { conversationsAt, pickupsAt, speechTextures, type TalkKind } from './social';

/** Far figure scale at close range (about 1.8 m tall). */
const AGENT_SCALE = 0.24;
/** Native height of the far figure (units, before AGENT_SCALE). */
const MEEPLE_UNITS = 7.5;
/** Distance up to which the animated character is shown instead of the far figure. */
const LOD_DISTANCE = 150;
/** Lateral offset applied while walking so that people use the right-hand sidewalk (metres). */
const SIDEWALK_OFFSET = 8.5;
/** Below this camera distance the mood glyphs are a little bigger. */
const ALL_NAMES_DISTANCE = 380;


/** |mood| above which the pictogram appears (with a little hysteresis below). */
const GLYPH_ON = 0.45;
const GLYPH_OFF = 0.41;
/** On-screen height of the mood pictogram (CSS px). */
const GLYPH_PX = 17;
/** Height of the mood ring above the ground (just above sidewalks, below selection rings). */
const MOOD_RING_Y = 0.36;
/** Ring alpha while awake / asleep. */
const RING_ALPHA = 0.95;
const RING_ALPHA_ASLEEP = 0.3;

const SKIN = ['#f1c7a5', '#e5b48e', '#c98e66', '#8d5a3b', '#f4d2b8'];
const HAIR = ['#3b2a20', '#5a3b26', '#1f1a17', '#a8743f', '#d9b56c', '#7a3f22'];

// Shared geometries --------------------------------------------------------

function makeGeometries() {
  const leg = new THREE.CapsuleGeometry(0.42, 1.3, 4, 8);
  leg.translate(0, -1.07, 0); // pivot at the hip
  const arm = new THREE.CapsuleGeometry(0.3, 1.3, 4, 8);
  arm.translate(0, -0.85, 0); // pivot at the shoulder
  const body = new THREE.CapsuleGeometry(1.05, 1.6, 6, 14);
  const head = new THREE.SphereGeometry(0.95, 18, 14);
  const hair = new THREE.SphereGeometry(1.02, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const eye = new THREE.SphereGeometry(0.13, 8, 6);
  const hit = new THREE.CylinderGeometry(3.4, 3.4, 9.5, 8);
  hit.translate(0, 4.75, 0);
  return { leg, arm, body, head, hair, eye, hit };
}

// Mood textures (drawn on canvases, no network fonts) ------------------------

/** White ring with a faint inner fill; tinted per instance by the mood colour. */
function makeMoodRingTexture(): THREE.CanvasTexture {
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const r = n / 2;
  const fill = ctx.createRadialGradient(r, r, 0, r, r, r * 0.8);
  fill.addColorStop(0, 'rgba(255,255,255,0)');
  fill.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  fill.addColorStop(1, 'rgba(255,255,255,0.3)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.15;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Small round badge with a sun (joy) or a cloud with a droplet (low mood). */
function makeGlyphTexture(kind: 'joy' | 'low'): THREE.CanvasTexture {
  const n = 96;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const cx = n / 2;
  const cy = n / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 252, 245, 0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(40, 36, 30, 0.18)';
  ctx.stroke();
  if (kind === 'joy') {
    const col = `#${MOOD_HIGH.getHexString(THREE.SRGBColorSpace)}`;
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 21, cy + Math.sin(a) * 21);
      ctx.lineTo(cx + Math.cos(a) * 31, cy + Math.sin(a) * 31);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  } else {
    const col = `#${MOOD_LOW.getHexString(THREE.SRGBColorSpace)}`;
    ctx.fillStyle = col;
    const y = cy - 6;
    ctx.beginPath();
    ctx.arc(cx - 13, y + 3, 11, 0, Math.PI * 2);
    ctx.arc(cx + 1, y - 5, 14, 0, Math.PI * 2);
    ctx.arc(cx + 15, y + 4, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 13, y + 3, 28, 11);
    // Droplet
    const dx = cx + 1;
    const dy = cy + 16;
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.quadraticCurveTo(dx + 7, dy + 10, dx, dy + 15);
    ctx.quadraticCurveTo(dx - 7, dy + 10, dx, dy);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Shared ring material with a per-instance alpha attribute (`aAlpha`) on top of instance colours. */
function makeMoodRingMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, opacity: 1 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
  };
  mat.customProgramCacheKey = () => 'mood-ring';
  return mat;
}

const smooth01 = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
};

interface Meeple {
  id: string;
  profile: AgentProfile;
  root: THREE.Group;
  inner: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  eyes: THREE.Mesh[];
  head: THREE.Mesh;
  hair: THREE.Mesh;
  hit: THREE.Mesh;
  label: THREE.Sprite;
  labelAspect: number;
  zz: THREE.Sprite;
  glyph: THREE.Sprite;
  bubble: THREE.Sprite;
  bubbleKind: TalkKind | null;
  mats: { body: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; legs: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial };
  bodyColor: THREE.Color;
  rig: CharacterRig | null;
  /** Part meshes of the far figure (never drawn: they drive the instanced crowd). */
  parts: THREE.Mesh[];
  /** Umbrella opened by walkers in the rain. */
  umbrella: THREE.Group;
  // Animation state
  heading: number;
  phase: number;
  moveK: number;
  hoverK: number;
  offset: THREE.Vector3;
  last: THREE.Vector3;
  groundY: number;
  asleep: boolean;
  dimmed: boolean;
  initialised: boolean;
  mood: number;
  glyphK: number;
  glyphKind: 'joy' | 'low' | null;
  /** Next time (s) a joyful idle may play its little victory gesture. */
  nextFidget: number;
  /** One-shot clip currently playing (victory, pickup...), if any. */
  oneShot: ClipName | null;
  /** Head turn for idle "look around". */
  look: number;
}

const noRaycast = () => {};
const UMBRELLA_CANOPY = new THREE.ConeGeometry(0.78, 0.38, 8, 1, true);
const UMBRELLA_POLE = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4);

function makeMeeple(p: AgentProfile, geo: ReturnType<typeof makeGeometries>, eyeMat: THREE.Material, hitMat: THREE.Material, zzMat: THREE.SpriteMaterial): Meeple {
  const h = hashString(p.id);
  const bodyColor = new THREE.Color(p.color);
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.55 }),
    skin: new THREE.MeshStandardMaterial({ color: SKIN[h % SKIN.length], roughness: 0.6 }),
    legs: new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.35).lerp(new THREE.Color('#2d3440'), 0.6), roughness: 0.7 }),
    hair: new THREE.MeshStandardMaterial({ color: p.age >= 62 ? '#d8d6d0' : HAIR[(h >>> 3) % HAIR.length], roughness: 0.8 }),
  };
  const root = new THREE.Group();
  root.name = `agent:${p.id}`;
  const inner = new THREE.Group();
  inner.scale.setScalar(AGENT_SCALE);
  root.add(inner);
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.raycast = noRaycast;
    mesh.visible = false;
    inner.add(mesh);
    return mesh;
  };
  const legL = mk(geo.leg, mats.legs, -0.5, 2.2, 0);
  const legR = mk(geo.leg, mats.legs, 0.5, 2.2, 0);
  const torso = mk(geo.body, mats.body, 0, 3.8, 0);
  const armL = mk(geo.arm, mats.body, -1.3, 5.0, 0);
  const armR = mk(geo.arm, mats.body, 1.3, 5.0, 0);
  armL.rotation.z = -0.12;
  armR.rotation.z = 0.12;
  const head = mk(geo.head, mats.skin, 0, 6.55, 0);
  const hair = mk(geo.hair, mats.hair, 0, 6.62, -0.08);
  hair.rotation.x = -0.35;
  const eyes = [mk(geo.eye, eyeMat, -0.34, 6.7, 0.84), mk(geo.eye, eyeMat, 0.34, 6.7, 0.84)];
  for (const e of eyes) e.castShadow = false;

  const hit = new THREE.Mesh(geo.hit, hitMat);
  hit.userData.agentId = p.id;
  root.add(hit);

  const lab = makeLabel({ text: p.firstName, dot: p.color, fontSize: 30 });
  const label = new THREE.Sprite(labelMaterial(lab, false));
  label.center.set(0.5, 0);
  label.renderOrder = 10;
  label.visible = false;
  label.raycast = noRaycast;
  root.add(label);

  const zz = new THREE.Sprite(zzMat);
  zz.center.set(0, 0);
  zz.visible = false;
  zz.renderOrder = 9;
  zz.raycast = noRaycast;
  root.add(zz);

  const glyph = new THREE.Sprite();
  glyph.center.set(0.5, 0);
  glyph.visible = false;
  glyph.renderOrder = 11;
  glyph.raycast = noRaycast;
  root.add(glyph);

  const bubble = new THREE.Sprite();
  bubble.center.set(0.3, 0);
  bubble.visible = false;
  bubble.renderOrder = 12;
  bubble.raycast = noRaycast;
  root.add(bubble);

  const umbrella = new THREE.Group();
  const uMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).lerp(new THREE.Color('#2d3440'), 0.25), roughness: 0.6, side: THREE.DoubleSide });
  const canopy = new THREE.Mesh(UMBRELLA_CANOPY, uMat);
  canopy.position.y = 2.05;
  canopy.castShadow = true;
  const pole = new THREE.Mesh(UMBRELLA_POLE, eyeMat);
  pole.position.set(0, 1.62, 0);
  for (const o of [canopy, pole]) o.raycast = noRaycast;
  umbrella.add(canopy, pole);
  umbrella.position.set(0.12, 0, 0.12);
  umbrella.visible = false;
  root.add(umbrella);

  return {
    id: p.id, profile: p, root, umbrella, inner, legL, legR, armL, armR, eyes, head, hair, hit, label, labelAspect: lab.aspect, zz, glyph, bubble, bubbleKind: null, mats, bodyColor, rig: null,
    parts: [legL, legR, torso, armL, armR, head, hair, eyes[0], eyes[1]],
    heading: 0, phase: 0, moveK: 0, hoverK: 0, offset: new THREE.Vector3(), last: new THREE.Vector3(), groundY: CURB_H, asleep: false, dimmed: false, initialised: false, mood: 0, glyphK: 0, glyphKind: null,
    nextFidget: 8 + (h % 20), oneShot: null, look: 0,
  };
}

function setDimmed(m: Meeple, dim: boolean) {
  m.dimmed = dim;
  const all: THREE.Material[] = [...Object.values(m.mats)];
  if (m.rig) all.push(m.rig.material);
  for (const mat of all) {
    mat.transparent = dim;
    mat.opacity = dim ? 0.32 : 1;
    mat.depthWrite = !dim;
    mat.needsUpdate = true;
  }
  for (const e of m.eyes) e.visible = !dim;
  m.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== m.hit) o.castShadow = !dim;
  });
}

const tmpTarget = new THREE.Vector3();
const sample: StreetSample = { x: 0, y: 0, dx: 0, dy: 0 };
const tmpEmissive = new THREE.Color();
const tmpMood = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpCam = new THREE.Vector3();
const tmpCrowd = new THREE.Color();

/** Bus stop id -> push direction (z) for waiting people. */
const STOP_SIDE = new Map<string, number>();
{
  const city = getCity();
  for (const l of LOCATIONS) if (l.kind === 'bus_stop') STOP_SIDE.set(l.id, Math.sign(l.pos.y - city.nodePos(l.node).y) || -1);
}

export function Agents() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const selectAgent = useSimStore((s) => s.selectAgent);
  const hoverAgent = useSimStore((s) => s.hoverAgent);

  const { meeples, ring, shadow, glyphMats, bubbleMats, dispose, crowd } = useMemo(() => {
    const geo = makeGeometries();
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#1d1a17' });
    const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
    const zzLabel = makeLabel({ text: 'z z z', fontSize: 26, background: 'rgba(40,52,90,0.78)', color: '#e8ecff', bold: true });
    const zzMat = labelMaterial(zzLabel);
    const meeples = AGENTS.map((p) => makeMeeple(p, geo, eyeMat, hitMat, zzMat));
    for (const m of meeples) m.zz.userData.aspect = zzLabel.aspect;

    // Mood rings: one instanced draw call for everybody.
    const ringGeo = new THREE.PlaneGeometry(1, 1);
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(new Float32Array(meeples.length).fill(RING_ALPHA), 1));
    const ringTex = makeMoodRingTexture();
    const ringMat = makeMoodRingMaterial(ringTex);
    const ring = new THREE.InstancedMesh(ringGeo, ringMat, meeples.length);
    ring.name = 'agent-mood-rings';
    ring.frustumCulled = false;
    ring.raycast = noRaycast;
    ring.renderOrder = 2;
    // Soft contact shadows.
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: '#000000', transparent: true, opacity: 0.38, depthWrite: false });
    const shadow = new THREE.InstancedMesh(shadowGeo, shadowMat, meeples.length);
    shadow.name = 'agent-contact-shadows';
    shadow.frustumCulled = false;
    shadow.raycast = noRaycast;
    shadow.renderOrder = 1;
    for (let i = 0; i < meeples.length; i++) {
      ring.setMatrixAt(i, HIDDEN_MATRIX);
      ring.setColorAt(i, moodColor(0, tmpMood));
      shadow.setMatrixAt(i, HIDDEN_MATRIX);
    }
    ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ring.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const glyphTex = { joy: makeGlyphTexture('joy'), low: makeGlyphTexture('low') };
    const spriteMat = (map: THREE.Texture) => new THREE.SpriteMaterial({ map, sizeAttenuation: false, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    const glyphMats = { joy: spriteMat(glyphTex.joy), low: spriteMat(glyphTex.low) };
    const st = speechTextures();
    const bubbleMats = { talk: spriteMat(st.talk), argue: spriteMat(st.argue), meet: spriteMat(st.meet) };

    const dispose = () => {
      ringGeo.dispose();
      ringTex.dispose();
      ringMat.dispose();
      ring.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      shadow.dispose();
      glyphTex.joy.dispose();
      glyphTex.low.dispose();
      Object.values(glyphMats).forEach((m) => m.dispose());
      Object.values(bubbleMats).forEach((m) => m.dispose());
      Object.values(geo).forEach((g) => g.dispose());
      eyeMat.dispose();
      hitMat.dispose();
      zzLabel.texture.dispose();
      zzMat.dispose();
      for (const m of meeples) {
        Object.values(m.mats).forEach((mt) => mt.dispose());
        (m.label.material as THREE.SpriteMaterial).map?.dispose();
        m.label.material.dispose();
      }
    };
    // Far figures: one instanced mesh per body part for the whole crowd (9 draw calls).
    const partMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const crowd = meeples[0].parts.map((part, pi) => {
      const im = new THREE.InstancedMesh(part.geometry, pi >= 7 ? eyeMat : partMat, meeples.length);
      im.name = `crowd:${pi}`;
      im.castShadow = pi < 7;
      im.frustumCulled = false;
      im.raycast = noRaycast;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < meeples.length; i++) {
        im.setMatrixAt(i, HIDDEN_MATRIX);
        im.setColorAt(i, (meeples[i].parts[pi].material as THREE.MeshStandardMaterial).color ?? new THREE.Color('#1d1a17'));
      }
      return im;
    });
    const disposeAll = () => {
      dispose();
      partMat.dispose();
      for (const im of crowd) im.dispose();
    };
    return { meeples, ring, shadow, glyphMats, bubbleMats, dispose: disposeAll, crowd };
  }, []);

  useEffect(() => dispose, [dispose]);
  useEffect(
    () => () => {
      gl.domElement.style.cursor = '';
    },
    [gl],
  );

  // Attach the animated characters once loaded.
  const onRigs = useCallback(
    (rigs: Map<string, CharacterRig>) => {
      for (const m of meeples) {
        const rig = rigs.get(m.id) ?? null;
        m.rig = rig;
        if (rig) {
          m.root.add(rig.group);
          rig.group.visible = false;
          if (m.dimmed) setDimmed(m, true);
        }
      }
    },
    [meeples],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = useSimStore.getState();
    const reality = activeRealityOf(s);
    const pair = sampleFrames(reality, s.time);
    const t = performance.now() / 1000;
    const ringAlpha = ring.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute;
    const talks = conversationsAt(reality, s.time);
    const pickups = pickupsAt(reality, s.time);
    camera.getWorldPosition(tmpCam);
    const spectator = s.uiMode === 'spectator';

    for (let i = 0; i < meeples.length; i++) {
      const m = meeples[i];
      const a0 = pair?.f0.agents[m.id];
      const a1 = pair?.f1.agents[m.id] ?? a0;
      if (!pair || !a0 || !a1) {
        m.root.visible = false;
        m.hit.raycast = noRaycast;
        ring.setMatrixAt(i, HIDDEN_MATRIX);
        shadow.setMatrixAt(i, HIDDEN_MATRIX);
        for (const im of crowd) im.setMatrixAt(i, HIDDEN_MATRIX);
        agentWorld.set(m.id, { pos: m.root.position, visible: false });
        continue;
      }
      const k = pair.k;
      let x: number;
      let z: number;
      const jump = Math.hypot(a1.x - a0.x, a1.y - a0.y);
      if (jump > 250) {
        x = k < 0.5 ? a0.x : a1.x;
        z = k < 0.5 ? a0.y : a1.y;
      } else {
        streetLerp(a0.x, a0.y, a1.x, a1.y, k, sample);
        x = sample.x;
        z = sample.y;
      }
      const riding = k < 0.5 ? a0.riding : a1.riding;
      const asleep = a0.asleep;
      const travelling = (a0.loc === '' || a1.loc === '') && !riding;
      const moving = jump > 2 && jump <= 250 && !riding;
      const loc = a0.loc;
      const seat = !moving && loc ? seatAt(loc, x, z) : null;
      const talk = !moving && !asleep ? talks?.get(m.id) : undefined;

      // Heading: along the movement, towards a conversation partner, or the seat's direction.
      if (moving) {
        const target = Math.atan2(sample.dx, sample.dy);
        m.heading += angleDelta(m.heading, target) * damp(10, dt);
      } else if (seat) {
        m.heading += angleDelta(m.heading, seat.heading) * damp(6, dt);
      } else if (talk) {
        const other = agentWorld.get(talk.partner);
        if (other && other.visible) {
          const dx = other.pos.x - m.root.position.x;
          const dz = other.pos.z - m.root.position.z;
          if (dx * dx + dz * dz > 0.04) m.heading += angleDelta(m.heading, Math.atan2(dx, dz)) * damp(5, dt);
        }
      }
      // Right-hand sidewalk offset while walking; waiting people stand on the sidewalk at stops.
      if (moving && travelling) tmpTarget.set(-sample.dy * SIDEWALK_OFFSET, 0, sample.dx * SIDEWALK_OFFSET);
      else if (!moving && loc && STOP_SIDE.has(loc)) tmpTarget.set(0, 0, STOP_SIDE.get(loc)! * STOP_PUSH);
      else tmpTarget.set(0, 0, 0);
      if (!m.initialised) m.offset.copy(tmpTarget);
      else m.offset.lerp(tmpTarget, damp(4, dt));
      const px = x + m.offset.x;
      const pz = z + m.offset.z;
      const gy = onRoad(px, pz) ? 0.02 : CURB_H;
      m.groundY = m.initialised ? m.groundY + (gy - m.groundY) * damp(12, dt) : gy;
      m.root.position.set(px, m.groundY, pz);
      m.root.rotation.y = m.heading;

      // Mood (interpolated between frames, smoothed against jumps).
      const moodTarget = a0.mood + (a1.mood - a0.mood) * k;
      if (!m.initialised) m.mood = moodTarget;
      else m.mood += (moodTarget - m.mood) * damp(6, dt);
      const mood = m.mood;
      agentMood.set(m.id, mood);
      const slump = smooth01((-mood - 0.4) / 0.4);
      const joy = smooth01((mood - 0.4) / 0.4);

      // Displayed speed (m/s) for the walk cycle.
      const moved = m.initialised ? m.last.distanceTo(m.root.position) : 0;
      m.last.copy(m.root.position);
      m.initialised = true;
      m.moveK += ((moving ? 1 : 0) - m.moveK) * damp(8, dt);
      const speed = dt > 0 ? moved / dt : 0;

      // Level of detail: animated character near the camera, growing figure far away.
      const dist = tmpCam.distanceTo(m.root.position);
      const near = !!m.rig && dist < LOD_DISTANCE;
      const hovered = s.hoveredAgentId === m.id;
      const selected = s.selectedAgentId === m.id;
      const followed = s.followAgentId === m.id;
      m.hoverK += ((hovered || selected ? 1 : 0) - m.hoverK) * damp(10, dt);
      const grow = 1 + m.hoverK * 0.12;
      const farGrow = Math.max(1.45, dist / 103);
      const nearGrow = 1 + 0.5 * THREE.MathUtils.smoothstep(dist, 40, LOD_DISTANCE);
      const height = (near ? 1.75 * nearGrow : MEEPLE_UNITS * AGENT_SCALE * farGrow) * grow;

      const visible = !riding;
      m.root.visible = visible;
      m.hit.raycast = visible ? THREE.Mesh.prototype.raycast : noRaycast;
      m.hit.scale.setScalar(Math.max(height, 2.2) / 9.5 * 1.15);
      if (asleep !== m.asleep) {
        m.asleep = asleep;
        setDimmed(m, asleep);
      }

      m.inner.visible = !near;
      if (m.rig) {
        const rig = m.rig;
        rig.group.visible = near;
        if (near) {
          rig.group.scale.setScalar(rig.baseScale * nearGrow * grow);
          // Animation state machine.
          let want: ClipName = 'idle';
          let ts = 1;
          if (moving) {
            want = 'walk';
            ts = THREE.MathUtils.clamp(speed / 1.5, 0.9, 2.4);
            m.oneShot = null;
          } else if (seat) {
            want = 'sit';
            m.oneShot = null;
          } else if (pickups?.has(m.id) && m.oneShot !== 'pickup' && rig.current !== 'pickup') {
            m.oneShot = 'pickup';
          } else if (!asleep && joy > 0.3 && !talk && t > m.nextFidget && !m.oneShot) {
            m.oneShot = 'victory';
            m.nextFidget = t + 18 + (hashString(m.id) % 15);
          }
          if (!moving && !seat && m.oneShot) {
            const act = rig.actions[m.oneShot];
            if (act && rig.current === m.oneShot && !act.isRunning()) m.oneShot = null;
            else want = m.oneShot;
          }
          playClip(rig, want, want === 'sit' ? 0.35 : 0.25, ts);
          rig.mixer.update(dt);
          // Seated people sit slightly higher (chair seat) — the clip sits at ground level.
          // The sitting clip lowers the hips onto a seat behind the root: move back onto the chair.
          const sitting = want === 'sit' && !!seat;
          rig.group.position.y = sitting ? seat!.height - 0.41 : 0;
          rig.group.position.z = sitting ? -0.32 : 0;
          tmpEmissive.copy(m.bodyColor).multiplyScalar(m.hoverK * 0.35);
          rig.material.emissive.copy(tmpEmissive);
        }
      }
      if (!near) {
        // Far figure: procedural walk cycle and posture.
        m.phase += Math.min(moved, dt * 16) * 0.9 / farGrow;
        const swing = Math.sin(m.phase) * 0.65 * m.moveK * (1 + joy * 0.15 - slump * 0.25);
        m.legL.rotation.x = swing;
        m.legR.rotation.x = -swing;
        m.armL.rotation.x = -swing * 0.8;
        m.armR.rotation.x = swing * 0.8;
        m.inner.position.y = Math.abs(Math.sin(m.phase)) * 0.35 * m.moveK * AGENT_SCALE * farGrow * (1 + joy * 0.8 - slump * 0.3);
        m.inner.rotation.x = slump * 0.07;
        m.head.position.y = 6.55 - slump * 0.22;
        m.hair.position.y = 6.62 - slump * 0.22;
        m.hair.rotation.x = -0.35 + slump * 0.22;
        for (const e of m.eyes) {
          e.position.y = 6.7 - slump * 0.4;
          e.position.z = 0.84 + slump * 0.05;
        }
        m.armL.rotation.z = -0.12 + slump * 0.08;
        m.armR.rotation.z = 0.12 - slump * 0.08;
        const sc = AGENT_SCALE * farGrow * grow;
        m.inner.scale.set(sc, sc * (1 - slump * 0.04), sc);
        tmpEmissive.copy(m.bodyColor).multiplyScalar(m.hoverK * 0.45);
        m.mats.body.emissive.copy(tmpEmissive);
      }

      // Umbrellas in the rain (walkers and people waiting at stops).
      const wantUmbrella = visible && env.rain > 0.35 && !asleep && !seat && (moving || (!!loc && STOP_SIDE.has(loc)) || loc === 'park');
      m.umbrella.visible = wantUmbrella;
      if (wantUmbrella) m.umbrella.scale.setScalar(height / 1.75);

      // Sleep bubble
      m.zz.visible = asleep && visible;
      if (m.zz.visible) {
        sizeLabel(m.zz, m.zz.userData.aspect as number, 15);
        m.zz.position.set(0.25 * height, height * 0.95 + Math.sin(t * 1.5 + i) * 0.06 * height, 0);
      }

      // Name: only for the hovered, selected or followed inhabitant.
      const showLabel = visible && (hovered || selected || followed) && !(spectator && !hovered && !followed);
      m.label.visible = showLabel;
      if (showLabel) {
        sizeLabel(m.label, m.labelAspect, selected || hovered ? 21 : 18);
        m.label.position.y = height * 1.08 + 0.2;
        (m.label.material as THREE.SpriteMaterial).opacity = asleep ? 0.6 : 1;
      }

      // Speech bubble for the conversation leader.
      const wantBubble = visible && !!talk && talk.leader && dist < 420;
      if (wantBubble && m.bubbleKind !== talk!.kind) {
        m.bubbleKind = talk!.kind;
        m.bubble.material = bubbleMats[talk!.kind];
      }
      m.bubble.visible = wantBubble;
      if (wantBubble) {
        const px2 = dist < 120 ? 30 : 24;
        sizeLabel(m.bubble, 128 / 112, px2);
        const lift = showLabel ? 24 : 4;
        m.bubble.center.set(0.3, -(lift + Math.sin(t * 3 + i) * 1.5) / px2);
        m.bubble.position.set(0, height * 1.02, 0);
      }

      // Mood ring and contact shadow at the feet.
      const footR = near ? 1.25 * nearGrow : 1.35 * farGrow;
      if (visible) {
        tmpMatrix.makeScale(footR * 2 * grow, 1, footR * 2 * grow).setPosition(m.root.position.x, m.groundY + MOOD_RING_Y - CURB_H + 0.06, m.root.position.z);
        ring.setMatrixAt(i, tmpMatrix);
        ring.setColorAt(i, moodColor(mood, tmpMood));
        ringAlpha.setX(i, asleep ? RING_ALPHA_ASLEEP : RING_ALPHA);
        tmpMatrix.makeScale(footR * 1.5, 1, footR * 1.5).setPosition(m.root.position.x, m.groundY + 0.04, m.root.position.z);
        shadow.setMatrixAt(i, asleep ? HIDDEN_MATRIX : tmpMatrix);
      } else {
        ring.setMatrixAt(i, HIDDEN_MATRIX);
        shadow.setMatrixAt(i, HIDDEN_MATRIX);
      }

      // Mood pictogram (not while asleep).
      const strength = Math.abs(mood);
      const kind = mood >= 0 ? 'joy' : 'low';
      const wantGlyph = visible && !asleep && !wantBubble && (strength >= GLYPH_ON || (strength >= GLYPH_OFF && m.glyphKind === kind && m.glyphK > 0.5));
      if (wantGlyph && m.glyphKind !== kind && m.glyphK < 0.05) {
        m.glyphKind = kind;
        m.glyph.material = glyphMats[kind];
      }
      const glyphTarget = wantGlyph && m.glyphKind === kind ? 1 : 0;
      m.glyphK += (glyphTarget - m.glyphK) * damp(7, dt);
      m.glyph.visible = m.glyphK > 0.02;
      if (m.glyph.visible) {
        const px = (env.camDistance < ALL_NAMES_DISTANCE ? GLYPH_PX : GLYPH_PX - 2) * m.glyphK;
        sizeLabel(m.glyph, 1, px);
        const lift = showLabel ? (selected || hovered ? 21 : 18) + 3 : 2;
        const bob = Math.sin(t * 2 + i * 1.7) * 1.2;
        m.glyph.center.y = -(lift + bob) / Math.max(px, 1e-3);
        m.glyph.position.y = height * 1.05;
      }

      // Feed the instanced crowd with the far figure's part transforms.
      if (visible && !near) {
        m.root.updateMatrixWorld(true);
        for (let pi = 0; pi < crowd.length; pi++) {
          crowd[pi].setMatrixAt(i, m.parts[pi].matrixWorld);
          const base = (m.parts[pi].material as THREE.MeshStandardMaterial).color;
          if (base && pi < 7) crowd[pi].setColorAt(i, tmpCrowd.copy(base).multiplyScalar(asleep ? 0.45 : 1).lerp(m.bodyColor, pi === 2 ? m.hoverK * 0.3 : 0));
        }
      } else for (const im of crowd) im.setMatrixAt(i, HIDDEN_MATRIX);
      agentWorld.set(m.id, { pos: m.root.position, visible, h: height });
    }
    for (const im of crowd) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    ring.instanceMatrix.needsUpdate = true;
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    ringAlpha.needsUpdate = true;
    shadow.instanceMatrix.needsUpdate = true;
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    const id = e.object.userData.agentId as string | undefined;
    if (!id) return;
    e.stopPropagation();
    hoverAgent(id);
    gl.domElement.style.cursor = 'pointer';
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    const id = e.object.userData.agentId as string | undefined;
    if (useSimStore.getState().hoveredAgentId === id) hoverAgent(null);
    gl.domElement.style.cursor = '';
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const id = e.object.userData.agentId as string | undefined;
    if (!id) return;
    e.stopPropagation();
    selectAgent(id);
  };

  return (
    <group>
      {meeples.map((m) => (
        <primitive key={m.id} object={m.root} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} />
      ))}
      <primitive object={ring} />
      <primitive object={shadow} />
      {crowd.map((im) => (
        <primitive key={im.name} object={im} />
      ))}
      <Suspense fallback={null}>
        <CharacterCast onReady={onRigs} />
      </Suspense>
      <SelectionFx />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Selection ring, soft spotlight, floating marker and hover ring
// ---------------------------------------------------------------------------

/** Height of each location's roof, used to lift the marker above buildings. */
const ROOF_HEIGHT = new Map(LOCATIONS.map((l) => [l.id, l.kind === 'park' || l.kind === 'bus_stop' ? 0 : l.height]));

function SelectionFx() {
  const ring = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const hoverRing = useRef<THREE.Mesh>(null);
  const marker = useRef<THREE.Mesh>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const markerFor = useRef<string | null>(null);
  const scene = useThree((s) => s.scene);

  const mats = useMemo(
    () => ({
      ring: new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      glow: new THREE.MeshBasicMaterial({ map: radialTexture(), color: '#ffd166', transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
      hover: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      marker: new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#ffb703', emissiveIntensity: 0.6, roughness: 0.4 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useEffect(() => {
    const l = spot.current;
    if (!l) return;
    scene.add(l.target);
    return () => {
      scene.remove(l.target);
    };
  }, [scene]);

  useFrame((_, dt) => {
    const s = useSimStore.getState();
    const t = performance.now() / 1000;
    const sel = s.selectedAgentId ? agentWorld.get(s.selectedAgentId) : undefined;
    if (sel) {
      moodColor(agentMood.get(s.selectedAgentId!) ?? 0, tmpMood);
      if (markerFor.current !== s.selectedAgentId) mats.marker.color.copy(tmpMood);
      else mats.marker.color.lerp(tmpMood, damp(6, dt));
      markerFor.current = s.selectedAgentId;
      mats.marker.emissive.copy(mats.marker.color).multiplyScalar(0.55);
    }
    if (ring.current && glow.current && marker.current) {
      ring.current.visible = !!sel && sel.visible;
      glow.current.visible = ring.current.visible;
      marker.current.visible = !!sel;
      if (sel) {
        const p = sel.pos;
        const h = sel.h ?? 1.8;
        const k = h / 1.8;
        const pulse = (1 + Math.sin(t * 3) * 0.08) * k;
        ring.current.position.set(p.x, p.y + 0.09, p.z);
        ring.current.scale.setScalar(pulse);
        glow.current.position.set(p.x, p.y + 0.08, p.z);
        glow.current.scale.setScalar(k);
        const frame = activeRealityOf(s).frameAt(Math.floor(s.time));
        const loc = frame?.agents[s.selectedAgentId!]?.loc ?? '';
        const roof = loc && !STOP_SIDE.has(loc) ? Math.min(ROOF_HEIGHT.get(loc) ?? 0, 6) : 0;
        const base = Math.max(h * 1.6, roof) + 1.2 * k;
        marker.current.position.set(p.x, p.y + base + Math.sin(t * 2.2) * 0.15 * k, p.z);
        marker.current.scale.setScalar(k);
        marker.current.rotation.y += dt * 1.5;
      }
    }
    if (spot.current) {
      const l = spot.current;
      if (sel && sel.visible) {
        l.position.set(sel.pos.x, 40, sel.pos.z + 8);
        l.target.position.set(sel.pos.x, 0, sel.pos.z);
        l.intensity += (1800 * (0.45 + env.night * 0.8) - l.intensity) * damp(6, dt);
      } else l.intensity += (0 - l.intensity) * damp(6, dt);
    }
    if (hoverRing.current) {
      const hov = s.hoveredAgentId && s.hoveredAgentId !== s.selectedAgentId ? agentWorld.get(s.hoveredAgentId) : undefined;
      hoverRing.current.visible = !!hov && hov.visible;
      if (hov) {
        hoverRing.current.position.set(hov.pos.x, hov.pos.y + 0.09, hov.pos.z);
        hoverRing.current.scale.setScalar((hov.h ?? 1.8) / 1.8);
      }
    }
  });

  return (
    <group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} material={mats.ring} visible={false} renderOrder={3}>
        <ringGeometry args={[1.25, 1.55, 48]} />
      </mesh>
      <mesh ref={glow} rotation-x={-Math.PI / 2} material={mats.glow} visible={false} renderOrder={2}>
        <planeGeometry args={[5, 5]} />
      </mesh>
      <mesh ref={hoverRing} rotation-x={-Math.PI / 2} material={mats.hover} visible={false} renderOrder={3}>
        <ringGeometry args={[1.15, 1.35, 40]} />
      </mesh>
      <mesh ref={marker} material={mats.marker} visible={false} rotation-x={Math.PI}>
        <coneGeometry args={[0.45, 0.9, 4]} />
      </mesh>
      <spotLight ref={spot} intensity={0} angle={0.12} penumbra={0.85} decay={2} distance={0} color="#fff1cc" />
    </group>
  );
}
