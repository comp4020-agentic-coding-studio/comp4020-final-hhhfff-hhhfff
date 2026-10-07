// Builds public/streets.json, the street map behind the store map, from
// OpenStreetMap. Run by hand when the map should be redrawn; the app never
// fetches map data itself (see server/stores.ts), it serves this file.
//
//   node scripts/streets.ts [cache-dir]
//
// Raw Overpass answers are kept in cache-dir (default .osm-cache, ignored by
// git), so a rerun that only changes the drawing doesn't ask Overpass again.
// The data is © OpenStreetMap contributors, under the ODbL; the page credits it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ANU, Civic, Braddon, O'Connor, Ainslie, Dickson, Lyneham: every store with room around it
const BOX = { south: -35.2935, west: 149.114, north: -35.2465, east: 149.1585 };
const LAT_REF = -35.2777; // ANU; the page projects the stores with the same numbers
const WIDTH = 2000; // map units across, about 2 m each
const TOLERANCE = 0.8; // units a simplified line may stray from the real one

const box = `(${BOX.south},${BOX.west},${BOX.north},${BOX.east})`;
const QUERIES: Record<string, string> = {
  roads: `way[highway]${box};`,
  green: `way[natural=water]${box};relation[natural=water]${box};way[leisure~"park|pitch|golf_course|nature_reserve|garden"]${box};way[landuse~"grass|forest|recreation_ground|meadow|cemetery"]${box};way[natural~"wood|grassland"]${box};`,
  buildings: `way[building]${box};`,
};
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

interface LatLon {
  lat: number;
  lon: number;
}
interface Element {
  type: string;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: { role: string; geometry?: LatLon[] }[];
}

async function overpass(name: string, cache: string): Promise<Element[]> {
  const file = join(cache, `${name}.json`);
  if (!existsSync(file)) {
    const body = new URLSearchParams({ data: `[out:json][timeout:150];(${QUERIES[name]});out geom qt;` });
    let text = "";
    for (let attempt = 0; attempt < 6 && !text.startsWith("{"); attempt++) {
      const res = await fetch(MIRRORS[attempt % MIRRORS.length], {
        method: "POST",
        body,
        headers: { "user-agent": "discountShow-streets/1.0 (one-off map build)", accept: "application/json" },
      }).catch(() => null);
      text = res ? await res.text() : "";
      if (!text.startsWith("{")) await new Promise((r) => setTimeout(r, 8000));
    }
    if (!text.startsWith("{")) throw new Error(`Overpass would not answer for ${name}; try again later`);
    writeFileSync(file, text);
  }
  return JSON.parse(readFileSync(file, "utf8")).elements;
}

// --- projection: the page uses the same, so stores land on their streets

const cos = Math.cos((LAT_REF * Math.PI) / 180);
const scale = WIDTH / ((BOX.east - BOX.west) * cos); // units per degree of latitude
const HEIGHT = Math.round((BOX.north - BOX.south) * scale);
type Pt = [number, number];
const project = (p: LatLon): Pt => [(p.lon - BOX.west) * cos * scale, (BOX.north - p.lat) * scale];

// --- geometry

function simplify(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let far = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > far) [far, at] = [d, i];
    }
    if (far > TOLERANCE) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// A closed ring starts and ends on the same point, which the line version
// can't measure from: split it at the point farthest from the start.
function simplifyRing(pts: Pt[]): Pt[] {
  let far = 0;
  let at = 0;
  pts.forEach((p, i) => {
    const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    if (d > far) [far, at] = [d, i];
  });
  if (!at) return pts;
  return [...simplify(pts.slice(0, at + 1)), ...simplify(pts.slice(at)).slice(1)];
}

// Polygons are cut to the map (with a margin), so the lake doesn't carry its
// whole shore along; Sutherland–Hodgman against each edge of the box.
const M = 20;
function clipPolygon(pts: Pt[]): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= -M, (a, b) => cut(a, b, 0, -M)],
    [(p) => p[0] <= WIDTH + M, (a, b) => cut(a, b, 0, WIDTH + M)],
    [(p) => p[1] >= -M, (a, b) => cut(a, b, 1, -M)],
    [(p) => p[1] <= HEIGHT + M, (a, b) => cut(a, b, 1, HEIGHT + M)],
  ];
  let out = pts;
  for (const [inside, meet] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const [cur, prev] = [src[i], src[(i + src.length - 1) % src.length]];
      if (inside(cur)) {
        if (!inside(prev)) out.push(meet(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(meet(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
function cut(a: Pt, b: Pt, axis: 0 | 1, v: number): Pt {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Lines keep only the runs that come near the map.
const near = (p: Pt) => p[0] >= -M && p[0] <= WIDTH + M && p[1] >= -M && p[1] <= HEIGHT + M;
function clipLine(pts: Pt[]): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  pts.forEach((p, i) => {
    if (near(p) || (i > 0 && near(pts[i - 1])) || (i < pts.length - 1 && near(pts[i + 1]))) run.push(p);
    else if (run.length) runs.push(run), (run = []);
  });
  if (run.length > 1) runs.push(run);
  return runs.filter((r) => r.length > 1);
}

function area(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

// A multipolygon's outer ways, joined end to end into closed rings.
function rings(ways: LatLon[][]): LatLon[][] {
  const left = ways.map((w) => [...w]);
  const out: LatLon[][] = [];
  const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;
  while (left.length) {
    const ring = left.shift()!;
    for (let grew = true; grew && !same(ring[0], ring.at(-1)!); ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const w = left[i];
        if (same(ring.at(-1)!, w[0])) ring.push(...w.slice(1));
        else if (same(ring.at(-1)!, w.at(-1)!)) ring.push(...w.reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(ring);
  }
  return out;
}

// SVG path data in whole units, relative moves after the first: short to send.
function pathData(shapes: Pt[][], closed: boolean): string {
  let d = "";
  for (const shape of shapes) {
    const pts = shape.map(([x, y]) => [Math.round(x), Math.round(y)] as Pt).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    if (pts.length < (closed ? 3 : 2)) continue;
    d += `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) d += `l${pts[i][0] - pts[i - 1][0]} ${pts[i][1] - pts[i - 1][1]}`;
    if (closed) d += "z";
  }
  return d.replace(/ -/g, "-").replace(/l(-?\d+) (-?\d+)/g, (m, a, b) => `l${a}${b.startsWith("-") ? "" : " "}${b}`);
}

// --- layers

const ROAD_CLASS: Record<string, string> = {
  motorway: "major", trunk: "major", primary: "major", motorway_link: "major", trunk_link: "major", primary_link: "major",
  secondary: "mid", tertiary: "mid", secondary_link: "mid", tertiary_link: "mid",
  residential: "minor", unclassified: "minor", living_street: "minor", road: "minor",
  service: "service",
  footway: "path", path: "path", cycleway: "path", pedestrian: "path", steps: "path", track: "path", bridleway: "path",
};
const SHEDS = new Set(["garage", "garages", "shed", "carport", "roof", "hut", "container", "kiosk"]);

const cache = process.argv[2] ?? ".osm-cache";
mkdirSync(cache, { recursive: true });
const [roads, green, buildings] = [await overpass("roads", cache), await overpass("green", cache), await overpass("buildings", cache)];

const shapes: Record<string, Pt[][]> = { water: [], green: [], buildings: [], major: [], mid: [], minor: [], service: [], path: [] };
interface Stretch {
  name: string;
  rank: number;
  pts: Pt[];
  len: number;
  mid: Pt;
}
const stretches: Stretch[] = [];
const LABEL_MIN = 45; // units of nearly straight road a label needs
const LABEL_GAP = 300; // units between two labels of the same road
const namedRuns = new Map<string, { rank: number; runs: Pt[][] }>();

// OpenStreetMap splits a street at most junctions; its pieces are joined end
// to end again so a label has the whole street to sit on.
function joinRuns(runs: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const left = runs.map((r) => [...r]);
  const out: Pt[][] = [];
  while (left.length) {
    const line = left.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const r = left[i];
        if (key(line.at(-1)!) === key(r[0])) line.push(...r.slice(1));
        else if (key(line.at(-1)!) === key(r.at(-1)!)) line.push(...[...r].reverse().slice(1));
        else if (key(line[0]) === key(r.at(-1)!)) line.unshift(...r.slice(0, -1));
        else if (key(line[0]) === key(r[0])) line.unshift(...[...r].reverse().slice(0, -1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(line);
  }
  return out;
}

// A road's nearly straight stretches: where it turns more than ~25°, a new one starts.
function straightStretches(pts: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    cur.push(pts[i]);
    if (i < pts.length - 1) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      const turn = Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (turn > 0.45) {
        out.push(cur);
        cur = [pts[i]];
      }
    }
  }
  out.push(cur);
  return out.filter((p) => p.length > 1);
}
// A long straight road is cut into pieces of about `size` units, so a label
// can sit anywhere along it rather than only at its middle.
function pieces(pts: Pt[], size: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [pts[0]];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    let [a, b] = [pts[i - 1], pts[i]];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (run + seg > size) {
      const t = (size - run) / seg;
      const cutAt: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      cur.push(cutAt);
      out.push(cur);
      cur = [cutAt];
      a = cutAt;
      seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      run = 0;
    }
    cur.push(b);
    run += seg;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
const lengthOf = (pts: Pt[]) => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

for (const e of roads) {
  const cls = ROAD_CLASS[e.tags?.highway ?? ""];
  if (!cls || !e.geometry || e.tags?.area === "yes") continue;
  // sidewalks and crossings double the streets they run beside; driveways and car-park aisles are noise
  if (e.tags?.footway === "sidewalk" || e.tags?.footway === "crossing" || e.tags?.cycleway === "crossing") continue;
  if (cls === "service" && ["driveway", "parking_aisle", "drive-through"].includes(e.tags?.service ?? "")) continue;
  for (const run of clipLine(e.geometry.map(project))) {
    const pts = simplify(run);
    shapes[cls].push(pts);
    const name = e.tags?.name;
    const rank = { major: 1, mid: 1, minor: 2 }[cls as "major"];
    if (!name || !rank) continue;
    const entry = namedRuns.get(name) ?? { rank, runs: [] };
    entry.rank = Math.min(entry.rank, rank);
    entry.runs.push(pts);
    namedRuns.set(name, entry);
  }
}

for (const [name, { rank, runs }] of namedRuns) {
  for (const line of joinRuns(runs)) {
    for (const piece of straightStretches(line).flatMap((p) => pieces(p, 220))) {
      const len = lengthOf(piece);
      const mid: Pt = [(piece[0][0] + piece.at(-1)![0]) / 2, (piece[0][1] + piece.at(-1)![1]) / 2];
      if (len >= LABEL_MIN && mid[0] > 0 && mid[0] < WIDTH && mid[1] > 0 && mid[1] < HEIGHT) stretches.push({ name, rank, pts: piece, len, mid });
    }
  }
}

for (const e of green) {
  const t = e.tags ?? {};
  const layer = t.natural === "water" ? "water" : "green";
  const outer =
    e.type === "relation" ? rings((e.members ?? []).filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry!)) : [e.geometry ?? []];
  for (const ring of outer) {
    const pts = clipPolygon(simplifyRing(ring.map(project)));
    if (pts.length > 2 && area(pts) > 40) shapes[layer].push(pts);
  }
}

for (const e of buildings) {
  if (SHEDS.has(e.tags?.building ?? "") || !e.geometry) continue;
  const pts = simplifyRing(e.geometry.map(project));
  if (pts.length > 2 && area(pts) > 8 && pts.some(near)) shapes.buildings.push(pts.slice(0, -1));
}

// Each road is labelled along its way, on its longest stretches first, with
// room between labels of the same name; the page shows the ones that fit.
const placed = new Map<string, Pt[]>();
const labels = stretches
  .sort((a, b) => b.len - a.len)
  .filter((l) => {
    const near = placed.get(l.name) ?? [];
    if (near.some((p) => Math.hypot(p[0] - l.mid[0], p[1] - l.mid[1]) < LABEL_GAP)) return false;
    placed.set(l.name, [...near, l.mid]);
    return true;
  })
  .map((l) => {
    // read left to right, whichever way the road was drawn
    const pts = l.pts[0][0] <= l.pts.at(-1)![0] ? l.pts : [...l.pts].reverse();
    return { name: l.name, rank: l.rank, d: pathData([pts], false) };
  });

const out = {
  attribution: "© OpenStreetMap contributors (ODbL)",
  box: BOX,
  latRef: LAT_REF,
  scale: Math.round(scale * 1000) / 1000,
  width: WIDTH,
  height: HEIGHT,
  layers: Object.fromEntries(
    Object.entries(shapes).map(([k, v]) => [k, pathData(v, ["water", "green", "buildings"].includes(k))]),
  ),
  labels,
};
writeFileSync("public/streets.json", JSON.stringify(out));
const sizes = Object.entries(out.layers).map(([k, v]) => `${k} ${Math.round(v.length / 1024)}K`);
console.log(`public/streets.json: ${Math.round(JSON.stringify(out).length / 1024)} KB (${sizes.join(", ")}, ${labels.length} labels)`);
