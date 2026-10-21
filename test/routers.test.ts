import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { murmur3 } from "../src/hash.js";
import { ModN } from "../src/modn.js";
import { Ring } from "../src/ring.js";
import type { Router } from "../src/router.js";

export const factories: Record<string, (n: number) => Router> = {
  "mod-n": (n) => new ModN(n),
  ring: (n) => new Ring(n),
};

const keys = (count: number) => Array.from({ length: count }, (_, i) => `obj-${i}`);

describe("murmur3", () => {
  it("matches reference vectors", () => {
    // Reference values from the canonical C implementation (seed 0).
    expect(murmur3("")).toBe(0);
    expect(murmur3("a")).toBe(0x3c2569b2);
    expect(murmur3("abc")).toBe(0xb3dd93fa);
    expect(murmur3("Hello, world!")).toBe(0xc0363e43);
    expect(murmur3("The quick brown fox jumps over the lazy dog")).toBe(0x2e4ff723);
  });
});

for (const [name, make] of Object.entries(factories)) {
  describe(name, () => {
    it("is deterministic and only returns live nodes", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 40 }), fc.array(fc.string(), { maxLength: 200 }), (n, ks) => {
          const r = make(n);
          for (const k of ks) {
            const a = r.home(k);
            expect(r.home(k)).toBe(a);
            expect(r.nodes()).toContain(a);
          }
        }),
      );
    });

    it("tracks load through acquire and release", () => {
      const r = make(5);
      const got = keys(1000).map((k) => r.acquire(k));
      expect(r.nodes().reduce((s, n) => s + r.load(n), 0)).toBe(1000);
      for (const n of got) r.release(n);
      expect(r.nodes().every((n) => r.load(n) === 0)).toBe(true);
      expect(() => r.release(got[0]!)).toThrow();
    });

    it("refuses to remove the last node or an unknown node", () => {
      const r = make(1);
      expect(() => r.removeNode(0)).toThrow();
      expect(() => r.removeNode(42)).toThrow();
    });

    // mod-N spreads distinct keys almost perfectly. A ring's key share per
    // node varies by roughly 1/sqrt(vnodes): with 160 vnodes the busiest node
    // owns ~26% more keys than average. That gap is measured in the benchmark.
    it("spreads uniform keys near the mean", () => {
      const r = make(20);
      const counts = new Map<number, number>();
      for (const k of keys(200_000)) counts.set(r.home(k), (counts.get(r.home(k)) ?? 0) + 1);
      const mean = 200_000 / 20;
      const tolerance = name === "mod-n" ? 0.05 : 0.35;
      expect(counts.size).toBe(20);
      for (const c of counts.values()) expect(Math.abs(c - mean) / mean).toBeLessThan(tolerance);
    });
  });
}

describe("reshuffling when a node leaves", () => {
  const ks = keys(50_000);
  const moved = (r: Router, victim: number) => {
    const before = ks.map((k) => r.home(k));
    r.removeNode(victim);
    const after = ks.map((k) => r.home(k));
    return {
      moved: before.filter((b, i) => b !== after[i]).length / ks.length,
      onlyVictims: before.every((b, i) => b === after[i] || b === victim),
    };
  };

  it("mod-n moves most keys", () => {
    expect(moved(new ModN(20), 7).moved).toBeGreaterThan(0.85);
  });

  it("ring moves only the removed node's keys (~1/N)", () => {
    const res = moved(new Ring(20), 7);
    expect(res.onlyVictims).toBe(true);
    expect(res.moved).toBeLessThan(0.08);
  });

  it("ring property: any removal moves only that node's keys", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), fc.nat(), (n, pick) => {
        const r = new Ring(n, 40);
        const victim = r.nodes()[pick % n]!;
        const sample = keys(2000);
        const before = sample.map((k) => r.home(k));
        r.removeNode(victim);
        sample.forEach((k, i) => {
          if (before[i] !== victim) expect(r.home(k)).toBe(before[i]);
        });
      }),
      { numRuns: 60 },
    );
  });
});
