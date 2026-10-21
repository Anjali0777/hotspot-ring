import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BoundedRing } from "../src/bounded.js";
import { Ring } from "../src/ring.js";
import { TwoChoice } from "../src/twochoice.js";

describe("bounded-load ring", () => {
  it("never lets a node exceed the cap, under any sequence of operations", () => {
    // Random interleavings of acquire (with skewed keys), release, and node
    // churn. After every step: each node's load ≤ cap computed at that step.
    const op = fc.oneof(
      { weight: 6, arbitrary: fc.record({ t: fc.constant("acq" as const), k: fc.integer({ min: 0, max: 30 }) }) },
      { weight: 3, arbitrary: fc.record({ t: fc.constant("rel" as const), i: fc.nat() }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant("add" as const) }) },
      { weight: 1, arbitrary: fc.record({ t: fc.constant("del" as const), i: fc.nat() }) },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.double({ min: 0.01, max: 2, noNaN: true }),
        fc.array(op, { maxLength: 300 }),
        (n, eps, ops) => {
          const r = new BoundedRing(n, eps, 20);
          const inflight: number[] = [];
          for (const o of ops) {
            if (o.t === "acq") {
              // Zipf-ish: low key numbers dominate, so hot keys really happen.
              const cap = r.capacity();
              const node = r.acquire(`k${Math.floor(o.k * o.k / 30)}`);
              expect(r.load(node)).toBeLessThanOrEqual(cap);
              expect(r.nodes()).toContain(node);
              inflight.push(node);
            } else if (o.t === "rel" && inflight.length) {
              const [node] = inflight.splice(o.i % inflight.length, 1);
              if (r.nodes().includes(node!)) r.release(node!);
            } else if (o.t === "add") {
              r.addNode();
            } else if (o.t === "del" && r.nodes().length > 1) {
              // Only remove idle nodes, as a drained node would be in practice.
              const idle = r.nodes().filter((x) => r.load(x) === 0);
              if (idle.length) r.removeNode(idle[o.i % idle.length]!);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("matches the plain ring when nothing is near capacity", () => {
    const plain = new Ring(30);
    const bounded = new BoundedRing(30, 1.0);
    for (let i = 0; i < 2000; i++) {
      const k = `obj-${i}`;
      expect(bounded.acquire(k)).toBe(plain.home(k));
      bounded.release(plain.home(k));
    }
  });

  it("spreads one hot key across neighbours instead of one node", () => {
    const r = new BoundedRing(10, 0.25);
    const used = new Set<number>();
    for (let i = 0; i < 1000; i++) used.add(r.acquire("viral"));
    const loads = r.nodes().map((n) => r.load(n));
    const cap = Math.ceil((1.25 * 1000) / 10); // 125
    expect(Math.max(...loads)).toBeLessThanOrEqual(cap);
    // It fills nodes up to the cap one after another: 1000 / 125 = 8 nodes.
    expect(used.size).toBe(Math.ceil(1000 / cap));
    // The plain ring sends all 1000 to one node.
    const plain = new Ring(10);
    for (let i = 0; i < 1000; i++) plain.acquire("viral");
    expect(Math.max(...plain.nodes().map((n) => plain.load(n)))).toBe(1000);
  });

  it("rejects a non-positive epsilon", () => {
    expect(() => new BoundedRing(3, 0)).toThrow();
    expect(() => new BoundedRing(3, -1)).toThrow();
  });

  it("works with a single node", () => {
    const r = new BoundedRing(1, 0.1);
    for (let i = 0; i < 50; i++) expect(r.acquire(`k${i}`)).toBe(0);
  });
});

describe("two choices", () => {
  it("picks the less-loaded of its two candidates", () => {
    const r = new TwoChoice(8);
    const first = r.acquire("x");
    const second = r.acquire("x");
    expect(second).not.toBe(first);
    expect(r.acquire("x")).toBe(first); // tie again → first candidate
  });

  it("still pins a hot key to two nodes", () => {
    const r = new TwoChoice(10);
    for (let i = 0; i < 1000; i++) r.acquire("viral");
    const busy = r.nodes().filter((n) => r.load(n) > 0);
    expect(busy.length).toBe(2);
  });
});
