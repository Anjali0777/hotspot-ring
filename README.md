# Hotspot Ring

> Consistent hashing with bounded loads in TypeScript: routes keys to backend nodes so no node is overwhelmed by hot keys, while keeping cache affinity and minimal reshuffling.

## What happened

On **8 October 2026**, Google Cloud Storage in us-central1 had about 12 hours of elevated latency and failures on uploads and writes. Some reads were affected too. According to Google's preliminary report, as summarised by [IncidentHub](https://blog.incidenthub.cloud/2026-10-12-google-cloud-storage-outage-oct-8-2026):

- A traffic-sorting optimization meant to relieve local capacity constraints **caused severe resource exhaustion on specific backend storage nodes**.
- A separate database issue added metadata errors.
- Downstream services including Temporal, Elastic Cloud and Mixpanel reported their own outages citing it ([Temporal status](https://status.temporal.io/)).

I don't know how Google routes storage traffic, so this isn't a reconstruction. It's a look at the general problem that report points to: **how do you route requests so that skewed traffic can't pile onto a few nodes?**

## The engineering problem

A router sends each request for an object to one of N backend nodes. It needs three things that pull against each other:

1. **Balance.** No node should carry much more than its share of live requests.
2. **Affinity.** The same object should keep hitting the same node, so caches stay warm.
3. **Stability.** When a node leaves, only about 1/N of the traffic should move.

Real traffic is skewed: object popularity follows roughly a Zipf distribution, and sometimes one object gets 10%+ of all requests. The textbook answers handle (2) and (3) well, but under skew they put one node at **7–8× its fair share**.

## Architecture

```
 request(key) ──► murmur3(key) ──► binary search on the ring (N nodes × 160 vnodes)
                                          │
                                          ▼
                              home node below cap?  ── yes ──► serve there (affinity kept)
                                          │ no
                                          ▼
                      walk clockwise to the next distinct node below cap
                      cap = ceil((1 + ε) · (in-flight + 1) / N)

 release(node) ──► load[node]--
```

| File | What it is |
|---|---|
| `src/modn.ts` | Baseline 1: `hash(key) % N` |
| `src/ring.ts` | Baseline 2: consistent-hash ring with virtual nodes |
| `src/twochoice.ts` | Alternative: power of two choices |
| `src/bounded.ts` | **The improved design: ring with a load cap and clockwise overflow** |
| `bench/` | Seeded Zipf workload and the benchmark harness |
| `test/` | Property tests (fast-check) and unit tests |
| `examples/demo.ts` | One viral object on 8 nodes, shown as load bars |

Why this design, the rejected alternatives, failure modes and the plan at 10× and 100× scale are in **[DESIGN.md](DESIGN.md)**.

## Run it

```bash
npm install
npm test             # 19 tests, including property tests
npm run demo         # one viral object, ring vs bounded ring
npm run bench        # full benchmark (~1 min), writes results/bench.md
```

Requires Node 20 or newer. Dev dependencies only: TypeScript, tsx, Vitest, fast-check.

## Demo output

```
ring
  node 4  ███████████                                                344  (0.69× mean)
  node 5  ██████████████████████████████████████████████████████    1610  (3.22× mean)
  node 6  ███████████                                                318  (0.64× mean)

bounded (ε=0.25)
  node 2  █████████████████████                                      624  (1.25× mean)
  node 4  █████████████████████                                      625  (1.25× mean)
  node 5  █████████████████████                                      625  (1.25× mean)
```

## Results

The full run (`results/bench.md`) uses 50 nodes, 10,000 requests in flight (200 per node), 1M steps, 100k objects, and Node 22 on a 2-vCPU container.

- **Peak / mean** is the busiest node's load divided by the average. 1.0 is perfect.
- **Affinity** is how often a key's request lands on the same node as that key's previous request.

**Zipf 1.1 traffic:**

| router | peak / mean (worst) | peak / mean (p99) | affinity | ring steps walked |
|---|---:|---:|---:|---:|
| mod-n | 7.81 | 7.61 | 100.0% | – |
| ring (160 vnodes) | 8.30 | 8.06 | 100.0% | – |
| two choices | 3.66 | 3.58 | 71.8% | – |
| bounded ring ε=1.0 | 2.00 | 2.00 | 81.7% | 0.37 |
| **bounded ring ε=0.25** | **1.25** | **1.25** | 65.0% | 0.93 |
| bounded ring ε=0.1 | 1.10 | 1.10 | 56.9% | 1.22 |

**Zipf 1.1 plus one object taking 10% of all traffic:**

| router | peak / mean (worst) | affinity |
|---|---:|---:|
| ring | 7.54 | 100.0% |
| two choices | 3.38 | 70.7% |
| **bounded ring ε=0.25** | **1.25** | 60.3% |

**Uniform keys.** The plain ring is uneven even with no skew:

| router | peak / mean (worst) | affinity |
|---|---:|---:|
| ring (160 vnodes) | 1.43 | 100.0% |
| bounded ring ε=0.25 | 1.25 | 99.8% |

**Stability and cost.** These were measured with Zipf 1.1 plus the hot key:

| router | traffic moved when 1 of 50 nodes leaves | ns per acquire+release |
|---|---:|---:|
| mod-n | 98.8% | 1,346 |
| ring | 1.4% | 1,265 |
| two choices | 98.4% | 2,460 |
| bounded ring ε=0.25 | 1.4% | 1,336 |

The bounded ring keeps the ring's stability and costs about the same per request. It cuts peak load from 8.3× to 1.25× the mean. The price is affinity for the hot keys, and ε tunes it. DESIGN.md has the full tradeoff.

## How it's tested

- **Property test (fast-check, 300 runs):** random interleavings of acquire (with skewed keys), release, node additions and node removals. After every step, no node's load exceeds the cap, and every request goes to a live node.
- **Mutation check:** changing `<` to `<=` in the cap test makes two tests fail, including the property test.
- **Ring property:** removing any node moves only that node's keys.
- **Hashing:** murmur3 checked against reference vectors from the C implementation.
- **Edge cases:** one node, ε ≤ 0, double release, removing the last node, and a hot key filling exactly ⌈requests / cap⌉ nodes.

## Limitations

- The load unit is "one request", not bytes or CPU. DESIGN.md explains the weighted version.
- Single router. With several routers, each enforces the bound on its own view of load. DESIGN.md covers the slack this introduces and two ways to handle it.
- Traffic is synthetic (Zipf plus one hot key), not real storage traces.
- Routing time is dominated by UTF-8-encoding string keys for hashing.

## Next steps

- Weighted bounded loads, so a request is charged by its expected cost.
- Multiple routers with gossiped load, measuring how much the bound degrades with gossip delay.
- Hot-key detection (count-min sketch) to combine replication with the bound.

---
Built with AI pair-programming (Claude); I reviewed the design, tests and results. MIT licensed.
