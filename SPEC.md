# SkillShield — Specification

## 1. Problem

In the Binance Agentic Wallet ecosystem, an AI *skill* is a package of
markdown instruction files (`SKILL.md` plus per-command reference files, and
optionally scripts) that an agent reads and follows to operate a wallet:
checking balances, calling contracts, signing messages. The instruction layer
is the product — and the attack surface.

Third-party projects routinely distribute skills by telling users: *"paste
this prompt, have your agent read our skill.md, enable Developer Mode."*
There is no integrity check on that distribution channel:

- A `SKILL.md` swapped or edited after publication is indistinguishable from
  the original. OWASP's Agentic Skills Top 10 rates malicious skills
  **critical (AST01)**: payloads hide in prose — fake "prerequisites",
  injected shell commands, requests to read credential files — and execute
  with the agent's full permissions. Snyk's ToxicSkills study found 13.4% of
  scanned public skills carried a critical security issue.
- Binance's own wallet developer publicly warned that Developer Mode lets
  unverified contract transactions be signed, and schemes already exist that
  pay users to hand over paired agent access.
- The official Binance Skills Hub hosts only Binance's own skills. For
  third-party project skills there is no registry, no signature scheme, and
  no accountable review channel. Web ratings are sybil-farmable.

## 2. Solution

SkillShield is an on-chain **integrity and community-review registry**:

1. A publisher (who must hold a Binance Agent ID) computes the canonical
   SHA-256 digest of a skill package (§4) and registers it in
   `SkillShieldRegistry` on BNB Chain, with name, version and package URI.
2. Any user or agent can hash a package they received — in the browser
   checker, with the CLI, or via the SkillShield Checker skill — and compare
   the digest against the registry with a single `eth_call`.
3. Other Agent ID holders record a stance per skill: **trust** or **flag**
   (with a reason: malicious code, prompt injection, impersonation, unsafe
   permissions, other). The publisher can **revoke** a registration, e.g.
   after a compromise.
4. All registry state is public and readable by any dApp or agent with one
   contract call, so verification can be embedded in other tools' install
   flows instead of living only on this website.

## 3. Threat model

**In scope**

| Threat | Mitigation |
|---|---|
| Skill file tampered after publication (mirror, chat forward, edited repo) | Digest mismatch — any single-byte change yields a different content hash |
| Impostor publishes a lookalike skill under a copied name | Registration is bound to the publisher's Agent ID tokenId; checkers display the publisher identity, and impersonation is a first-class flag reason |
| Publisher's release is compromised and must be disowned | Publisher-only `revokeSkill`; checkers hard-stop on revoked entries |
| Review farming / brigading | One stance per Agent ID (soulbound, one per account, non-transferable); a stance can be replaced but never duplicated |
| Malicious instructions inside an *authentic* package | Community flags with reasons accumulate against the exact digest; a heavily flagged entry is visible to every checker |

**Out of scope — what SkillShield cannot prove**

- **Integrity ≠ safety.** A registration proves a specific Agent ID holder
  published these exact bytes at a recorded time. It does not prove the
  bytes are benign: a publisher can register a malicious package, and
  community trust is a signal, not an audit.
- The registry cannot stop an agent whose user ignores the check, nor a
  skill that behaves maliciously only at runtime (e.g. fetching remote
  instructions). Publishers should keep skills self-contained; remote
  instruction fetching makes the hashed package an incomplete description
  of behaviour and is itself a red flag.
- Agent ID uniqueness relies on Binance/SPACE ID issuance (one claim per
  Binance account). SkillShield inherits that sybil cost; it does not add
  identity verification of its own.
- Hash availability: the registry stores digests and metadata only, never
  package contents. If a publisher's package URI disappears, the digest
  remains verifiable for copies already in circulation but the package
  cannot be re-fetched from SkillShield.

## 4. Canonical hashing

The content hash is computed **off-chain**; the contract stores and compares
an opaque `bytes32` only.

```
for each file in the package (relative paths, "/" separators):
    line = path + "\0" + sha256hex(fileBytes) + "\n"
sort lines by path, byte-wise ascending
contentHash = "0x" + sha256hex(utf8(concat(lines)))
```

Rules: every regular file in the package directory is included; empty
directories are ignored; the package root is the directory containing
`SKILL.md`. The single implementation lives in `lib/hash.mjs` and is shared
by the CLI and the web checker — the test suite proves both produce the
identical root for a fixture package, and that a one-byte change changes
the root.

Each package should carry a `skillshield.json` manifest **inside** the
hashed content:

```json
{ "name": "my-skill", "version": "1.0.0",
  "contracts": ["0x…"], "permissions": ["contract-call:0x…:mint(uint256)"] }
```

Because the manifest is hashed with everything else, changing declared
contracts or permissions changes the content hash and requires a new
registration — declarations cannot be quietly widened after review.

## 5. Contract design decisions

- **Zero dependencies, no owner, non-payable, holds no funds.** There is
  nothing to upgrade, pause, drain or govern; the deployer has no special
  power after deployment. This directly answers the hackathon's safety red
  lines (open-source, disclosed permissions — there are none).
- **Identity = Agent ID tokenId, not address.** Every write derives
  `tokenId = uint256(keccak256(bytes(handleOf(caller))))` from the Agent ID
  registry (the same derivation the SPACE ID contract itself uses, verified
  on mainnet). Publishers and reviewers are therefore accountable to a
  soulbound identity, and registry data stays meaningful if tooling ever
  resolves users by handle.
- **Gate at the contract, not the website.** `registerSkill`, `revokeSkill`
  and `review` all require `balanceOf(caller) > 0` on the Agent ID
  registry, so the rules hold for any client, not just this frontend.
- **One registration per content hash.** A digest names exactly one
  publisher of record; copycat re-registration of the same bytes reverts.
  New versions are new digests and new registrations.
- **Stance replacement with correct counts.** A reviewer may change their
  mind (e.g. a skill is later found malicious); counts are decremented /
  incremented in the same transaction so totals are never stale.
- **Immutable registry address in the constructor.** Test deployments point
  at `MockAgentIdRegistry`; mainnet points at the SPACE ID Agent ID
  contract `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`. No setter — a
  registry that could be repointed would be a trust hole.
- **Events for everything.** `SkillRegistered`, `SkillRevoked`,
  `SkillReviewed` carry all fields an indexer needs, so third parties can
  mirror the registry without polling state.

## 6. Landscape — what already exists (checked 2026-11-18)

Honest scoping: the *idea* of a skill registry is not new, and SkillShield
does not claim otherwise. What exists today:

- **ClawHub (OpenClaw ecosystem)** — a large *centralized* registry with
  automated scanning (VirusTotal and others) and opt-in community review.
  Identity is a GitHub account; the platform operator can edit or remove
  listings, and malicious skills have repeatedly passed its scanners
  (e.g. Unit 42, June 2026). It serves the OpenClaw skill format, not
  Binance Agentic Wallet skills, and has no on-chain identity or record.
- **skillreg (Arkiv hackathon prototype, Oct 2026)** — the closest relative:
  content fingerprints plus community ratings stored on Arkiv, a
  blockchain-backed database, on its *test network*. A hackathon prototype,
  not a production deployment; identity is a plain wallet key, and it is
  not connected to any wallet ecosystem's identity system.
- **ERC-8004** — generic on-chain registries for *agents* (identity,
  reputation, validation of agent work). It does not register skill
  *packages*, and it is not tied to Binance Agent ID.
- **Binance Skills Hub** — official Binance skills only; no third-party
  skill can be listed, registered or reviewed there.

SkillShield's specific combination is, to our knowledge, unoccupied:
a production-chain (BSC mainnet) registry for **Binance Agentic Wallet**
skill packages, where the right to publish and review is gated by
**Binance Agent ID itself** — a soulbound, one-per-person, non-transferable
identity issued inside the Binance App. That gating is what makes review
sybils expensive, and it is the asset this hackathon exists to showcase.
Other entrants' submissions to this hackathon are not public before the
public review period, so no claim is made about them.

## 7. Checker skill

`skills/skillshield-checker/` is a skill in the same format as the official
Binance Agentic Wallet skill. It instructs an agent, before installing or
running any third-party skill package, to hash it, query the registry, show
the user the verdict, and hard-stop on revoked, unregistered or heavily
flagged packages — never bypassing the user's own confirmation. It will be
registered as SkillShield entry #1, so the registry's first listing is the
tool that enforces it.
