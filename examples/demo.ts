/**
 * npm run demo
 *
 * 8 storage nodes, 4,000 requests in flight, and one object that suddenly
 * gets 30% of all traffic. Prints each node's load as a bar for the plain
 * ring and for the bounded ring.
 */
import { BoundedRing } from "../src/bounded.js";
import { Ring } from "../src/ring.js";
import type { Router } from "../src/router.js";
import { rng } from "../bench/workload.js";

function show(r: Router) {
  const rand = rng(7);
  for (let i = 0; i < 4000; i++) {
    const key = rand() < 0.3 ? "bucket/viral-video.mp4" : `bucket/obj-${Math.floor(rand() * 50_000)}`;
    r.acquire(key);
  }
  const mean = 4000 / r.nodes().length;
  console.log(`\n${r.name}`);
  for (const n of r.nodes()) {
    const l = r.load(n);
    console.log(`  node ${n}  ${"█".repeat(Math.min(56, Math.round(l / 30))).padEnd(56)} ${String(l).padStart(5)}  (${(l / mean).toFixed(2)}× mean)`);
  }
}

show(new Ring(8));
show(new BoundedRing(8, 0.25));
