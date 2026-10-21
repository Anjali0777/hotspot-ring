/**
 * Benchmarks every router on the same seeded traffic.
 *
 *   npm run bench            # full run, writes results/bench.md
 *   npm run bench:quick      # smaller, for a quick look
 *
 * Load model: a fixed number of requests are in flight. Each step one random
 * in-flight request finishes (so durations are memoryless, like an
 * exponential) and a new one arrives with a Zipf-distributed key. After every
 * step we record the busiest node's load. "Peak / mean" is the busiest node
 * divided by the average node — 1.0 is perfect, 2.0 means some node is doing
 * twice its share. Affinity is how often a request for a key lands on the
 * same node as that key's previous request: a stand-in for cache hit rate.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { BoundedRing } from "../src/bounded.js";
import { ModN } from "../src/modn.js";
import { Ring } from "../src/ring.js";
import type { Router } from "../src/router.js";
import { TwoChoice } from "../src/twochoice.js";
import { Traffic, type TrafficSpec } from "./workload.js";

const quick = process.argv.includes("--quick");
const NODES = 50;
const INFLIGHT = quick ? 2_000 : 10_000; // 40 or 200 per node on average
const STEPS = quick ? 100_000 : 1_000_000;
const OBJECTS = 100_000;

type Make = () => Router;
export const routers: Array<[string, Make]> = [
  ["mod-n", () => new ModN(NODES)],
  ["ring (160 vnodes)", () => new Ring(NODES, 160)],
  ["two choices", () => new TwoChoice(NODES)],
  ["bounded ring ε=1.0", () => new BoundedRing(NODES, 1.0)],
  ["bounded ring ε=0.25", () => new BoundedRing(NODES, 0.25)],
  ["bounded ring ε=0.1", () => new BoundedRing(NODES, 0.1)],
];

interface LoadResult {
  peakOverMean: number; // worst moment
  p99PeakOverMean: number; // 99th percentile of the per-step busiest node
  affinity: number;
  meanWalk: number | undefined;
}

function loadRun(make: Make, spec: TrafficSpec): LoadResult {
  const r = make();
  const t = new Traffic(spec);
  const inflight: number[] = [];
  const last = new Map<string, number>();
  let same = 0;
  let repeats = 0;
  const route = (key: string) => {
    const n = r.acquire(key);
    const prev = last.get(key);
    if (prev !== undefined) {
      repeats++;
      if (prev === n) same++;
    }
    last.set(key, n);
    return n;
  };
  for (let i = 0; i < INFLIGHT; i++) inflight.push(route(t.sample()));

  const nodes = r.nodes();
  const mean = INFLIGHT / nodes.length;
  const peaks = new Float64Array(STEPS);
  for (let s = 0; s < STEPS; s++) {
    const i = t.int(inflight.length);
    r.release(inflight[i]!);
    inflight[i] = route(t.sample());
    let max = 0;
    for (const n of nodes) if (r.load(n) > max) max = r.load(n);
    peaks[s] = max / mean;
  }
  peaks.sort();
  return {
    peakOverMean: peaks[peaks.length - 1]!,
    p99PeakOverMean: peaks[Math.floor(peaks.length * 0.99)]!,
    affinity: repeats ? same / repeats : 1,
    meanWalk: r instanceof BoundedRing ? r.meanWalk() : undefined,
  };
}

/** Fraction of requests (traffic-weighted) whose node changes when one node leaves. */
function churn(make: Make, spec: TrafficSpec): number {
  const r = make();
  const t = new Traffic(spec);
  const sample = Array.from({ length: 200_000 }, () => t.sample());
  const before = sample.map((k) => r.home(k));
  r.removeNode(r.nodes()[17]!);
  let moved = 0;
  sample.forEach((k, i) => {
    if (r.home(k) !== before[i]) moved++;
  });
  return moved / sample.length;
}

/** Routing cost: acquire + release pairs per second with a realistic load level. */
function throughput(make: Make, spec: TrafficSpec): { opsPerSec: number; nsPerOp: number } {
  const r = make();
  const t = new Traffic(spec);
  const keys = Array.from({ length: 1 << 16 }, () => t.sample());
  const inflight: number[] = [];
  for (let i = 0; i < INFLIGHT; i++) inflight.push(r.acquire(keys[i & 0xffff]!));
  const n = quick ? 300_000 : 2_000_000;
  for (let i = 0; i < 50_000; i++) r.release(r.acquire(keys[i & 0xffff]!)); // warm up the JIT
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const slot = i % INFLIGHT;
    r.release(inflight[slot]!);
    inflight[slot] = r.acquire(keys[i & 0xffff]!);
  }
  const ms = performance.now() - t0;
  return { opsPerSec: (n / ms) * 1000, nsPerOp: (ms * 1e6) / n };
}

const scenarios: Array<[string, TrafficSpec]> = [
  ["uniform keys", { objects: OBJECTS, zipf: 0, hotShare: 0, seed: 1 }],
  ["Zipf 1.1", { objects: OBJECTS, zipf: 1.1, hotShare: 0, seed: 2 }],
  ["Zipf 1.1 + one key at 10%", { objects: OBJECTS, zipf: 1.1, hotShare: 0.1, seed: 3 }],
];

const lines: string[] = [];
const out = (s = "") => {
  console.log(s);
  lines.push(s);
};

out(`Nodes: ${NODES}, requests in flight: ${INFLIGHT} (${INFLIGHT / NODES}/node), steps: ${STEPS.toLocaleString()}, objects: ${OBJECTS.toLocaleString()}`);
out(`Node ${process.version}, ${quick ? "quick" : "full"} run`);

for (const [label, spec] of scenarios) {
  out(`\n### ${label}\n`);
  out("| router | peak / mean (worst) | peak / mean (p99) | affinity | mean ring steps walked |");
  out("|---|---:|---:|---:|---:|");
  for (const [name, make] of routers) {
    const res = loadRun(make, spec);
    const walk = res.meanWalk === undefined ? "–" : res.meanWalk.toFixed(2);
    out(`| ${name} | ${res.peakOverMean.toFixed(2)} | ${res.p99PeakOverMean.toFixed(2)} | ${(res.affinity * 100).toFixed(1)}% | ${walk} |`);
  }
}

out("\n### Reshuffling and routing cost (Zipf 1.1 + hot key)\n");
out("| router | traffic moved when 1 of 50 nodes leaves | ns per acquire+release | ops/s |");
out("|---|---:|---:|---:|");
for (const [name, make] of routers) {
  const spec = scenarios[2]![1];
  const tp = throughput(make, spec);
  out(`| ${name} | ${(churn(make, spec) * 100).toFixed(1)}% | ${tp.nsPerOp.toFixed(0)} | ${Math.round(tp.opsPerSec).toLocaleString()} |`);
}

if (!quick) {
  mkdirSync("results", { recursive: true });
  writeFileSync("results/bench.md", lines.join("\n") + "\n");
  console.log("\nWrote results/bench.md");
}
