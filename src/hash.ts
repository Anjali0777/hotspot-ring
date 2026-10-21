/**
 * 32-bit MurmurHash3 (x86_32) over UTF-8 bytes.
 *
 * Routing needs a hash that is fast, deterministic across processes and
 * well mixed in the low bits (hash-mod-N uses them directly). JavaScript's
 * built-ins offer none of that, so this is a small, dependency-free port.
 */
const encoder = new TextEncoder();

export function murmur3(key: string, seed = 0): number {
  const data = encoder.encode(key);
  const len = data.length;
  const nblocks = len >>> 2;
  let h = seed >>> 0;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;

  for (let i = 0; i < nblocks; i++) {
    const o = i << 2;
    let k = (data[o]! | (data[o + 1]! << 8) | (data[o + 2]! << 16) | (data[o + 3]! << 24)) >>> 0;
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }

  let k = 0;
  const tail = nblocks << 2;
  switch (len & 3) {
    case 3:
      k ^= data[tail + 2]! << 16;
    // falls through
    case 2:
      k ^= data[tail + 1]! << 8;
    // falls through
    case 1:
      k ^= data[tail]!;
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }

  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
