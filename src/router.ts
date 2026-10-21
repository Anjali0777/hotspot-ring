/**
 * A Router decides which backend node serves a request for a key.
 *
 * Every router tracks live load (requests in flight per node), because the
 * question this project asks is not only "is the key space spread evenly?"
 * but "does any single node get overwhelmed when traffic is skewed?".
 */
export interface Router {
  readonly name: string;
  /** Pick a node for `key` and count the request against it. */
  acquire(key: string): number;
  /** The request routed to `node` has finished. */
  release(node: number): void;
  /** Nodes currently in service, by index. */
  nodes(): readonly number[];
  addNode(): number;
  removeNode(node: number): void;
  /** Where the key would go with no load at all (for churn measurements). */
  home(key: string): number;
  load(node: number): number;
}

/** Shared bookkeeping for live load. */
export abstract class LoadTracker {
  protected loads: number[] = [];
  protected live: number[] = [];
  protected total = 0;

  constructor(n: number) {
    for (let i = 0; i < n; i++) this.addNodeIndex();
  }

  protected addNodeIndex(): number {
    const id = this.loads.length;
    this.loads.push(0);
    this.live.push(id);
    return id;
  }

  protected dropNodeIndex(node: number): void {
    const i = this.live.indexOf(node);
    if (i < 0) throw new Error(`node ${node} is not in service`);
    if (this.live.length === 1) throw new Error("cannot remove the last node");
    this.live.splice(i, 1);
  }

  protected charge(node: number): number {
    this.loads[node]!++;
    this.total++;
    return node;
  }

  release(node: number): void {
    if ((this.loads[node] ?? 0) <= 0) throw new Error(`release on idle node ${node}`);
    this.loads[node]!--;
    this.total--;
  }

  load(node: number): number {
    return this.loads[node] ?? 0;
  }

  nodes(): readonly number[] {
    return this.live;
  }
}
