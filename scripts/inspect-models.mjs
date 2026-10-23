import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
globalThis.self = globalThis;
const dirs = process.argv.slice(2);
const loader = new GLTFLoader();
for (const d of dirs) for (const f of readdirSync(d).filter(f=>f.endsWith('.glb'))) {
  const buf = readFileSync(`${d}/${f}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  try {
    const g = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
    const box = new THREE.Box3().setFromObject(g.scene); const s = box.getSize(new THREE.Vector3());
    let tris = 0, meshes = 0; const mats = new Set();
    g.scene.traverse(o => { if (o.isMesh) { meshes++; const geo=o.geometry; tris += (geo.index ? geo.index.count : geo.attributes.position.count)/3; (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m.name+':'+(m.color?'#'+m.color.getHexString():'')+(m.map?'+tex':''))); } });
    console.log(`${d.split('/').slice(-1)}/${f}`.padEnd(40), 'size', s.toArray().map(v=>v.toFixed(2)).join('x'), 'min', box.min.toArray().map(v=>v.toFixed(2)).join(','), 'tris', tris, 'meshes', meshes, 'anim', g.animations.length, [...mats].slice(0,8).join(' '));
  } catch (e) { console.log(f, 'ERR', String(e).slice(0,100)); }
}
