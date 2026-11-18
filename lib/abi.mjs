// Minimal ABI codec for the SkillShieldRegistry surface — no dependencies.
// Supports exactly the types the registry uses: address, bool, uint8,
// uint256, bytes32, string. Encoding is for eth_call / eth_sendTransaction;
// decoding covers uint256 returns and the getSkill tuple.

import { keccak256, toHex } from "./keccak.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const strip0x = (hex) => (hex.startsWith("0x") ? hex.slice(2) : hex);
const word = (hex) => strip0x(hex).padStart(64, "0");

export const selector = (signature) => "0x" + toHex(keccak256(encoder.encode(signature)).slice(0, 4));

function encodeValue(type, value) {
  switch (type) {
    case "address":
      return word(value);
    case "bool":
      return word(value ? "1" : "0");
    case "uint8":
    case "uint256":
      return word(BigInt(value).toString(16));
    case "bytes32":
      return strip0x(value).padEnd(64, "0");
    case "string": {
      const bytes = encoder.encode(value);
      const data = toHex(bytes).padEnd(Math.ceil(bytes.length / 32) * 64 || 64, "0");
      return { tail: word(bytes.length.toString(16)) + data, dynamic: true };
    }
    default:
      throw new Error(`unsupported ABI type: ${type}`);
  }
}

/** encodeCall("review(uint256,bool,uint8)", [["uint256",1],["bool",true],["uint8",2]]) */
export function encodeCall(signature, args = []) {
  const heads = [], tails = [];
  let tailBytes = 0;
  for (const [type, value] of args) {
    const encoded = encodeValue(type, value);
    if (typeof encoded === "string") {
      heads.push(encoded);
    } else {
      heads.push(word((args.length * 32 + tailBytes).toString(16)));
      tails.push(encoded.tail);
      tailBytes += encoded.tail.length / 2;
    }
  }
  return selector(signature) + heads.join("") + tails.join("");
}

export const decodeUint256 = (hex) => BigInt("0x" + strip0x(hex).slice(0, 64));

function readWord(hex, byteOffset) {
  return strip0x(hex).slice(byteOffset * 2, byteOffset * 2 + 64);
}
function readString(hex, byteOffset) {
  const length = Number(BigInt("0x" + readWord(hex, byteOffset)));
  const data = strip0x(hex).slice((byteOffset + 32) * 2, (byteOffset + 32) * 2 + length * 2);
  return decoder.decode(Uint8Array.from(data.match(/../g).map((h) => parseInt(h, 16))));
}

/** Decode the getSkill(uint256) return tuple. A single struct return is
 *  wrapped in a one-component tuple, so the payload starts with a 0x20
 *  offset word pointing at the struct head — handle both shapes. */
export function decodeSkill(hex) {
  const base = BigInt("0x" + readWord(hex, 0)) === 32n ? 32 : 0;
  const at = (i) => readWord(hex, base + i * 32);
  const uintAt = (i) => BigInt("0x" + at(i));
  const stringAt = (i) => readString(hex, base + Number(uintAt(i)));
  return {
    contentHash: "0x" + at(0),
    publisher: "0x" + at(1).slice(24),
    publisherTokenId: uintAt(2),
    name: stringAt(3),
    version: stringAt(4),
    uri: stringAt(5),
    revoked: uintAt(6) !== 0n,
    trustCount: uintAt(7),
    flagCount: uintAt(8),
    registeredAt: uintAt(9),
  };
}

/** JSON-RPC eth_call against any EVM RPC endpoint (read-only). */
export async function ethCall(rpcUrl, to, data) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`eth_call failed: ${json.error.message}`);
  return json.result;
}
