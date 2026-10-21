/** Seeded, reproducible traffic for the benchmarks. */

/** mulberry32: tiny, fast, good-enough PRNG with a 32-bit seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrafficSpec {
  objects: number; // distinct keys
  zipf: number; // skew exponent (0 = uniform)
  hotShare: number; // extra fraction of requests for one single object
  seed: number;
}

/**
 * Samples object keys from a Zipf distribution, optionally with one extra-hot
 * key on top (a viral object, a misbehaving client, a big tenant's index file).
 */
export class Traffic {
  private readonly cdf: Float64Array;
  private readonly next: () => number;
  readonly keys: string[];

  constructor(readonly spec: TrafficSpec) {
    this.next = rng(spec.seed);
    this.keys = Array.from({ length: spec.objects }, (_, i) => `bucket/obj-${i}`);
    const w = new Float64Array(spec.objects);
    let sum = 0;
    for (let i = 0; i < spec.objects; i++) sum += w[i] = 1 / Math.pow(i + 1, spec.zipf);
    this.cdf = new Float64Array(spec.objects);
    let acc = 0;
    for (let i = 0; i < spec.objects; i++) this.cdf[i] = acc += w[i]! / sum;
  }

  /** The key every hot-key request goes to. Deliberately not rank 0. */
  get hotKey(): string {
    return "bucket/viral-object";
  }

  sample(): string {
    if (this.spec.hotShare > 0 && this.next() < this.spec.hotShare) return this.hotKey;
    const u = this.next();
    let lo = 0;
    let hi = this.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cdf[mid]! < u) lo = mid + 1;
      else hi = mid;
    }
    return this.keys[lo]!;
  }

  /** Uniform integer in [0, n), from the same seeded stream. */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
