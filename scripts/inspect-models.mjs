// Helper: prints size, triangle count, materials and animations of glTF models (node scripts/inspect-models.mjs <dir|file>...).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
const files = process.argv.slice(2).flatMap((d) => (statSync(d).isDirectory() ? readdirSync(d).filter((f) => f.endsWith('.glb')).map((f) => `${d}/${f}`) : [d]));
const verbose = process.env.VERBOSE === '1';
for (const file of files) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const g = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
    const box = new THREE.Box3().setFromObject(g.scene);
    const s = box.getSize(new THREE.Vector3());
    let tris = 0, meshes = 0, skinned = 0;
    const mats = new Set();
    g.scene.traverse((o) => {
      if (o.isMesh) {
        meshes++;
        if (o.isSkinnedMesh) skinned++;
        const geo = o.geometry;
        tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(`${m.name}:#${m.color?.getHexString()}${m.map ? '+tex' : ''}${m.vertexColors ? '+vc' : ''}`));
        if (verbose) console.log('   mesh', o.name, Object.keys(geo.attributes).join(','), o.isSkinnedMesh ? `bones=${o.skeleton.bones.length}` : '');
      }
    });
    console.log(file.split('/').slice(-2).join('/').padEnd(42), 'size', s.toArray().map((v) => v.toFixed(2)).join('x'), 'tris', tris, 'meshes', meshes, 'skinned', skinned, [...mats].join(' '));
    if (g.animations.length) console.log('   anims:', g.animations.map((a) => `${a.name}(${a.duration.toFixed(2)})`).join(' '));
  } catch (e) {
    console.log(file, 'ERR', String(e).slice(0, 120));
  }
}
