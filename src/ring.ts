import { murmur3 } from "./hash.js";
import { LoadTracker, type Router } from "./router.js";

/**
 * Baseline 2: a consistent-hash ring with virtual nodes.
 *
 * Each node is placed on a 32-bit ring at `vnodes` pseudo-random points. A
 * key goes to the first point clockwise from hash(key).
 *
 *   acquire: O(log(N·V)) binary search     reshuffle on add/remove: ~1/N of keys
 *   space:   O(N·V)
 *
 * This fixes mod-N's reshuffling, which is why it is the textbook answer.
 * It still ignores load: a hot key lives on exactly one node, and that node
 * takes every request for it no matter how busy it is.
 */
export class Ring extends LoadTracker implements Router {
  readonly name: string = "ring";
  protected points = new Uint32Array(0); // sorted ring positions
  protected owners = new Int32Array(0); // owners[i] = node at points[i]

  constructor(
    n: number,
    protected readonly vnodes = 160,
  ) {
    super(0);
    for (let i = 0; i < n; i++) this.addNode();
  }

  /** Index of the first ring point at or after `h`, wrapping to 0. */
  protected successor(h: number): number {
    const p = this.points;
    let lo = 0;
    let hi = p.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (p[mid]! < h) lo = mid + 1;
      else hi = mid;
    }
    return lo === p.length ? 0 : lo;
  }

  home(key: string): number {
    return this.owners[this.successor(murmur3(key))]!;
  }

  acquire(key: string): number {
    return this.charge(this.home(key));
  }

  addNode(): number {
    const id = this.addNodeIndex();
    const merged: Array<[number, number]> = [];
    for (let i = 0; i < this.points.length; i++) merged.push([this.points[i]!, this.owners[i]!]);
    for (let v = 0; v < this.vnodes; v++) merged.push([murmur3(`node-${id}#${v}`), id]);
    merged.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.points = Uint32Array.from(merged, (m) => m[0]);
    this.owners = Int32Array.from(merged, (m) => m[1]);
    return id;
  }

  removeNode(node: number): void {
    this.dropNodeIndex(node);
    const keep: number[] = [];
    for (let i = 0; i < this.owners.length; i++) if (this.owners[i] !== node) keep.push(i);
    this.points = Uint32Array.from(keep, (i) => this.points[i]!);
    this.owners = Int32Array.from(keep, (i) => this.owners[i]!);
  }
}
