import type { Vec2 } from './types';

export interface Path { pts: Vec2[]; cum: number[]; len: number }

const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.z - a.z);

export function polyline(points: Vec2[]): Path {
  const pts: Vec2[] = [];
  for (const p of points) { const last = pts[pts.length - 1]; if (!last || dist(last, p) > 1e-6) pts.push({ x: p.x, z: p.z }); }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, len: cum[cum.length - 1] };
}

// Kutovi se zaobljuju kvadratnom Bézierovom krivuljom, a put se jednoliko uzorkuje (za kamione).
export function roundedPath(points: Vec2[], radius: number, step = 0.5): Path {
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const d1 = dist(a, b), d2 = dist(b, c);
    const r = Math.min(radius, d1 * (i === 1 ? 0.9 : 0.5), d2 * (i === points.length - 2 ? 0.9 : 0.5));
    const p1 = { x: b.x + (a.x - b.x) / d1 * r, z: b.z + (a.z - b.z) / d1 * r };
    const p2 = { x: b.x + (c.x - b.x) / d2 * r, z: b.z + (c.z - b.z) / d2 * r };
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, u = 1 - t;
      out.push({ x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x, z: u * u * p1.z + 2 * u * t * b.z + t * t * p2.z });
    }
  }
  out.push(points[points.length - 1]);
  const raw = polyline(out);
  const samples: Vec2[] = [];
  const n = Math.max(1, Math.ceil(raw.len / step));
  for (let i = 0; i <= n; i++) samples.push(pointAt(raw, raw.len * i / n));
  return polyline(samples);
}

export function segmentAt(path: Path, s: number) {
  const { cum } = path;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  return lo;
}

export function pointAt(path: Path, s: number): Vec2 {
  if (path.pts.length === 1) return { ...path.pts[0] };
  const clamped = Math.max(0, Math.min(path.len, s));
  const i = Math.min(segmentAt(path, clamped), path.pts.length - 2);
  const a = path.pts[i], b = path.pts[i + 1];
  const seg = path.cum[i + 1] - path.cum[i];
  const t = seg > 0 ? (clamped - path.cum[i]) / seg : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function headingAt(path: Path, s: number) {
  if (path.pts.length < 2) return 0;
  const i = Math.min(segmentAt(path, Math.max(0, Math.min(path.len, s))), path.pts.length - 2);
  const a = path.pts[i], b = path.pts[i + 1];
  return Math.atan2(b.z - a.z, b.x - a.x);
}

export const angleTo = (a: Vec2, b: Vec2) => Math.atan2(b.z - a.z, b.x - a.x);
export function angleDelta(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
