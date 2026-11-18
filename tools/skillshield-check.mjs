#!/usr/bin/env node
// SkillShield checker CLI.
//   node tools/skillshield-check.mjs <skill-dir>
//   node tools/skillshield-check.mjs <skill-dir> --registry 0x… [--rpc https://…]
// Prints the canonical content hash; with --registry, also queries the
// registry read-only (eth_call) and reports the on-chain verdict.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { computeRoot } from "../lib/hash.mjs";
import { encodeCall, decodeUint256, decodeSkill, ethCall } from "../lib/abi.mjs";

const DEFAULT_RPC = "https://bsc-dataseed.binance.org";

async function collect(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full, base)));
    else if (entry.isFile()) files.push({ path: relative(base, full).split("\\").join("/"), bytes: await readFile(full) });
  }
  return files;
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
if (!dir) {
  console.error("usage: skillshield-check <skill-dir> [--registry 0x…] [--rpc https://…]");
  process.exit(2);
}

const { root, lines } = await computeRoot(await collect(dir));
const report = { directory: dir, files: lines, contentHash: root };

const registry = option("--registry");
if (registry) {
  const rpc = option("--rpc") ?? DEFAULT_RPC;
  const id = decodeUint256(await ethCall(rpc, registry, encodeCall("skillIdByHash(bytes32)", [["bytes32", root]])));
  report.registry = { address: registry, rpc, skillId: id.toString() };
  if (id > 0n) {
    const skill = decodeSkill(await ethCall(rpc, registry, encodeCall("getSkill(uint256)", [["uint256", id]])));
    report.registry.skill = {
      ...skill,
      publisherTokenId: skill.publisherTokenId.toString(),
      trustCount: skill.trustCount.toString(),
      flagCount: skill.flagCount.toString(),
      registeredAt: new Date(Number(skill.registeredAt) * 1000).toISOString(),
    };
    report.verdict = skill.revoked ? "REVOKED — do not install" : "REGISTERED";
  } else {
    report.verdict = "NOT REGISTERED — hash not found on-chain";
  }
}
console.log(JSON.stringify(report, null, 2));
