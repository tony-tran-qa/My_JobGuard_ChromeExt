// JobGuard Popup Script
/* global JobGuardData */

document.addEventListener("DOMContentLoaded", () => {
  // ─── TAB SWITCHING ───────────────────────────────────────────
  const tabs = document.querySelectorAll(".tab");
  const tabPanels = {
    vet: document.getElementById("tab-vet"),
    blacklist: document.getElementById("tab-blacklist"),
    records: document.getElementById("tab-records"),
    favorites: document.getElementById("tab-favorites"),
    agencies: document.getElementById("tab-agencies"),
    settings: document.getElementById("tab-settings"),
  };

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      Object.entries(tabPanels).forEach(([key, el]) => {
        el.style.display = key === tab.dataset.tab ? "block" : "none";
      });
      if (tab.dataset.tab === "blacklist") loadBlacklist();
      if (tab.dataset.tab === "records") loadRecords();
      if (tab.dataset.tab === "favorites") loadFavorites();
      if (tab.dataset.tab === "agencies") loadAgencies();
    });
  });

  // ─── STATUS CHECK ────────────────────────────────────────────
  chrome.storage.local.get(["apiKey"], (result) => {
    const hasKey = !!result.apiKey;
    document.getElementById("status-dot").className = `status-dot ${hasKey ? "" : "inactive"}`;
    document.getElementById("status-text").textContent = hasKey
      ? "AI vetting active"
      : "No API key — set one in Settings";
  });

  // ─── VET TAB ─────────────────────────────────────────────────
  const companyInput = document.getElementById("company-input");
  const roleInput = document.getElementById("role-input");
  const vetBtn = document.getElementById("vet-btn");
  const resultArea = document.getElementById("result-area");

  // Pre-fill from active LinkedIn tab if possible
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.url?.includes("linkedin.com")) {
      chrome.tabs.sendMessage(tab.id, { type: "GET_CURRENT_COMPANY" }, (res) => {
        if (res?.company) companyInput.value = res.company;
        if (res?.role) roleInput.value = res.role;
      });
    }
  });

  [companyInput, roleInput].forEach(el => {
    el.addEventListener("keydown", e => { if (e.key === "Enter") runVet(); });
  });
  vetBtn.addEventListener("click", runVet);

  function runVet() {
    const company = companyInput.value.trim();
    const role = roleInput.value.trim();
    if (!company) return;

    // Check blacklist first
    chrome.runtime.sendMessage({ type: "CHECK_BLACKLIST", company }, (res) => {
      if (res?.hit) {
        resultArea.innerHTML = `
          <div class="blacklisted-card">
            <div class="bl-title">🚫 BLACKLISTED — DO NOT APPLY</div>
            <div class="bl-reason">${escHtml(res.hit.reason)}</div>
          </div>
        `;
        return;
      }

      // AI vet
      resultArea.innerHTML = `<div class="loading"><div class="spinner"></div> Analyzing with AI...</div>`;
      vetBtn.disabled = true;

      chrome.runtime.sendMessage({ type: "VET_COMPANY", company, role }, (res) => {
        vetBtn.disabled = false;
        if (!res?.success) {
          resultArea.innerHTML = `
            <div class="error-card">
              ⚠ ${escHtml(res?.error || "Analysis failed")}
              ${res?.error?.includes("API key") ? `<div class="error-hint">Go to Settings tab to add your Anthropic API key.</div>` : ""}
            </div>
          `;
          return;
        }

        const r = res.result;
        const riskClass = { LOW: "risk-low", MEDIUM: "risk-medium", HIGH: "risk-high" }[r.riskLevel] || "risk-medium";
        const recClass = { APPLY: "rec-apply", CAUTION: "rec-caution", AVOID: "rec-avoid" }[r.recommendation] || "";
        const recIcon = { APPLY: "✓", CAUTION: "⚠", AVOID: "✕" }[r.recommendation] || "";

        resultArea.innerHTML = `
          <div class="result-card">
            <div class="result-header">
              <span class="badge ${riskClass}">${r.riskLevel} RISK</span>
              <span class="badge ${recClass}">${recIcon} ${r.recommendation}</span>
            </div>
            <div class="verdict">${escHtml(r.verdict)}</div>
            <div class="flags-grid">
              <div>
                <div class="section-label label-red">🚩 Red Flags</div>
                ${(r.redFlags || []).map(f => `<div class="flag flag-red">${escHtml(f)}</div>`).join("") || '<div class="empty">None</div>'}
              </div>
              <div>
                <div class="section-label label-green">✓ Green Flags</div>
                ${(r.greenFlags || []).map(f => `<div class="flag flag-green">${escHtml(f)}</div>`).join("") || '<div class="empty">None</div>'}
              </div>
            </div>
            <button class="add-bl-btn" id="popup-add-bl">+ Add to Blacklist</button>
          </div>
        `;

        document.getElementById("popup-add-bl")?.addEventListener("click", () => {
          chrome.runtime.sendMessage({
            type: "ADD_TO_BLACKLIST",
            entry: { name: company, reason: r.verdict },
          }, () => {
            resultArea.innerHTML = `<div class="blacklisted-card"><div class="bl-title">✓ Added to blacklist</div></div>`;
          });
        });
      });
    });
  }

  // ─── BLACKLIST TAB ───────────────────────────────────────────
  function loadBlacklist() {
    chrome.runtime.sendMessage({ type: "GET_BLACKLIST" }, (res) => {
      const list = res?.blacklist || [];
      document.getElementById("bl-count").textContent = `${list.length} companies flagged`;
      const listEl = document.getElementById("bl-list");

      if (list.length === 0) {
        listEl.innerHTML = `<div class="empty-state">No companies blacklisted yet</div>`;
        return;
      }

      listEl.innerHTML = list.map((entry, i) => `
        <div class="bl-row">
          <div class="bl-info">
            <div class="bl-name">🚫 ${escHtml(entry.name)}</div>
            <div class="bl-reason-text">${escHtml(entry.reason)}</div>
          </div>
          <button class="rm-btn" data-index="${i}">Remove</button>
        </div>
      `).join("");

      listEl.querySelectorAll(".rm-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.index);
          chrome.runtime.sendMessage({ type: "REMOVE_FROM_BLACKLIST", index: idx }, () => {
            loadBlacklist();
          });
        });
      });
    });
  }

  // Add entry form
  const addToggle = document.getElementById("add-toggle-btn");
  const addForm = document.getElementById("add-form");
  addToggle.addEventListener("click", () => {
    const open = addForm.style.display !== "none";
    addForm.style.display = open ? "none" : "block";
    addToggle.textContent = open ? "+ Add Company Manually" : "✕ Cancel";
  });

  document.getElementById("bl-add-btn")?.addEventListener("click", () => {
    const name = document.getElementById("bl-name-input")?.value?.trim();
    const reason = document.getElementById("bl-reason-input")?.value?.trim();
    if (!name) return;
    chrome.runtime.sendMessage({
      type: "ADD_TO_BLACKLIST",
      entry: { name, reason: reason || "Manually flagged" },
    }, () => {
      document.getElementById("bl-name-input").value = "";
      document.getElementById("bl-reason-input").value = "";
      addForm.style.display = "none";
      addToggle.textContent = "+ Add Company Manually";
      loadBlacklist();
    });
  });

  // ─── SETTINGS TAB ────────────────────────────────────────────
  chrome.runtime.sendMessage({ type: "GET_API_KEY" }, (res) => {
    if (res?.apiKey) {
      document.getElementById("api-key-input").value = res.apiKey;
    }
  });

  document.getElementById("save-key-btn")?.addEventListener("click", () => {
    const key = document.getElementById("api-key-input")?.value?.trim();
    chrome.runtime.sendMessage({ type: "SAVE_API_KEY", apiKey: key }, () => {
      const msg = document.getElementById("saved-msg");
      msg.style.display = "inline";
      setTimeout(() => { msg.style.display = "none"; }, 2000);
      // Update status
      document.getElementById("status-dot").className = `status-dot ${key ? "" : "inactive"}`;
      document.getElementById("status-text").textContent = key ? "AI vetting active" : "No API key set";
    });
  });

  // ─── FULL TAB ────────────────────────────────────────────────
  if (new URLSearchParams(location.search).get("full") === "1") {
    document.body.classList.add("fulltab");
  }
  document.getElementById("open-tab-btn")?.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?full=1") });
    window.close();
  });

  // ─── STORAGE HELPERS ─────────────────────────────────────────
  const getStore = (keys) => new Promise(res => chrome.storage.local.get(keys, res));
  const setStore = (obj) => new Promise(res => chrome.storage.local.set(obj, res));

  // ─── RECORDS + FAVORITES ─────────────────────────────────────
  function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString() : ""; }

  function recRowHtml(r, { favorite, showDelete }) {
    const riskClass = { LOW: "risk-low", MEDIUM: "risk-medium", HIGH: "risk-high" }[r.riskLevel] || "risk-medium";
    const recClass = { APPLY: "rec-apply", CAUTION: "rec-caution", AVOID: "rec-avoid" }[r.recommendation] || "";
    const flags = (arr, cls) => (arr || []).map(f => `<div class="flag ${cls}">${escHtml(f)}</div>`).join("");
    return `
      <div class="rec-row" data-id="${escHtml(String(r.id))}">
        <div class="rec-top">
          <div class="rec-main">
            <div class="rec-company">${escHtml(r.company)}${r.role ? ` <span style="color:#4a6885">· ${escHtml(r.role)}</span>` : ""}</div>
            <div class="rec-meta">${escHtml(fmtDate(r.ts || r.favoritedAt))}</div>
          </div>
          <span class="badge ${riskClass}">${escHtml(r.riskLevel || "?")}</span>
          <span class="badge ${recClass}">${escHtml(r.recommendation || "")}</span>
          <div class="rec-actions">
            <button class="icon-btn ${favorite ? "on" : ""}" data-act="fav" title="Favorite">${favorite ? "★" : "☆"}</button>
            ${showDelete ? `<button class="icon-btn danger" data-act="del">Delete</button>` : ""}
          </div>
        </div>
        <div class="rec-detail">
          <div>${escHtml(r.verdict)}</div>
          ${flags(r.redFlags, "flag-red")}${flags(r.greenFlags, "flag-green")}
        </div>
      </div>`;
  }

  // One click handler per list: buttons run an action, anywhere else expands the row.
  function wireRows(listEl, handlers) {
    listEl.onclick = (e) => {
      const row = e.target.closest(".rec-row");
      if (!row) return;
      const btn = e.target.closest("button[data-act]");
      if (!btn) { row.classList.toggle("open"); return; }
      handlers[btn.dataset.act]?.(row.dataset.id, btn);
    };
  }

  async function loadRecords() {
    const { records = [], favorites = [] } = await getStore(["records", "favorites"]);
    const favIds = new Set(favorites.map(f => String(f.id)));
    document.getElementById("rec-count").textContent = `${records.length} vetting records`;
    const listEl = document.getElementById("rec-list");
    listEl.innerHTML = records.length
      ? records.map(r => recRowHtml(r, { favorite: favIds.has(String(r.id)), showDelete: true })).join("")
      : `<div class="empty-state">No vetting records yet. Run a check and it will appear here.</div>`;
    wireRows(listEl, {
      fav: async (id) => {
        const rec = records.find(r => String(r.id) === id);
        if (!rec) return;
        await setStore({ favorites: JobGuardData.toggleFavorite(favorites, rec) });
        loadRecords();
      },
      del: async (id, btn) => {
        // Two clicks: the first asks "Sure?", the second deletes.
        if (btn.dataset.sure !== "1") { btn.dataset.sure = "1"; btn.textContent = "Sure?"; return; }
        await setStore({ records: records.filter(r => String(r.id) !== id) });
        loadRecords();
      },
    });
  }

  async function loadFavorites() {
    const { favorites = [] } = await getStore(["favorites"]);
    document.getElementById("fav-count").textContent = `${favorites.length} favorites`;
    const listEl = document.getElementById("fav-list");
    listEl.innerHTML = favorites.length
      ? favorites.map(r => recRowHtml(r, { favorite: true, showDelete: false })).join("")
      : `<div class="empty-state">No favorites yet. Star a record to keep it here.</div>`;
    wireRows(listEl, {
      fav: async (id) => {
        await setStore({ favorites: favorites.filter(f => String(f.id) !== id) });
        loadFavorites();
      },
    });
  }

  // ─── AGENCIES ────────────────────────────────────────────────
  const orgTypeOptions = (selected) => JobGuardData.ORG_TYPES
    .map(t => `<option value="${escHtml(t)}"${t === selected ? " selected" : ""}>${escHtml(t)}</option>`).join("");

  function agencyMsg(ok, text) {
    const el = document.getElementById("ag-msg");
    el.className = `backup-msg ${ok ? "ok" : "err"}`;
    el.textContent = text;
  }

  async function loadAgencies() {
    const { agencies = [] } = await getStore(["agencies"]);
    document.getElementById("ag-count").textContent = `${agencies.length} staffing / consulting firms listed`;
    document.getElementById("ag-type-input").innerHTML = orgTypeOptions(JobGuardData.ORG_TYPES[0]);
    const listEl = document.getElementById("ag-list");
    listEl.innerHTML = agencies.length
      ? agencies.map((e, i) => `
        <div class="bl-row">
          <div class="bl-info">
            <div class="bl-name" style="color:#e2eaf4">🏢 ${escHtml(e.name)}</div>
            <div class="bl-reason-text">${escHtml([e.url, e.note].filter(Boolean).join(" · "))}</div>
          </div>
          <select class="field ag-type" data-index="${i}">${orgTypeOptions(e.type)}</select>
          <button class="rm-btn" data-index="${i}">Remove</button>
        </div>`).join("")
      : `<div class="empty-state">No firms listed yet</div>`;

    listEl.onchange = async (e) => {
      const sel = e.target.closest(".ag-type");
      if (!sel) return;
      const i = Number(sel.dataset.index);
      await setStore({ agencies: agencies.map((x, j) => j === i ? { ...x, type: sel.value } : x) });
    };
    listEl.onclick = async (e) => {
      const btn = e.target.closest(".rm-btn");
      if (!btn) return;
      const i = Number(btn.dataset.index);
      await setStore({ agencies: agencies.filter((_, j) => j !== i) });
      loadAgencies();
    };
  }

  document.getElementById("ag-add-toggle")?.addEventListener("click", () => {
    const form = document.getElementById("ag-form");
    const open = form.style.display !== "none";
    form.style.display = open ? "none" : "block";
    document.getElementById("ag-add-toggle").textContent = open ? "+ Add" : "✕ Cancel";
  });

  document.getElementById("ag-save-btn")?.addEventListener("click", async () => {
    const name = document.getElementById("ag-name-input").value.trim();
    if (!name) return;
    const { agencies = [] } = await getStore(["agencies"]);
    const entry = {
      name,
      url: document.getElementById("ag-url-input").value.trim(),
      type: document.getElementById("ag-type-input").value,
      note: document.getElementById("ag-note-input").value.trim(),
    };
    const i = agencies.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
    await setStore({ agencies: i >= 0 ? agencies.map((e, j) => j === i ? entry : e) : [...agencies, entry] });
    ["ag-name-input", "ag-url-input", "ag-note-input"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("ag-form").style.display = "none";
    document.getElementById("ag-add-toggle").textContent = "+ Add";
    loadAgencies();
  });

  document.getElementById("ag-scan-btn")?.addEventListener("click", async () => {
    const { agencies = [], records = [] } = await getStore(["agencies", "records"]);
    const r = JobGuardData.scanRecordsForAgencies(agencies, records);
    if (r.added) await setStore({ agencies: r.agencies });
    await loadAgencies();
    agencyMsg(true, r.added ? `Added ${r.added} firms found in Records.` : "No new staffing or consulting firms found in Records.");
  });

  // ─── BACKUP (export / import) ────────────────────────────────
  const BACKUP_KEYS = ["blacklist", "records", "favorites", "agencies"];

  function backupMsg(ok, text) {
    const el = document.getElementById("backup-msg");
    el.className = `backup-msg ${ok ? "ok" : "err"}`;
    el.textContent = text;
  }

  document.getElementById("export-btn")?.addEventListener("click", async () => {
    const data = await getStore(BACKUP_KEYS);
    const blob = new Blob([JobGuardData.buildBackup(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = JobGuardData.BACKUP_NAME;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    const n = (k) => (data[k] || []).length;
    backupMsg(true, `Exported ${n("blacklist")} blacklist entries, ${n("records")} records, ${n("favorites")} favorites.`);
  });

  const importFile = document.getElementById("import-file");
  document.getElementById("import-btn")?.addEventListener("click", () => importFile.click());
  importFile?.addEventListener("change", async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const incoming = JobGuardData.parseImport(await file.text());
      const { data, added } = JobGuardData.applyImport(await getStore(BACKUP_KEYS), incoming);
      await setStore(data);
      backupMsg(true, `Imported (merged, nothing deleted). Added ${added.blacklist} blacklist, ${added.records} records, ${added.favorites} favorites, ${added.agencies} agencies.`);
    } catch (err) {
      backupMsg(false, `Import failed: ${err.message}`);
    }
    importFile.value = "";
  });

  // ─── UTILS ───────────────────────────────────────────────────
  function escHtml(str) {
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str || ""));
    return d.innerHTML;
  }
});
