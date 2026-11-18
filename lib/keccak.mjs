// Keccak-256 (Ethereum variant, 0x01 padding) in pure JS — no dependencies.
// Used only for 4-byte function selectors; file hashing uses SHA-256.

const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RHO = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK);

function keccakF(state) {
  const C = new Array(5), D = new Array(5), B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let i = 0; i < 25; i++) state[i] ^= D[i % 5];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(state[x + 5 * y], RHO[x + 5 * y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        state[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y]);
    state[0] ^= RC[round];
  }
}

/** @param {Uint8Array} input @returns {Uint8Array} 32-byte Keccak-256 digest */
export function keccak256(input) {
  const rate = 136; // (1600 - 512) / 8
  const state = new Array(25).fill(0n);
  const padded = Array.from(input);
  padded.push(0x01);
  while (padded.length % rate !== rate - 1) padded.push(0);
  padded.push(0x80);
  for (let block = 0; block < padded.length; block += rate) {
    for (let i = 0; i < rate; i++) {
      const lane = i >> 3, byte = padded[block + i];
      state[lane] ^= BigInt(byte) << BigInt(8 * (i & 7));
    }
    keccakF(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number((state[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  return out;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const keccak256Hex = (input) => toHex(keccak256(typeof input === "string" ? new TextEncoder().encode(input) : input));
