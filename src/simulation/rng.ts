// Deterministički generator (mulberry32): isti seed i postavke daju isti tijek poslovanja.
export class Rng {
  private state: number;
  constructor(seed: number) { this.state = (seed >>> 0) || 1; }
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number) { return min + (max - min) * this.next(); }
  int(min: number, max: number) { return Math.floor(this.range(min, max + 1)); }
  normal() { const u = 1 - this.next(), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  poisson(lambda: number) {
    if (lambda <= 0) return 0;
    const limit = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > limit);
    return k - 1;
  }
  weighted(weights: readonly number[]) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }
}
