# SkillShield

**Verify the skill before your agent runs it.**

An on-chain integrity & community-review registry for third-party AI agent
skills in the Binance Agentic Wallet ecosystem — built for the
**Binance Wallet × BNB Chain Agent ID Hackathon**.

## The problem

Agent skills are packages of markdown instructions (`SKILL.md` + reference
files) that an AI agent reads and *follows* to operate a wallet. Third-party
projects distribute them through websites, chats and repos with **no
integrity check at all**: a file edited after publication — one injected
line redirecting a transfer or asking the agent to read credential files —
is indistinguishable from the original. OWASP ranks malicious skills as a
critical threat (AST01); Snyk found 13.4% of scanned public skills carried
a critical issue. Binance's Skills Hub covers only official skills, and
ordinary web ratings can be farmed by throwaway accounts.

## The solution

Publishers who hold a **Binance Agent ID** register the canonical SHA-256
digest of their skill package on-chain. Anyone — user, agent, or another
dApp — can hash a package they received and verify it against the registry
with one read-only call. Other Agent ID holders **trust** or **flag** each
digest (one stance per soulbound Agent ID, replaceable, with reasons);
publishers can **revoke** compromised versions.

```
 publisher ──registerSkill(hash, name, version, uri)──▶ ┌────────────────────┐
                                                        │ SkillShieldRegistry │
 user/agent ──hash package──▶ Checker (web / CLI /      │  BSC · no owner ·   │
              skill) ──eth_call skillIdByHash/getSkill─▶│  holds no funds     │
 reviewers ──review(skillId, trusted, reason)──────────▶└────────────────────┘
              identity for every write = Agent ID tokenId
              (keccak256 of the holder's SPACE ID handle)
```

**What it proves:** these exact bytes were published by this Agent ID
holder at this time; tampering is detectable; warnings are accountable.
**What it does not prove:** that a skill is safe. Registration is an
integrity anchor, not an audit — see `SPEC.md` for the full threat model.

## Repository layout

| Path | Contents |
|---|---|
| `SPEC.md` | Problem, threat model, canonical hashing spec, design decisions |
| `contracts/SkillShieldRegistry.sol` | The registry (Solidity 0.8.24, zero dependencies, 174 lines) |
| `contracts/MockAgentIdRegistry.sol` | Agent ID test double for testnet/local use |
| `test/SkillShieldRegistry.t.sol` | Foundry suite — 14 tests, no framework dependency |
| `test/hash.test.mjs` | Node suite — hashing, Keccak/ABI codec, CLI↔library consistency (6 tests) |
| `lib/hash.mjs` | The one canonical hashing implementation (Node + browser) |
| `lib/abi.mjs`, `lib/keccak.mjs` | Minimal dependency-free ABI codec for the registry surface |
| `tools/skillshield-check.mjs` | CLI: hash a package, optionally query the registry read-only |
| `web/` | Static frontend — checker, registry explorer, publish & review (no build step) |
| `skills/skillshield-checker/` | Our own agent skill: verify before installing — registry entry #1 |

## Run the tests

```bash
# Contracts (Foundry: https://getfoundry.sh)
forge test

# Hashing / CLI / codec (Node ≥ 20)
node --test test/hash.test.mjs

# Hash a package
node tools/skillshield-check.mjs path/to/skill-dir
node tools/skillshield-check.mjs path/to/skill-dir --registry 0x… [--rpc https://…]
```

## Run the site

Serve the repository root with any static server, then open `/web/`:

```bash
python3 -m http.server 8080   # then visit http://localhost:8080/web/
```

Read-only mode works with no wallet. Set the deployed address in
`web/config.js` after deployment.

## Deployment plan (not yet executed)

1. **BSC testnet** — deploy `MockAgentIdRegistry`, then the registry
   against it; run the full flow (register → review → revoke) and verify
   source on the testnet explorer.
2. **BSC mainnet** — deploy `SkillShieldRegistry` with the real Agent ID
   registry `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` as constructor
   argument; verify source via Sourcify/BscScan (the contract is a single
   file with no dependencies, so verification is a paste-and-match).
3. Register `skills/skillshield-checker` as entry #1, set
   `web/config.js`, publish the site, and submit the project (name,
   website, contract address, Agent ID usage description) before
   9 Dec 2026, 08:00 UTC.
4. Drive ≥30 Agent ID holders to register or review during the submission
   window — every write is an Agent-ID-gated interaction with the contract.

## Hackathon fit

- **Agent ID application depth (30%)** — Agent ID is not a login badge:
  it is the publisher identity, the reviewer identity, and the sybil
  resistance of the whole registry, enforced in the contract itself.
- **Practicality & feasibility (25%)** — the threat is documented and
  current; the fix is small, complete and already testable end-to-end.
- **Product completion (25%)** — contract + CLI + browser checker + an
  agent skill that enforces the check, all sharing one hashing spec.
- **Innovation (20%)** — no integrity registry exists for third-party
  skills in this ecosystem; SkillShield turns every Agent ID holder into
  an accountable reviewer and every agent into a verifier.

## License

MIT
