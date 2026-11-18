// Canonical SkillShield package hashing — single implementation shared by
// the CLI (Node) and the web checker (browser). See SPEC.md §Hashing.
//
// For each file: line = `${relativePath}\0${sha256hex(fileBytes)}\n`
// Lines are ordered by relative path (byte-wise), concatenated, and the
// content hash is the SHA-256 of that concatenation, as 0x-prefixed hex.

const encoder = new TextEncoder();

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * @param {{path: string, bytes: Uint8Array}[]} files paths use "/" separators
 * @returns {Promise<{root: string, lines: {path: string, sha256: string}[]}>}
 *          root is the 0x-prefixed bytes32 content hash for the registry.
 */
export async function computeRoot(files) {
  const lines = [];
  for (const file of [...files].sort(byPath)) {
    lines.push({ path: file.path, sha256: await sha256Hex(file.bytes) });
  }
  const manifest = lines.map((l) => `${l.path}\0${l.sha256}\n`).join("");
  return { root: "0x" + (await sha256Hex(encoder.encode(manifest))), lines };
}
