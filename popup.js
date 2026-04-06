// JobGuard Popup Script

document.addEventListener("DOMContentLoaded", () => {
  // ─── TAB SWITCHING ───────────────────────────────────────────
  const tabs = document.querySelectorAll(".tab");
  const tabPanels = {
    vet: document.getElementById("tab-vet"),
    blacklist: document.getElementById("tab-blacklist"),
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

  // ─── UTILS ───────────────────────────────────────────────────
  function escHtml(str) {
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str || ""));
    return d.innerHTML;
  }
});
