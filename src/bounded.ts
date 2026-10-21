import { murmur3 } from "./hash.js";
import { Ring } from "./ring.js";
import type { Router } from "./router.js";

/**
 * Consistent hashing with bounded loads (Mirrokni, Thorup & Zadimoghaddam, 2018).
 *
 * Same ring as the baseline, plus one rule: no node may carry more than
 *
 *     cap = ceil((1 + ε) · (inflight + 1) / N)
 *
 * requests. A key still starts at its home position. If the node there is at
 * the cap, the request walks clockwise to the next distinct node that isn't.
 * Hot keys overflow onto their ring neighbours instead of crushing one node,
 * and every other key keeps its home.
 *
 *   acquire: O(log(N·V)) search + a short walk. The walk is O(1/ε²) expected
 *            with the paper's analysis; measured here, see the benchmark.
 *   peak load guaranteed ≤ cap, i.e. ≤ (1+ε) × mean (+1 for rounding)
 *   reshuffle on add/remove: same as the ring for keys whose home is not full
 *
 * ε trades balance for affinity: small ε means tight balance but more
 * requests leave their home node (colder caches); large ε is close to a plain ring.
 */
export class BoundedRing extends Ring implements Router {
  override readonly name: string;
  private walked = 0;
  private acquires = 0;

  constructor(
    n: number,
    readonly epsilon = 0.25,
    vnodes = 160,
  ) {
    super(n, vnodes);
    if (!(epsilon > 0)) throw new Error("epsilon must be > 0");
    this.name = `bounded (ε=${epsilon})`;
  }

  /** Current per-node capacity, counting the request about to be placed. */
  capacity(): number {
    return Math.ceil(((1 + this.epsilon) * (this.total + 1)) / this.live.length);
  }

  override acquire(key: string): number {
    const cap = this.capacity();
    const start = this.successor(murmur3(key));
    const len = this.owners.length;
    // Walk at most one full lap; a node can appear many times on the ring
    // (once per vnode), so remember which nodes were already found full.
    let full: Set<number> | undefined;
    for (let step = 0; step < len; step++) {
      const node = this.owners[(start + step) % len]!;
      if (this.loads[node]! < cap) {
        this.walked += step;
        this.acquires++;
        return this.charge(node);
      }
      (full ??= new Set()).add(node);
      if (full.size === this.live.length) break;
    }
    // Unreachable: cap ≥ ceil(mean) + something, so some node is below it.
    throw new Error("bounded ring: every node is at capacity");
  }

  /** Average ring positions skipped per acquire (0 = always served at home). */
  meanWalk(): number {
    return this.acquires ? this.walked / this.acquires : 0;
  }
}
