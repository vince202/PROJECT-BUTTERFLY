/**
 * BUTTERFLY — 3D city diorama.
 *
 * <CityScene/> renders a full-size canvas filling its (relatively positioned)
 * parent. It takes no props: everything is read from the zustand store.
 * Per-frame values (clock, positions) are read with getState() inside
 * useFrame, so the React tree does not re-render while the simulation plays.
 */

import type { JSX } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Agents } from './Agents';
import { Buildings } from './Buildings';
import { Buses } from './Buses';
import { CameraRig, INITIAL_CAMERA } from './CameraRig';
import { Lighting } from './Lighting';
import { Park, Trees } from './Nature';
import { Rain } from './Rain';
import { Streets } from './Streets';
import { CAMERA_FOV } from './shared';
import './render.css';

export function CityScene(): JSX.Element {
  return (
    <div className="city-scene">
      <Canvas
        className="city-scene__canvas"
        frameloop="always"
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: CAMERA_FOV, near: 5, far: 7000, position: INITIAL_CAMERA }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Lighting />
        <Streets />
        <Park />
        <Trees />
        <Buildings />
        <Buses />
        <Agents />
        <Rain />
        <CameraRig />
      </Canvas>
      <div className="city-scene__vignette" aria-hidden="true" />
    </div>
  );
}
