import { murmur3 } from "./hash.js";
import { LoadTracker, type Router } from "./router.js";

/**
 * Baseline 1: hash(key) mod N.
 *
 *   acquire: O(1)    reshuffle on add/remove: ~ (N-1)/N of all keys
 *
 * Spreads distinct keys evenly and is as fast as routing gets. Two problems:
 * changing N remaps almost every key (every cache goes cold at once), and it
 * ignores load entirely, so a hot key sends all of its traffic to one node.
 */
export class ModN extends LoadTracker implements Router {
  readonly name = "mod-n";

  home(key: string): number {
    return this.live[murmur3(key) % this.live.length]!;
  }

  acquire(key: string): number {
    return this.charge(this.home(key));
  }

  addNode(): number {
    return this.addNodeIndex();
  }

  removeNode(node: number): void {
    this.dropNodeIndex(node);
  }
}
