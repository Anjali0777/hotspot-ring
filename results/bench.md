Nodes: 50, requests in flight: 10000 (200/node), steps: 1,000,000, objects: 100,000
Node v22.22.0, full run

### uniform keys

| router | peak / mean (worst) | peak / mean (p99) | affinity | mean ring steps walked |
|---|---:|---:|---:|---:|
| mod-n | 1.33 | 1.27 | 100.0% | – |
| ring (160 vnodes) | 1.43 | 1.37 | 100.0% | – |
| two choices | 1.02 | 1.02 | 51.7% | – |
| bounded ring ε=1.0 | 1.43 | 1.37 | 100.0% | 0.00 |
| bounded ring ε=0.25 | 1.25 | 1.25 | 99.8% | 0.00 |
| bounded ring ε=0.1 | 1.10 | 1.10 | 95.1% | 0.03 |

### Zipf 1.1

| router | peak / mean (worst) | peak / mean (p99) | affinity | mean ring steps walked |
|---|---:|---:|---:|---:|
| mod-n | 7.81 | 7.61 | 100.0% | – |
| ring (160 vnodes) | 8.30 | 8.06 | 100.0% | – |
| two choices | 3.66 | 3.58 | 71.8% | – |
| bounded ring ε=1.0 | 2.00 | 2.00 | 81.7% | 0.37 |
| bounded ring ε=0.25 | 1.25 | 1.25 | 65.0% | 0.93 |
| bounded ring ε=0.1 | 1.10 | 1.10 | 56.9% | 1.22 |

### Zipf 1.1 + one key at 10%

| router | peak / mean (worst) | peak / mean (p99) | affinity | mean ring steps walked |
|---|---:|---:|---:|---:|
| mod-n | 7.17 | 6.96 | 100.0% | – |
| ring (160 vnodes) | 7.54 | 7.37 | 100.0% | – |
| two choices | 3.38 | 3.29 | 70.7% | – |
| bounded ring ε=1.0 | 2.00 | 2.00 | 78.8% | 0.41 |
| bounded ring ε=0.25 | 1.25 | 1.25 | 60.3% | 1.08 |
| bounded ring ε=0.1 | 1.10 | 1.10 | 52.7% | 1.45 |

### Reshuffling and routing cost (Zipf 1.1 + hot key)

| router | traffic moved when 1 of 50 nodes leaves | ns per acquire+release | ops/s |
|---|---:|---:|---:|
| mod-n | 98.8% | 1346 | 742,844 |
| ring (160 vnodes) | 1.4% | 1265 | 790,535 |
| two choices | 98.4% | 2460 | 406,493 |
| bounded ring ε=1.0 | 1.4% | 1373 | 728,136 |
| bounded ring ε=0.25 | 1.4% | 1336 | 748,733 |
| bounded ring ε=0.1 | 1.4% | 1352 | 739,615 |
