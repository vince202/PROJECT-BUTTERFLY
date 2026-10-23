/**
 * Orbit camera with diorama-friendly constraints, plus agent following:
 * when `followAgentId` is set, the orbit target (and the camera with it, so
 * the user's angle and zoom are kept) glides towards the followed agent.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { CITY_HEIGHT, CITY_WIDTH } from '../sim/city';
import { useSimStore } from '../store/useSimStore';
import { CITY_CENTER, agentWorld, damp, env } from './shared';

/** Initial camera: three-quarter view from the south-south-east. */
const INITIAL_DISTANCE = 830;
const INITIAL_POLAR = 0.92;
const INITIAL_AZIMUTH = 0.36;
export const INITIAL_CAMERA: [number, number, number] = [
  CITY_CENTER.x + INITIAL_DISTANCE * Math.sin(INITIAL_POLAR) * Math.sin(INITIAL_AZIMUTH),
  INITIAL_DISTANCE * Math.cos(INITIAL_POLAR),
  CITY_CENTER.z + INITIAL_DISTANCE * Math.sin(INITIAL_POLAR) * Math.cos(INITIAL_AZIMUTH),
];

const PAN_MARGIN = 80;
/** Half-width (metres) that the initial view must show, and the vertical half extent. */
const FIT_HALF_WIDTH = 400;
const FIT_HALF_HEIGHT = 190;
const prev = new THREE.Vector3();
const delta = new THREE.Vector3();

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const framed = useRef(false);

  // Initial framing: pick a distance so that the whole city fits the viewport.
  useEffect(() => {
    if (framed.current || size.width < 10 || size.height < 10) return;
    framed.current = true;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * (size.width / size.height);
    const d = THREE.MathUtils.clamp(Math.max(FIT_HALF_WIDTH / tanH, FIT_HALF_HEIGHT / tanV), 520, 1050);
    const dir = new THREE.Vector3(...INITIAL_CAMERA).sub(CITY_CENTER).normalize();
    camera.position.copy(CITY_CENTER).addScaledVector(dir, d);
    controls.current?.update();
  }, [camera, size]);

  useFrame(({ camera }, rawDt) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(rawDt, 0.1);
    const followId = useSimStore.getState().followAgentId;
    prev.copy(c.target);
    if (followId) {
      const a = agentWorld.get(followId);
      if (a) {
        c.target.x += (a.pos.x - c.target.x) * damp(3.5, dt);
        c.target.z += (a.pos.z - c.target.z) * damp(3.5, dt);
        c.target.y += (0 - c.target.y) * damp(3.5, dt);
      }
    }
    // Keep the target over the diorama.
    c.target.x = THREE.MathUtils.clamp(c.target.x, -PAN_MARGIN, CITY_WIDTH + PAN_MARGIN);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -PAN_MARGIN, CITY_HEIGHT + PAN_MARGIN);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0, 40);
    // Move the camera by the same amount so that angle and zoom are preserved.
    delta.subVectors(c.target, prev);
    if (delta.lengthSq() > 0) camera.position.add(delta);
    env.camDistance = camera.position.distanceTo(c.target);
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[CITY_CENTER.x, 0, CITY_CENTER.z]}
      enableDamping
      dampingFactor={0.08}
      minPolarAngle={0.6}
      maxPolarAngle={1.25}
      minDistance={120}
      maxDistance={1100}
      screenSpacePanning={false}
      rotateSpeed={0.55}
      zoomSpeed={0.9}
      panSpeed={0.9}
    />
  );
}
