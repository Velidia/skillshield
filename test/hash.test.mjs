// Node tests for the shared hashing module, Keccak selectors, the ABI
// codec, and CLI ↔ library hash consistency. Run: node --test test/hash.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRoot } from "../lib/hash.mjs";
import { keccak256Hex } from "../lib/keccak.mjs";
import { selector, encodeCall, decodeUint256, decodeSkill } from "../lib/abi.mjs";

const run = promisify(execFile);
const fixtureDir = fileURLToPath(new URL("../fixtures/sample-skill", import.meta.url));
const cliPath = fileURLToPath(new URL("../tools/skillshield-check.mjs", import.meta.url));

async function collect(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full, base)));
    else files.push({ path: relative(base, full).split("\\").join("/"), bytes: await readFile(full) });
  }
  return files;
}

test("keccak256 matches known vectors", () => {
  assert.equal(keccak256Hex(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(selector("balanceOf(address)"), "0x70a08231");
  assert.equal(selector("handleOf(address)"), "0xc50a1514");
});

test("root is deterministic and order-independent", async () => {
  const files = await collect(fixtureDir);
  const a = await computeRoot(files);
  const b = await computeRoot([...files].reverse());
  assert.equal(a.root, b.root);
  assert.match(a.root, /^0x[0-9a-f]{64}$/);
  assert.deepEqual(a.lines.map((l) => l.path), ["SKILL.md", "references/notes.md", "skillshield.json"]);
});

test("changing one byte changes the root", async () => {
  const files = await collect(fixtureDir);
  const tampered = files.map((f) =>
    f.path === "SKILL.md" ? { ...f, bytes: new Uint8Array([...f.bytes, 0x21]) } : f,
  );
  assert.notEqual((await computeRoot(files)).root, (await computeRoot(tampered)).root);
});

test("CLI and shared library produce the identical root", async () => {
  const { stdout } = await run("node", [cliPath, fixtureDir]);
  const cli = JSON.parse(stdout);
  const lib = await computeRoot(await collect(fixtureDir));
  assert.equal(cli.contentHash, lib.root);
  assert.deepEqual(cli.files, lib.lines);
});

test("ABI encode/decode round-trip for the getSkill tuple", () => {
  // Build a synthetic getSkill return payload word by word.
  const w = (hex) => hex.padStart(64, "0");
  const str = (s) => {
    const bytes = new TextEncoder().encode(s);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return w(bytes.length.toString(16)) + hex.padEnd(64, "0");
  };
  const head =
    "ab".repeat(32) + // contentHash
    w("7eb0357835054db380b4e523895d149073829d77") + // publisher
    w("5") + // publisherTokenId
    w((10 * 32).toString(16)) + // name offset
    w((12 * 32).toString(16)) + // version offset
    w((14 * 32).toString(16)) + // uri offset
    w("0") + w("3") + w("1") + w("1763472000"); // revoked, trust, flag, registeredAt
  // Real ABI wraps a single struct return in an offset word (0x20).
  const payload = "0x" + w((32).toString(16)) + head + str("demo-skill") + str("1.0.0") + str("ipfs://demo");
  const skill = decodeSkill(payload);
  assert.equal(skill.contentHash, "0x" + "ab".repeat(32));
  assert.equal(skill.publisher, "0x7eb0357835054db380b4e523895d149073829d77");
  assert.equal(skill.name, "demo-skill");
  assert.equal(skill.version, "1.0.0");
  assert.equal(skill.uri, "ipfs://demo");
  assert.equal(skill.trustCount, 3n);
  assert.equal(skill.flagCount, 1n);
  assert.equal(skill.revoked, false);
});

test("encodeCall embeds selector and args", () => {
  const data = encodeCall("skillIdByHash(bytes32)", [["bytes32", "0x" + "11".repeat(32)]]);
  assert.equal(data.slice(0, 10), selector("skillIdByHash(bytes32)"));
  assert.equal(data.slice(10), "11".repeat(32));
  assert.equal(decodeUint256("0x" + "0".repeat(63) + "7"), 7n);
});
