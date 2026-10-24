/**
 * The miniature city: street graph, locations and bus line.
 *
 * Distances are in metres. The city is a 720 × 480 m grid of streets spaced
 * 120 m apart, with nodes every 60 m so that building entrances and bus stops
 * sit on real street nodes. Pathfinding is a plain Dijkstra over this graph.
 */

import { has, t } from '../i18n';
import type { BusLineDef, CityEdge, CityNode, LocationDef, LocationId, NodeId, Vec2 } from './types';

export const CITY_WIDTH = 720;
export const CITY_HEIGHT = 480;
export const STREET_SPACING = 120;
export const NODE_SPACING = 60;

/** Walking speed in metres per simulated minute (~4.8 km/h). */
export const WALK_SPEED = 72;
/** Walking speed in the rain. */
export const WALK_SPEED_RAIN = 60;

export function nodeId(x: number, y: number): NodeId {
  return `n${x}_${y}`;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Street segments removed to create larger blocks (park, school). Pairs of node ids. */
const REMOVED_SEGMENTS: [NodeId, NodeId][] = [];

function buildGraph(): { nodes: CityNode[]; edges: CityEdge[] } {
  const nodes = new Map<NodeId, CityNode>();
  const edges: CityEdge[] = [];
  const removed = new Set(REMOVED_SEGMENTS.map(([a, b]) => `${a}|${b}`).concat(REMOVED_SEGMENTS.map(([a, b]) => `${b}|${a}`)));

  const addNode = (x: number, y: number) => {
    const id = nodeId(x, y);
    if (!nodes.has(id)) nodes.set(id, { id, pos: { x, y } });
    return id;
  };
  const addEdge = (a: NodeId, b: NodeId) => {
    if (removed.has(`${a}|${b}`)) return;
    const pa = nodes.get(a)!.pos;
    const pb = nodes.get(b)!.pos;
    edges.push({ a, b, length: dist(pa, pb) });
  };

  // Horizontal streets
  for (let y = 0; y <= CITY_HEIGHT; y += STREET_SPACING) {
    let prev: NodeId | null = null;
    for (let x = 0; x <= CITY_WIDTH; x += NODE_SPACING) {
      const id = addNode(x, y);
      if (prev) addEdge(prev, id);
      prev = id;
    }
  }
  // Vertical streets
  for (let x = 0; x <= CITY_WIDTH; x += STREET_SPACING) {
    let prev: NodeId | null = null;
    for (let y = 0; y <= CITY_HEIGHT; y += NODE_SPACING) {
      const id = addNode(x, y);
      if (prev) addEdge(prev, id);
      prev = id;
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

const h = (hh: number, mm = 0) => hh * 60 + mm;

export const LOCATIONS: LocationDef[] = [
  // Row 0 (north)
  { id: 'res_lilas', name: 'Résidence des Lilas', kind: 'home', node: nodeId(60, 120), pos: { x: 60, y: 55 }, size: { x: 80, y: 60 }, height: 22, color: '#d9a066' },
  { id: 'imm_voltaire', name: 'Immeuble Voltaire', kind: 'home', node: nodeId(180, 120), pos: { x: 180, y: 55 }, size: { x: 80, y: 60 }, height: 26, color: '#c88a5c' },
  { id: 'school', name: 'École Jules Ferry', kind: 'school', node: nodeId(360, 120), pos: { x: 360, y: 55 }, size: { x: 190, y: 70 }, height: 14, color: '#e8d5a8', opens: h(7, 30), closes: h(18) },
  { id: 'clinic', name: 'Cabinet médical du Dr Fontaine', kind: 'clinic', node: nodeId(540, 120), pos: { x: 540, y: 55 }, size: { x: 80, y: 60 }, height: 12, color: '#dfe9f3', opens: h(8), closes: h(19), capacity: 4 },
  { id: 'gym', name: 'Gymnase Central', kind: 'gym', node: nodeId(660, 120), pos: { x: 660, y: 55 }, size: { x: 90, y: 70 }, height: 16, color: '#8fb3c9', opens: h(7), closes: h(22), capacity: 8 },
  // Row 1
  { id: 'maison_bleue', name: 'Maison Bleue', kind: 'home', node: nodeId(0, 180), pos: { x: 55, y: 180 }, size: { x: 60, y: 60 }, height: 12, color: '#7aa7d9' },
  { id: 'bakery', name: 'Boulangerie Au Levain d’Or', kind: 'bakery', node: nodeId(120, 180), pos: { x: 175, y: 180 }, size: { x: 70, y: 60 }, height: 11, color: '#f2c26b', opens: h(6, 30), closes: h(19, 30), capacity: 6, stock: 60 },
  { id: 'cafe', name: 'Café Le Papillon', kind: 'cafe', node: nodeId(300, 120), pos: { x: 300, y: 175 }, size: { x: 80, y: 70 }, height: 12, color: '#c0392b', opens: h(7), closes: h(23), capacity: 12 },
  { id: 'florist', name: 'Fleurs & Sens', kind: 'florist', node: nodeId(420, 120), pos: { x: 420, y: 175 }, size: { x: 60, y: 50 }, height: 9, color: '#e38fb2', opens: h(9), closes: h(19), capacity: 4 },
  { id: 'townhall', name: 'Hôtel de Ville', kind: 'townhall', node: nodeId(540, 240), pos: { x: 540, y: 185 }, size: { x: 90, y: 80 }, height: 20, color: '#efe7d6', opens: h(8, 30), closes: h(17) },
  { id: 'office', name: 'Agence Horizon', kind: 'office', node: nodeId(660, 240), pos: { x: 660, y: 185 }, size: { x: 80, y: 80 }, height: 34, color: '#6c8ebf', opens: h(7, 30), closes: h(20) },
  // Row 2
  { id: 'villa_rosa', name: 'Villa Rosa', kind: 'home', node: nodeId(60, 240), pos: { x: 60, y: 295 }, size: { x: 60, y: 60 }, height: 11, color: '#e9a3a3' },
  { id: 'supermarket', name: 'Supermarché Marché Plus', kind: 'supermarket', node: nodeId(180, 240), pos: { x: 180, y: 300 }, size: { x: 90, y: 80 }, height: 10, color: '#5fae6b', opens: h(8, 30), closes: h(20), capacity: 15 },
  { id: 'park', name: 'Parc des Tilleuls', kind: 'park', node: nodeId(360, 240), pos: { x: 360, y: 300 }, size: { x: 200, y: 95 }, height: 0, color: '#6fae5a', capacity: 40 },
  { id: 'library', name: 'Bibliothèque Municipale', kind: 'library', node: nodeId(480, 300), pos: { x: 540, y: 300 }, size: { x: 80, y: 70 }, height: 13, color: '#b58b5a', opens: h(10), closes: h(19), capacity: 10 },
  { id: 'restaurant', name: 'Restaurant Chez Lucie', kind: 'restaurant', node: nodeId(600, 300), pos: { x: 660, y: 300 }, size: { x: 80, y: 70 }, height: 12, color: '#d97b4a', opens: h(11, 30), closes: h(23), capacity: 14 },
  // Row 3 (south)
  { id: 'workshop', name: 'Atelier Dupré', kind: 'workshop', node: nodeId(60, 360), pos: { x: 60, y: 420 }, size: { x: 80, y: 70 }, height: 9, color: '#9c7b5a', opens: h(7), closes: h(19) },
  { id: 'res_parc', name: 'Résidence du Parc', kind: 'home', node: nodeId(180, 360), pos: { x: 180, y: 420 }, size: { x: 80, y: 70 }, height: 24, color: '#d2b48c' },
  { id: 'imm_haussmann', name: 'Immeuble Haussmann', kind: 'home', node: nodeId(300, 360), pos: { x: 300, y: 420 }, size: { x: 80, y: 70 }, height: 28, color: '#e3cfa6' },
  { id: 'maison_canal', name: 'Maison du Canal', kind: 'home', node: nodeId(420, 360), pos: { x: 420, y: 420 }, size: { x: 60, y: 60 }, height: 11, color: '#a3c2e9' },
  { id: 'loft_gare', name: 'Loft de la Gare', kind: 'home', node: nodeId(540, 360), pos: { x: 540, y: 420 }, size: { x: 80, y: 70 }, height: 15, color: '#b0a4c9' },
  { id: 'station', name: 'Gare Routière', kind: 'townhall', node: nodeId(660, 360), pos: { x: 660, y: 420 }, size: { x: 90, y: 70 }, height: 10, color: '#c9c3b8', opens: h(5), closes: h(24) },
  // Bus stops (on street nodes)
  { id: 'stop_lilas', name: 'Arrêt Les Lilas', kind: 'bus_stop', node: nodeId(60, 120), pos: { x: 70, y: 112 }, size: { x: 6, y: 4 }, height: 3, color: '#f1c40f' },
  { id: 'stop_super', name: 'Arrêt Supermarché', kind: 'bus_stop', node: nodeId(180, 240), pos: { x: 190, y: 232 }, size: { x: 6, y: 4 }, height: 3, color: '#f1c40f' },
  { id: 'stop_parc', name: 'Arrêt Parc', kind: 'bus_stop', node: nodeId(360, 240), pos: { x: 370, y: 232 }, size: { x: 6, y: 4 }, height: 3, color: '#f1c40f' },
  { id: 'stop_marche', name: 'Arrêt Place du Marché', kind: 'bus_stop', node: nodeId(420, 120), pos: { x: 430, y: 112 }, size: { x: 6, y: 4 }, height: 3, color: '#f1c40f' },
  { id: 'stop_mairie', name: 'Arrêt Mairie', kind: 'bus_stop', node: nodeId(540, 240), pos: { x: 550, y: 232 }, size: { x: 6, y: 4 }, height: 3, color: '#f1c40f' },
  { id: 'stop_gare', name: 'Arrêt Gare Routière', kind: 'bus_stop', node: nodeId(660, 360), pos: { x: 670, y: 352 }, size: { x: 6, y: 4 }, height: 3, color: '#f1c40f' },
];

export const BUS_LINES: BusLineDef[] = [
  {
    id: 'L1',
    name: 'Ligne 1 — Les Lilas ↔ Gare Routière',
    color: '#f39c12',
    stops: ['stop_lilas', 'stop_super', 'stop_parc', 'stop_marche', 'stop_mairie', 'stop_gare'],
    firstDeparture: h(6, 10),
    lastDeparture: h(23, 10),
    dwell: 1,
    speed: 360,
    capacity: 20,
  },
];

// Display names are read through the catalogue (`city.<id>`) at access time; the French literal above is the fallback.
function localizeName(def: { name: string }, key: string): void {
  const literal = def.name;
  Object.defineProperty(def, 'name', { enumerable: true, configurable: true, get: () => (has(key) ? t(key) : literal) });
}
for (const l of LOCATIONS) localizeName(l, `city.${l.id}`);
for (const l of BUS_LINES) localizeName(l, `city.line_${l.id}`);

/** Number of buses running on each line (one departing from each terminal). */
export const BUSES_PER_LINE = 2;

// ---------------------------------------------------------------------------
// City object with pathfinding
// ---------------------------------------------------------------------------

export class City {
  readonly nodes: Map<NodeId, CityNode>;
  readonly edges: CityEdge[];
  readonly adjacency: Map<NodeId, { to: NodeId; length: number }[]>;
  readonly locations: Map<LocationId, LocationDef>;
  readonly lines: BusLineDef[];
  private pathCache = new Map<string, NodeId[]>();
  private distCache = new Map<string, number>();

  constructor() {
    const { nodes, edges } = buildGraph();
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges;
    this.adjacency = new Map();
    for (const n of nodes) this.adjacency.set(n.id, []);
    for (const e of edges) {
      this.adjacency.get(e.a)!.push({ to: e.b, length: e.length });
      this.adjacency.get(e.b)!.push({ to: e.a, length: e.length });
    }
    this.locations = new Map(LOCATIONS.map((l) => [l.id, l]));
    this.lines = BUS_LINES;
    for (const l of LOCATIONS) {
      if (!this.nodes.has(l.node)) throw new Error(`Location ${l.id} references unknown node ${l.node}`);
    }
  }

  location(id: LocationId): LocationDef {
    const l = this.locations.get(id);
    if (!l) throw new Error(`Unknown location ${id}`);
    return l;
  }

  nodePos(id: NodeId): Vec2 {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown node ${id}`);
    return n.pos;
  }

  /** Entrance position of a location (its street node). */
  doorPos(id: LocationId): Vec2 {
    return this.nodePos(this.location(id).node);
  }

  /** Position where an agent stands when "inside" a location (between door and centre). */
  insidePos(id: LocationId, slot = 0): Vec2 {
    const loc = this.location(id);
    const door = this.doorPos(id);
    if (loc.kind === 'bus_stop') {
      return { x: door.x + 4 + (slot % 4) * 3, y: door.y - 4 - Math.floor(slot / 4) * 3 };
    }
    // Point 40% of the way from the door to the centre, spread in a small grid.
    const base = { x: door.x + (loc.pos.x - door.x) * 0.45, y: door.y + (loc.pos.y - door.y) * 0.45 };
    const col = slot % 4;
    const row = Math.floor(slot / 4);
    return { x: base.x + (col - 1.5) * 5, y: base.y + (row - 1) * 5 };
  }

  /** Dijkstra shortest path between two nodes (cached). Returns node ids including both ends. */
  pathNodes(from: NodeId, to: NodeId): NodeId[] {
    const key = `${from}>${to}`;
    const cached = this.pathCache.get(key);
    if (cached) return cached;
    if (from === to) {
      this.pathCache.set(key, [from]);
      this.distCache.set(key, 0);
      return [from];
    }
    const distMap = new Map<NodeId, number>([[from, 0]]);
    const prev = new Map<NodeId, NodeId>();
    const visited = new Set<NodeId>();
    // Simple O(n²) Dijkstra — the graph has ~150 nodes, this is plenty fast.
    const frontier: NodeId[] = [from];
    while (frontier.length) {
      let bestIdx = 0;
      for (let i = 1; i < frontier.length; i++) {
        if (distMap.get(frontier[i])! < distMap.get(frontier[bestIdx])!) bestIdx = i;
      }
      const current = frontier.splice(bestIdx, 1)[0];
      if (current === to) break;
      if (visited.has(current)) continue;
      visited.add(current);
      const d = distMap.get(current)!;
      for (const { to: next, length } of this.adjacency.get(current) ?? []) {
        if (visited.has(next)) continue;
        const nd = d + length;
        if (nd < (distMap.get(next) ?? Infinity)) {
          distMap.set(next, nd);
          prev.set(next, current);
          frontier.push(next);
        }
      }
    }
    if (!distMap.has(to)) throw new Error(`No path between ${from} and ${to}`);
    const path: NodeId[] = [to];
    let cur = to;
    while (cur !== from) {
      cur = prev.get(cur)!;
      path.push(cur);
    }
    path.reverse();
    this.pathCache.set(key, path);
    this.distCache.set(key, distMap.get(to)!);
    return path;
  }

  /** Shortest street distance between two nodes. */
  nodeDistance(from: NodeId, to: NodeId): number {
    const key = `${from}>${to}`;
    if (!this.distCache.has(key)) this.pathNodes(from, to);
    return this.distCache.get(key)!;
  }

  /** Street distance between two locations (door to door). */
  locationDistance(a: LocationId, b: LocationId): number {
    return this.nodeDistance(this.location(a).node, this.location(b).node);
  }

  /** Polyline from a point (standing at a location or on the street) to a location's inside position. */
  walkPath(from: Vec2, fromNode: NodeId, to: LocationId, slot = 0): Vec2[] {
    const target = this.location(to);
    const nodes = this.pathNodes(fromNode, target.node);
    const pts: Vec2[] = [from, ...nodes.map((n) => this.nodePos(n)), this.insidePos(to, slot)];
    // Remove consecutive duplicates
    const out: Vec2[] = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || dist(last, p) > 0.01) out.push(p);
    }
    return out;
  }

  /** Nearest street node to an arbitrary point. */
  nearestNode(p: Vec2): NodeId {
    let best: NodeId = '';
    let bestD = Infinity;
    for (const n of this.nodes.values()) {
      const d = dist(n.pos, p);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  /** Bus stops of a line ordered along the route. */
  lineStops(lineId: string): LocationDef[] {
    const line = this.lines.find((l) => l.id === lineId);
    if (!line) throw new Error(`Unknown line ${lineId}`);
    return line.stops.map((s) => this.location(s));
  }

  /** Nearest bus stop (by street distance) to a location. */
  nearestStop(locationId: LocationId, lineId = 'L1'): { stop: LocationDef; distance: number } {
    let best: LocationDef | null = null;
    let bestD = Infinity;
    for (const s of this.lineStops(lineId)) {
      const d = this.locationDistance(locationId, s.id);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { stop: best!, distance: bestD };
  }

  homes(): LocationDef[] {
    return LOCATIONS.filter((l) => l.kind === 'home');
  }
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Point at a given distance along a polyline. */
export function pointAlong(pts: Vec2[], d: number): Vec2 {
  if (pts.length === 0) return { x: 0, y: 0 };
  if (d <= 0) return pts[0];
  let remaining = d;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (remaining <= seg) {
      const f = seg === 0 ? 0 : remaining / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
    remaining -= seg;
  }
  return pts[pts.length - 1];
}

let sharedCity: City | null = null;
/** The city is static data; share one instance (pathfinding caches included). */
export function getCity(): City {
  if (!sharedCity) sharedCity = new City();
  return sharedCity;
}
