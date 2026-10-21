# Design: Hotspot Ring

## Problem

A storage service spreads objects across backend nodes. A routing layer decides which node serves each request. Three things matter, and they pull against each other:

1. **Balance.** No node should carry much more than its share of live requests. A node that runs out of CPU, memory or connections fails its requests and slows everything queued behind it.
2. **Affinity.** Requests for the same object should keep landing on the same node, so its cache, open file handles and metadata stay warm.
3. **Stability.** When a node is added, removed or fails, as little traffic as possible should move.

Real traffic is skewed. Object popularity is roughly Zipf-shaped, and every so often one object gets a large share of all requests: a viral file, a hot index, one client in a retry loop. Google's preliminary report on its 8 October 2026 Cloud Storage incident in us-central1 described resource exhaustion on specific backend storage nodes. I don't know how Google routes traffic. This project asks the general question: how do you route so that skew can't concentrate on one node?

## Constraints

- Peak node load should stay within a small, *guaranteed* factor of the mean, whatever the key distribution.
- Affinity should be kept for everything that isn't hot.
- When 1 of N nodes leaves, about 1/N of the traffic should move.
- Routing has to be cheap: it's on every request.
- Live load is available. The router sees acquire and release, the way a proxy or load balancer does.

## Approaches considered

| Approach | Balance under skew | Affinity | Traffic moved when 1 of 50 nodes leaves | Verdict |
|---|---|---|---|---|
| **hash mod N** | None. A hot key's node takes all of it: 7.8× mean at Zipf 1.1 | 100% | 98.8% | Baseline |
| **Consistent-hash ring** (160 vnodes) | None, and key share already varies about ±40% by node | 100% | 1.4% | Baseline, and the textbook answer |
| **Power of two choices** | Halves the problem: 3.7× at Zipf 1.1 | 72%, because every key is split across two caches | 98.4% (mod-based) | Rejected |
| **Least-loaded / random spraying** | Excellent | ~1/N | n/a | Rejected: no affinity at all |
| **Replicate hot keys** (detect, then fan out to R nodes) | Good, once detected | Good | 1.4% | Complementary. It needs detection and a choice of R, and reacts late to sudden hotspots |
| **Ring with bounded loads** | Guaranteed ≤ ⌈(1+ε)·mean⌉ | 57–100%, depending on ε and skew | 1.4% | **Chosen** |

## Decision: consistent hashing with bounded loads

From Mirrokni, Thorup and Zadimoghaddam, *Consistent Hashing with Bounded Loads* (SODA 2018); Vimeo and Google have both written about running it in production.

- Keep the ring, so stability and affinity come from it.
- Add one rule: no node may hold more than `cap = ceil((1+ε)·(inflight+1)/N)` live requests.
- A request starts at its key's home position. If that node is at the cap, it moves clockwise to the next distinct node below the cap.
- Overflow goes to the key's ring neighbours, which are the same neighbours every time. So a hot key's caches warm up on a small, stable set of nodes instead of being sprayed everywhere.

## Measurements

These are from `results/bench.md`: 50 nodes, 10,000 requests in flight (200 per node), 1M steps, Node 22.

| Traffic | Ring peak / mean | Bounded ε=0.25 peak / mean | Bounded ε=0.25 affinity | Mean ring steps walked |
|---|---:|---:|---:|---:|
| Uniform keys | 1.43 | 1.25 | 99.8% | 0.00 |
| Zipf 1.1 | 8.30 | 1.25 | 65.0% | 0.93 |
| Zipf 1.1 + one key at 10% | 7.54 | 1.25 | 60.3% | 1.08 |

- The cap is hit exactly. Peak load is always ⌈(1+ε)·mean⌉ under skew, which is what the theory promises.
- Even with uniform keys, the plain ring's busiest node runs at 1.43× mean. That is virtual-node variance, and the bound removes it at almost no cost to affinity (99.8%).
- The walk stays short: about one ring step on average under heavy skew.
- Routing cost is about the same as the plain ring, 1.3–1.4 µs per acquire+release in this harness. Most of that is the hash: UTF-8 encoding a string key in JavaScript.

## Tradeoffs accepted

- **Affinity drops under skew.** At Zipf 1.1 with ε=0.25, about 35% of requests are served by a different node than the key's previous request. Nearly all of these are the hot keys, which is the point: their traffic has to spread to stay under the cap. ε is the dial:
  - ε=1.0 keeps 82% affinity with peak 2.0× mean.
  - ε=0.1 gives 1.1× peak at 57% affinity.
  - I'd default to 0.25 and tune on real cache hit-rate data.
- **The bound counts requests, not bytes or CPU.** A request for a 5 GB object and one for a 1 KB object count the same. The fix is to charge each request a weight (an expected cost) instead of 1. The algorithm is unchanged, and the cap becomes `(1+ε)·totalWeight/N`.
- **It needs live load.** A stateless client-side hash can't do this; the router has to see completions. In a fleet of routers, each one can enforce the bound on its own view of load, at the cost of some slack (see scale below).
- **Overflow follows ring order.** Spilling to the next distinct clockwise node means a hot key's neighbours absorb its excess. With 160 vnodes per node, those neighbours differ per key, so the extra load isn't concentrated on one victim. A pathological set of hot keys sharing a ring arc could still push a few nodes to the cap together; they stay at the cap and never above it.

## Failure modes

| Failure | Behaviour |
|---|---|
| Node dies with requests in flight | Its requests fail upstream and are retried. The router removes the node, and only keys whose home was that node move (1.4% of traffic at N=50) |
| Every node at the cap | Impossible by construction: the cap is at least ⌈mean⌉+1, so some node is below it. The code still throws rather than looping, in case of a bookkeeping bug |
| `release` called twice or for an idle node | Throws, so accounting bugs surface instead of slowly corrupting the bound |
| Retry storm on one key | Exactly what the bound absorbs: the storm spreads to neighbours at the cap instead of taking down one node |
| ε misconfigured to ≤ 0 | Rejected at construction |

## At 10× and 100× scale

- **10× (500 nodes, multiple router instances):** each router enforces the bound on its own in-flight count. With R routers, each sees about 1/R of the traffic, so the true per-node load can exceed the cap by up to about R× its own slack. Two options:
  - Give each router a local ε so the global bound still holds.
  - Gossip approximate per-node load every few hundred milliseconds.
  
  Ring lookup is O(log(N·V)) and doesn't grow meaningfully.
- **100× (thousands of nodes, global traffic):** route in two levels, a ring of zones and a bounded ring inside each zone, so a hotspot spills within a zone before crossing regions. Pair it with hot-key replication, since the bound protects nodes but very hot objects should also be cached at the edge. Weighting requests by cost becomes essential at that scale.
- **Cost of hashing:** at high request rates in a JS proxy, hashing the key's bytes directly from the request buffer would avoid the string-to-UTF-8 step, which dominates routing time here.
