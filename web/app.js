import { computeRoot } from "../lib/hash.mjs";
import { encodeCall, decodeUint256, decodeSkill, ethCall } from "../lib/abi.mjs";

const cfg = window.SKILLSHIELD_CONFIG;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const deployed = typeof cfg.registryAddress === "string" && cfg.registryAddress.length === 42;

if (!deployed) {
  const notice = $("deployNotice");
  notice.hidden = false;
  notice.textContent =
    "Pre-deployment build: the registry contract is not deployed yet, so on-chain lookups are disabled. Hashing below works fully — it is the same code the CLI runs.";
}

// ── Checker ─────────────────────────────────────────────────────────────────

function stripCommonRoot(files) {
  const firstSegments = new Set(files.map((f) => f.path.split("/")[0]));
  if (files.length > 1 && firstSegments.size === 1 && files.every((f) => f.path.includes("/"))) {
    return files.map((f) => ({ ...f, path: f.path.slice(f.path.indexOf("/") + 1) }));
  }
  return files;
}

async function filesFromDataTransfer(dt) {
  const entries = [...dt.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (const child of await new Promise((res, rej) => reader.readEntries(res, rej))) {
        await walk(child, prefix + entry.name + "/");
      }
    }
  };
  if (entries.length) for (const e of entries) await walk(e, "");
  else for (const file of dt.files) out.push({ path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return out;
}

async function filesFromInput(input) {
  const out = [];
  for (const file of input.files) {
    out.push({ path: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return out;
}

async function runCheck(rawFiles) {
  const result = $("checkResult");
  result.hidden = false;
  if (!rawFiles.length) {
    result.innerHTML = `<div class="verdict unknown"><h3>No files selected</h3></div>`;
    return;
  }
  const { root, lines } = await computeRoot(stripCommonRoot(rawFiles));
  let verdictHtml = `<div class="verdict unknown"><h3>Hash computed — registry not deployed yet</h3>
    <p>Content hash: <code>${root}</code></p></div>`;
  if (deployed) {
    try {
      const id = decodeUint256(await ethCall(cfg.rpcUrl, cfg.registryAddress, encodeCall("skillIdByHash(bytes32)", [["bytes32", root]])));
      if (id === 0n) {
        verdictHtml = `<div class="verdict unknown"><h3>⚠ Not registered</h3>
          <p>No Agent ID holder has registered this exact package. Content hash: <code>${root}</code>.
          Treat the package as unverified and inspect it manually before use.</p></div>`;
      } else {
        const s = decodeSkill(await ethCall(cfg.rpcUrl, cfg.registryAddress, encodeCall("getSkill(uint256)", [["uint256", id]])));
        verdictHtml = s.revoked
          ? `<div class="verdict bad"><h3>⛔ Revoked by publisher</h3><p><strong>${esc(s.name)}</strong> v${esc(s.version)} (skill #${id}) was revoked. Do not install this package.</p></div>`
          : `<div class="verdict ok"><h3>✓ Registered on-chain</h3>
             <p><strong>${esc(s.name)}</strong> v${esc(s.version)} · skill #${id} · publisher <code>${esc(s.publisher)}</code><br>
             Community stance: ${s.trustCount} trust · ${s.flagCount} flag</p>
             <p class="muted">Registration proves integrity, not safety — see the docs below.</p></div>`;
      }
    } catch (err) {
      verdictHtml = `<div class="verdict unknown"><h3>Registry lookup failed</h3><p>${esc(err.message)}</p>
      <p>Content hash: <code>${root}</code></p></div>`;
    }
  }
  const rows = lines.map((l) => `<tr><td>${esc(l.path)}</td><td class="hash">${l.sha256}</td></tr>`).join("");
  result.innerHTML = verdictHtml + `<table class="file-table"><tr><th>File</th><th>SHA-256</th></tr>${rows}</table>`;
}

const dz = $("dropZone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
dz.addEventListener("drop", async (e) => {
  e.preventDefault(); dz.classList.remove("dragover");
  runCheck(await filesFromDataTransfer(e.dataTransfer));
});
$("folderInput").addEventListener("change", async (e) => runCheck(await filesFromInput(e.target)));
$("filesInput").addEventListener("change", async (e) => runCheck(await filesFromInput(e.target)));

// ── Registry explorer (read-only, no wallet needed) ────────────────────────

async function loadRegistry() {
  const list = $("registryList");
  if (!deployed) {
    list.innerHTML = `<p class="muted">Registry contract not deployed yet — entries will appear here after the deploy phase.</p>`;
    return;
  }
  try {
    const total = Number(decodeUint256(await ethCall(cfg.rpcUrl, cfg.registryAddress, encodeCall("totalSkills()", []))));
    if (total === 0) {
      list.innerHTML = `<p class="muted">No skills registered yet. Be the first publisher.</p>`;
      return;
    }
    list.innerHTML = "";
    for (let id = 1; id <= total; id++) {
      const s = decodeSkill(await ethCall(cfg.rpcUrl, cfg.registryAddress, encodeCall("getSkill(uint256)", [["uint256", id]])));
      const row = document.createElement("div");
      row.className = "skill-row";
      const status = s.revoked ? `<span class="pill bad">revoked</span>` : `<span class="pill ok">active</span>`;
      row.innerHTML = `<span class="name">${esc(s.name)}</span><span class="pill">v${esc(s.version)}</span>${status}
        <span class="pill">✓ ${s.trustCount} trust</span><span class="pill">⚑ ${s.flagCount} flag</span>
        <span class="muted">#${id} · publisher <code>${esc(s.publisher)}</code></span>`;
      list.append(row);
    }
  } catch (err) {
    list.innerHTML = `<p class="muted">Could not reach the registry: ${esc(err.message)}</p>`;
  }
}
loadRegistry();

// ── Wallet writes ───────────────────────────────────────────────────────────

let account = null;
$("connectBtn").addEventListener("click", async () => {
  if (!window.ethereum) return alert("No EVM wallet found in this browser.");
  [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  $("connectBtn").textContent = account.slice(0, 6) + "…" + account.slice(-4);
});

async function sendTx(data, form) {
  const msg = form.querySelector(".form-msg");
  if (!deployed) return (msg.textContent = "Registry is not deployed yet — writes are disabled in this build.");
  if (!window.ethereum || !account) return (msg.textContent = "Connect your wallet first.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) !== cfg.chainId) return (msg.textContent = `Switch your wallet to ${cfg.chainName} (chain ${cfg.chainId}) first.`);
  try {
    const hash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: cfg.registryAddress, data }],
    });
    msg.textContent = `Transaction sent: ${hash} — confirm it in your wallet and on BscScan.`;
  } catch (err) {
    msg.textContent = `Transaction rejected or failed: ${err.message}`;
  }
}

$("registerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  sendTx(encodeCall("registerSkill(bytes32,string,string,string)", [
    ["bytes32", f.get("contentHash").trim()],
    ["string", f.get("name").trim()],
    ["string", f.get("version").trim()],
    ["string", f.get("uri").trim()],
  ]), e.target);
});

$("reviewForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  sendTx(encodeCall("review(uint256,bool,uint8)", [
    ["uint256", f.get("skillId")],
    ["bool", f.get("trusted") === "true"],
    ["uint8", f.get("reason")],
  ]), e.target);
});
