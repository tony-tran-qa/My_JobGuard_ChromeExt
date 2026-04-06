// JobGuard Content Script
// Runs on LinkedIn pages, injects warning badges and sidebar panel

(function () {
  "use strict";

  let blacklist = [];
  let scannedCompanies = new Set();

  // Load blacklist on start
  chrome.runtime.sendMessage({ type: "GET_BLACKLIST" }, (res) => {
    blacklist = res?.blacklist || [];
    scanPage();
  });

  // Listen for storage changes (blacklist updated in popup)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.blacklist) {
      blacklist = changes.blacklist.newValue || [];
      scannedCompanies.clear();
      scanPage();
    }
  });

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "BLACKLIST_ADDED") {
      showToast(`🚫 "${message.company}" added to blacklist`, "danger");
      blacklist.push({ name: message.company, reason: "Manually flagged" });
      scannedCompanies.clear();
      scanPage();
    }
    if (message.type === "VET_FROM_CONTEXT") {
      openSidebar(message.company, "");
    }
  });

  // Main scanner - finds company names on LinkedIn and badges them
  function scanPage() {
    const url = window.location.href;

    if (url.includes("/jobs/")) {
      scanJobListings();
      scanJobDetailPage();
    } else if (url.includes("/company/")) {
      scanCompanyPage();
    } else {
      scanJobListings();
    }
  }

  function scanJobListings() {
    // Job cards in search results
    const selectors = [
      ".job-card-container",
      ".jobs-search-results__list-item",
      ".scaffold-layout__list-item",
      "[data-job-id]",
    ];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(card => {
        if (card.dataset.jobguardScanned) return;
        card.dataset.jobguardScanned = "1";

        const companyEl = card.querySelector(
          ".job-card-container__primary-description, " +
          ".artdeco-entity-lockup__subtitle, " +
          ".job-card-list__company-name, " +
          "[data-tracking-control-name='public_jobs_jserp-result_job-search-card-subtitle']"
        );

        if (companyEl) {
          const companyName = companyEl.textContent?.trim();
          if (companyName) {
            injectBadgeOnCard(card, companyEl, companyName);
          }
        }
      });
    });
  }

  function scanJobDetailPage() {
    // Job detail panel / full page
    const companySelectors = [
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
      ".job-details-jobs-unified-top-card__primary-description-without-tagline a",
    ];

    companySelectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el && !el.dataset.jobguardScanned) {
        el.dataset.jobguardScanned = "1";
        const companyName = el.textContent?.trim();
        if (companyName) {
          injectDetailBanner(companyName);
          injectVetButton(companyName);
        }
      }
    });
  }

  function scanCompanyPage() {
    const nameSelectors = [
      ".org-top-card-summary__title",
      "h1.org-top-card-summary__title",
      ".ember-view h1",
    ];

    nameSelectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el && !el.dataset.jobguardScanned) {
        el.dataset.jobguardScanned = "1";
        const companyName = el.textContent?.trim();
        if (companyName) {
          injectDetailBanner(companyName);
          injectVetButton(companyName);
        }
      }
    });
  }

  function injectBadgeOnCard(card, companyEl, companyName) {
    const hit = checkBlacklistLocal(companyName);
    if (!hit && scannedCompanies.has(companyName.toLowerCase())) return;
    scannedCompanies.add(companyName.toLowerCase());

    // Remove existing badge
    card.querySelector(".jg-badge")?.remove();

    const badge = document.createElement("span");
    badge.className = "jg-badge";

    if (hit) {
      badge.className += " jg-badge--danger";
      badge.textContent = "🚫 BLACKLISTED";
      badge.title = `JobGuard: ${hit.reason}`;
      // Add red overlay to card
      card.style.outline = "2px solid #ef4444";
      card.style.outlineOffset = "-2px";
    } else {
      badge.className += " jg-badge--neutral";
      badge.textContent = "⬡ VET";
      badge.title = "Click to vet this company with JobGuard";
      badge.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSidebar(companyName, "");
      });
    }

    companyEl.parentNode.insertBefore(badge, companyEl.nextSibling);
  }

  function injectDetailBanner(companyName) {
    const existingBanner = document.getElementById("jg-detail-banner");
    existingBanner?.remove();

    const hit = checkBlacklistLocal(companyName);
    if (!hit) return;

    const banner = document.createElement("div");
    banner.id = "jg-detail-banner";
    banner.innerHTML = `
      <div class="jg-banner-inner">
        <span class="jg-banner-icon">🚫</span>
        <div class="jg-banner-text">
          <strong>BLACKLISTED COMPANY — DO NOT APPLY</strong>
          <span>${hit.reason}</span>
        </div>
        <button class="jg-banner-close" id="jg-banner-close-btn">✕</button>
      </div>
    `;

    document.body.prepend(banner);
    document.getElementById("jg-banner-close-btn")?.addEventListener("click", () => banner.remove());
  }

  function injectVetButton(companyName) {
    const existing = document.getElementById("jg-vet-btn");
    existing?.remove();

    const btn = document.createElement("button");
    btn.id = "jg-vet-btn";
    btn.innerHTML = `<span>⬡</span> JobGuard Vet`;
    btn.addEventListener("click", () => openSidebar(companyName, ""));

    // Try to insert near apply button
    const applyBtn = document.querySelector(
      ".jobs-apply-button, .jobs-unified-top-card__apply-button, .topcard__btn-topcard"
    );
    if (applyBtn) {
      applyBtn.parentNode.insertBefore(btn, applyBtn.nextSibling);
    } else {
      document.body.appendChild(btn);
    }
  }

  // ─── SIDEBAR ────────────────────────────────────────────────────
  function openSidebar(company, role) {
    closeSidebar();

    const overlay = document.createElement("div");
    overlay.id = "jg-overlay";
    overlay.addEventListener("click", closeSidebar);

    const sidebar = document.createElement("div");
    sidebar.id = "jg-sidebar";
    sidebar.innerHTML = `
      <div id="jg-sidebar-header">
        <div id="jg-sidebar-title"><span class="jg-logo-text">JOB</span>GUARD</div>
        <button id="jg-sidebar-close">✕</button>
      </div>
      <div id="jg-sidebar-body">
        <div id="jg-sidebar-company-row">
          <input id="jg-company-input" type="text" placeholder="Company name..." value="${escapeHtml(company)}" />
          <input id="jg-role-input" type="text" placeholder="Role (optional)..." value="${escapeHtml(role)}" />
          <button id="jg-run-btn">▶ Vet</button>
        </div>
        <div id="jg-sidebar-result">
          <div class="jg-idle-state">
            <div class="jg-idle-icon">⬡</div>
            <div>Enter a company name and click Vet</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sidebar);

    document.getElementById("jg-sidebar-close").addEventListener("click", closeSidebar);
    document.getElementById("jg-run-btn").addEventListener("click", runVet);

    // Allow Enter key
    ["jg-company-input", "jg-role-input"].forEach(id => {
      document.getElementById(id)?.addEventListener("keydown", e => {
        if (e.key === "Enter") runVet();
      });
    });

    // Auto-run if company provided
    if (company) {
      setTimeout(runVet, 100);
    }
  }

  function closeSidebar() {
    document.getElementById("jg-overlay")?.remove();
    document.getElementById("jg-sidebar")?.remove();
  }

  function runVet() {
    const company = document.getElementById("jg-company-input")?.value?.trim();
    const role = document.getElementById("jg-role-input")?.value?.trim();
    const resultEl = document.getElementById("jg-sidebar-result");
    if (!company || !resultEl) return;

    // Check blacklist first
    const hit = checkBlacklistLocal(company);
    if (hit) {
      resultEl.innerHTML = `
        <div class="jg-result jg-result--danger">
          <div class="jg-result-header">
            <span class="jg-risk-badge jg-risk--high">🚫 BLACKLISTED</span>
          </div>
          <div class="jg-verdict">Do not apply — this company is in your blacklist.</div>
          <div class="jg-reason-box">
            <div class="jg-section-label">REASON FLAGGED</div>
            <div>${escapeHtml(hit.reason)}</div>
          </div>
        </div>
      `;
      return;
    }

    // Show loading
    resultEl.innerHTML = `
      <div class="jg-loading">
        <div class="jg-spinner"></div>
        <div>Analyzing with AI...</div>
      </div>
    `;

    chrome.runtime.sendMessage({ type: "VET_COMPANY", company, role }, (res) => {
      if (!res?.success) {
        resultEl.innerHTML = `
          <div class="jg-error">
            <div>⚠ ${escapeHtml(res?.error || "Analysis failed")}</div>
            ${res?.error?.includes("API key") ? `<div class="jg-error-hint">Click the JobGuard extension icon to add your API key.</div>` : ""}
          </div>
        `;
        return;
      }

      const r = res.result;
      const riskClass = { LOW: "jg-risk--low", MEDIUM: "jg-risk--medium", HIGH: "jg-risk--high" }[r.riskLevel] || "jg-risk--medium";
      const recIcon = { APPLY: "✓", CAUTION: "⚠", AVOID: "✕" }[r.recommendation] || "?";
      const recClass = { APPLY: "jg-rec--apply", CAUTION: "jg-rec--caution", AVOID: "jg-rec--avoid" }[r.recommendation] || "";

      resultEl.innerHTML = `
        <div class="jg-result">
          <div class="jg-result-header">
            <span class="jg-risk-badge ${riskClass}">${r.riskLevel} RISK</span>
            <span class="jg-rec-badge ${recClass}">${recIcon} ${r.recommendation}</span>
          </div>
          <div class="jg-verdict">${escapeHtml(r.verdict)}</div>

          <div class="jg-flags-grid">
            <div class="jg-flags-col">
              <div class="jg-section-label jg-label--red">🚩 RED FLAGS</div>
              ${(r.redFlags || []).map(f => `<div class="jg-flag jg-flag--red">${escapeHtml(f)}</div>`).join("") || '<div class="jg-empty">None found</div>'}
            </div>
            <div class="jg-flags-col">
              <div class="jg-section-label jg-label--green">✓ GREEN FLAGS</div>
              ${(r.greenFlags || []).map(f => `<div class="jg-flag jg-flag--green">${escapeHtml(f)}</div>`).join("") || '<div class="jg-empty">None found</div>'}
            </div>
          </div>

          <div class="jg-section-label" style="margin-top:12px">🔍 VERIFY BEFORE APPLYING</div>
          ${(r.verificationSteps || []).map((s, i) => `
            <div class="jg-step"><span class="jg-step-num">${i + 1}</span>${escapeHtml(s)}</div>
          `).join("")}

          <div class="jg-actions">
            <button class="jg-action-btn jg-action--blacklist" id="jg-add-bl-btn">+ Add to Blacklist</button>
          </div>
          ${r.fromCache ? `<div class="jg-cache-note">⬡ Cached result</div>` : ""}
        </div>
      `;

      document.getElementById("jg-add-bl-btn")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({
          type: "ADD_TO_BLACKLIST",
          entry: { name: company, reason: r.verdict },
        }, (res) => {
          if (res?.success) {
            showToast(`🚫 "${company}" added to blacklist`, "danger");
            closeSidebar();
          }
        });
      });
    });
  }

  function checkBlacklistLocal(name) {
    const lower = name.toLowerCase().trim();
    return blacklist.find(e =>
      e.name.toLowerCase().includes(lower) ||
      lower.includes(e.name.toLowerCase())
    ) || null;
  }

  function showToast(message, type = "info") {
    const existing = document.getElementById("jg-toast");
    existing?.remove();

    const toast = document.createElement("div");
    toast.id = "jg-toast";
    toast.className = `jg-toast jg-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("jg-toast--visible"), 10);
    setTimeout(() => {
      toast.classList.remove("jg-toast--visible");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str || ""));
    return d.innerHTML;
  }

  // Observe DOM changes for dynamic LinkedIn content
  const observer = new MutationObserver(() => {
    scanPage();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Re-scan on LinkedIn's client-side navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      scannedCompanies.clear();
      document.getElementById("jg-detail-banner")?.remove();
      document.getElementById("jg-vet-btn")?.remove();
      setTimeout(scanPage, 800);
    }
  }).observe(document, { subtree: true, childList: true });

})();
