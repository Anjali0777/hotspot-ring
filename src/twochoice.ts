import { murmur3 } from "./hash.js";
import { LoadTracker, type Router } from "./router.js";

/**
 * Alternative considered: power of two choices.
 *
 * Hash the key twice to get two candidate nodes and send the request to
 * whichever is less loaded. Famous for cutting the maximum load from
 * O(log n / log log n) to O(log log n) for uniform balls-into-bins.
 *
 *   acquire: O(1)
 *
 * For hot keys it only halves the problem: a key's traffic is still pinned
 * to the same two nodes, so a key with 10% of all requests puts ~5% on each
 * of them, which is still 2.5× a fair share with 50 nodes. It also splits
 * every key across two caches. Kept here as a benchmark comparison.
 */
export class TwoChoice extends LoadTracker implements Router {
  readonly name = "two choices";

  private candidates(key: string): [number, number] {
    const n = this.live.length;
    const a = murmur3(key, 0x9747b28c) % n;
    let b = murmur3(key, 0x5bd1e995) % n;
    if (n > 1 && b === a) b = (b + 1) % n;
    return [this.live[a]!, this.live[b]!];
  }

  home(key: string): number {
    return this.candidates(key)[0];
  }

  acquire(key: string): number {
    const [a, b] = this.candidates(key);
    return this.charge(this.loads[b]! < this.loads[a]! ? b : a);
  }

  addNode(): number {
    return this.addNodeIndex();
  }

  removeNode(node: number): void {
    this.dropNodeIndex(node);
  }
}
