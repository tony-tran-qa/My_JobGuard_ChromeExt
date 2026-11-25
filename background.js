// JobGuard Background Service Worker
// Handles AI vetting API calls and context menu

/* global importScripts, JobGuardData */
importScripts("lib/jobguard-data.js");

const DEFAULT_BLACKLIST = [
  { name: "TechHire Global", reason: "Known phishing recruiter, requests SSN upfront" },
  { name: "RemoteWork Pro", reason: "Fake job listings, data harvesting" },
  { name: "QuickHire Solutions", reason: "Requests payment for training materials" },
  { name: "GlobalTalent Connect", reason: "Identity theft scam" },
  { name: "FastTrack Careers", reason: "Impersonates real companies, fake interview process" },
];

// Initialize storage with defaults
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["blacklist", "apiKey", "vetCache"], (result) => {
    if (!result.blacklist) {
      chrome.storage.local.set({ blacklist: DEFAULT_BLACKLIST });
    }
    if (!result.vetCache) {
      chrome.storage.local.set({ vetCache: {} });
    }
  });

  // Context menu for right-click blacklisting
  chrome.contextMenus.create({
    id: "addToBlacklist",
    title: "🚫 Add to JobGuard Blacklist",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "vetCompany",
    title: "🔍 Vet this company with JobGuard",
    contexts: ["selection"],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  if (info.menuItemId === "addToBlacklist") {
    chrome.storage.local.get(["blacklist"], (result) => {
      const blacklist = result.blacklist || [];
      const exists = blacklist.some(e => e.name.toLowerCase() === selectedText.toLowerCase());
      if (!exists) {
        blacklist.push({ name: selectedText, reason: "Manually flagged via right-click" });
        chrome.storage.local.set({ blacklist });
        chrome.tabs.sendMessage(tab.id, {
          type: "BLACKLIST_ADDED",
          company: selectedText,
        });
      }
    });
  }

  if (info.menuItemId === "vetCompany") {
    chrome.tabs.sendMessage(tab.id, {
      type: "VET_FROM_CONTEXT",
      company: selectedText,
    });
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "VET_COMPANY") {
    vetCompany(message.company, message.role, message.url)
      .then(async result => {
        await saveRecord(message.company, message.role, { ...result, url: message.url || "" });
        sendResponse({ success: true, result });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }

  if (message.type === "CHECK_BLACKLIST") {
    chrome.storage.local.get(["blacklist"], (result) => {
      const blacklist = result.blacklist || [];
      const hit = checkBlacklist(blacklist, message.company);
      sendResponse({ hit });
    });
    return true;
  }

  if (message.type === "GET_BLACKLIST") {
    chrome.storage.local.get(["blacklist"], (result) => {
      sendResponse({ blacklist: result.blacklist || [] });
    });
    return true;
  }

  if (message.type === "ADD_TO_BLACKLIST") {
    chrome.storage.local.get(["blacklist"], (result) => {
      const blacklist = result.blacklist || [];
      const exists = blacklist.some(e => e.name.toLowerCase() === message.entry.name.toLowerCase());
      if (!exists) {
        blacklist.push(message.entry);
        chrome.storage.local.set({ blacklist });
        sendResponse({ success: true, blacklist });
      } else {
        sendResponse({ success: false, error: "Already in blacklist" });
      }
    });
    return true;
  }

  if (message.type === "REMOVE_FROM_BLACKLIST") {
    chrome.storage.local.get(["blacklist"], (result) => {
      const blacklist = (result.blacklist || []).filter((_, i) => i !== message.index);
      chrome.storage.local.set({ blacklist });
      sendResponse({ success: true, blacklist });
    });
    return true;
  }

  if (message.type === "SAVE_API_KEY") {
    chrome.storage.local.set({ apiKey: message.apiKey });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "GET_API_KEY") {
    chrome.storage.local.get(["apiKey"], (result) => {
      sendResponse({ apiKey: result.apiKey || "" });
    });
    return true;
  }
});

// Keep a record of every successful vet so the Records tab (and backups) have it.
function saveRecord(company, role, result) {
  return new Promise(resolve => {
    chrome.storage.local.get(["records", "agencies"], r => {
      const record = JobGuardData.buildRecord(company, role, result);
      const update = { records: JobGuardData.upsertRecord(r.records, record) };
      // Staffing and IT consulting firms are added to the Agencies list automatically.
      const type = JobGuardData.inferOrgType(record.companyType, record.orgType);
      if (type) update.agencies = JobGuardData.addAgencyIfNew(r.agencies, company, type);
      chrome.storage.local.set(update, resolve);
    });
  });
}

function checkBlacklist(blacklist, name) {
  const lower = name.toLowerCase().trim();
  return blacklist.find(e =>
    e.name.toLowerCase().includes(lower) ||
    lower.includes(e.name.toLowerCase())
  ) || null;
}

async function vetCompany(company, role = "", url = "") {
  // Check cache first
  const cacheKey = `${company}::${role}`.toLowerCase();
  const cached = await new Promise(resolve => {
    chrome.storage.local.get(["vetCache"], r => resolve(r.vetCache || {}));
  });

  if (cached[cacheKey]) {
    return { ...cached[cacheKey], fromCache: true };
  }

  // Get API key
  const apiKey = await new Promise(resolve => {
    chrome.storage.local.get(["apiKey"], r => resolve((r.apiKey || "").trim()));
  });

  if (!apiKey) {
    throw new Error("No API key set. Please add your Anthropic API key in JobGuard settings.");
  }
  if (!apiKey.startsWith("sk-")) {
    throw new Error('API key format is wrong (should start with "sk-ant-"). Fix it in Settings.');
  }

  const urlContext = url ? `\nHomepage URL: "${url}"` : "";
  const prompt = `You are a company intelligence and job scam detection expert. Analyze this company${role ? " and role" : ""} thoroughly.

Company: "${company}"${role ? `\nRole: "${role}"` : ""}${urlContext}

Reply with ONLY raw JSON (no markdown fences, no extra text):
{
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "recommendation": "APPLY" | "CAUTION" | "AVOID",
  "verdict": "one concise sentence summarizing legitimacy",
  "redFlags": ["up to 3 specific red flags"],
  "greenFlags": ["up to 3 specific green flags"],
  "verificationSteps": ["step1", "step2", "step3"],
  "companyType": "e.g. Software / SaaS, Staffing Agency, Financial Services, Healthcare, Retail, Manufacturing, Consulting, etc.",
  "orgType": "Staffing / Recruiter" | "IT Consulting" | "Other",
  "ownership": "Public" | "Private" | "Non-Profit" | "Government" | "Unknown",
  "headcount": "e.g. 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5001-10000, 10000+, or Unknown",
  "annualRevenue": "e.g. <$1M, $1M-$10M, $10M-$50M, $50M-$200M, $200M-$1B, $1B-$10B, $10B+, or Unknown",
  "founded": "year founded or Unknown",
  "headquarters": "City, Country or Unknown",
  "website": "the company's official homepage domain if you know it, e.g. anthropic.com, otherwise Unknown",
  "confidenceNote": "brief note on data confidence, e.g. Well-known public company, data reliable or Limited public info, estimates only"
}

orgType: use "Staffing / Recruiter" for a staffing agency, recruiting or headhunting firm, or contract workforce provider (including IT staffing firms such as Procom or Robert Half). Use "IT Consulting" for an IT consulting, IT services or systems integration firm that is not mainly a staffing firm. Use "Other" for everything else.
For well-known companies (Google, Microsoft, Anthropic, etc.) use accurate known data.
For obscure or likely fake companies, use Unknown for financial fields and note low confidence.
headcount and annualRevenue should be ranges, not exact figures.${url ? "\nIf a Homepage URL is provided, use the domain to help identify and verify the company. A mismatched or suspicious domain (e.g. typosquatting, free hosting) should be flagged as a red flag." : ""}
You have no internet access and cannot search. Base your judgment only on the company name, role, and URL given plus your own training knowledge. Never write that a company is missing from, unregistered in, or unverifiable in any database, registry, directory, search engine, LinkedIn, or Glassdoor. If you do not know a company, say only that you do not recognize it.
Not recognizing a company is NOT evidence of fraud. If you do not recognize the company and the role and URL show no concrete scam signals, use riskLevel MEDIUM and recommendation CAUTION, and say it is unverified.
These are concrete scam signals, and any ONE of them requires riskLevel HIGH and recommendation AVOID, even if the company is unknown: (1) a role that involves receiving, holding, transferring, or processing money, payments, or checks for the employer; (2) receiving and reshipping packages; (3) vague remote data-entry or clerical work offered by a generic, unidentifiable company; (4) mystery shopping; (5) trading or managing cryptocurrency on someone's behalf; (6) impersonating a government agency or a well-known brand, including a lookalike, typosquatted, cheap-TLD, or free-hosting domain.
If you list a red flag that matches one of these signals, your recommendation must be AVOID, not CAUTION.`;

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) {
    throw new Error(`Network error: ${e.message}`);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("API key rejected (401). Re-copy it from console.anthropic.com.");
    }
    if (response.status === 429) throw new Error("Rate limited. Wait a moment and try again.");
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API request failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The AI reply had no JSON. Try again.");
  let result;
  try { result = JSON.parse(match[0]); } catch (e) { throw new Error("The AI reply could not be read. Try again."); }

  // Safe defaults so a short or odd reply never breaks the popup
  if (!["LOW", "MEDIUM", "HIGH"].includes(result.riskLevel)) result.riskLevel = "MEDIUM";
  if (!["APPLY", "CAUTION", "AVOID"].includes(result.recommendation)) result.recommendation = "CAUTION";
  if (!["Public", "Private", "Non-Profit", "Government", "Unknown"].includes(result.ownership)) result.ownership = "Unknown";
  for (const k of ["redFlags", "greenFlags", "verificationSteps"]) {
    result[k] = Array.isArray(result[k]) ? result[k] : [];
  }
  for (const k of ["companyType", "headcount", "annualRevenue", "founded", "headquarters"]) {
    result[k] = result[k] || "Unknown";
  }
  result.website = result.website || "Unknown";
  result.confidenceNote = result.confidenceNote || "";
  result.verdict = result.verdict || "";

  // Cache it (limit 100 entries)
  const newCache = { ...cached };
  newCache[cacheKey] = { ...result, cachedAt: Date.now() };
  const keys = Object.keys(newCache);
  if (keys.length > 100) delete newCache[keys[0]];
  chrome.storage.local.set({ vetCache: newCache });

  return result;
}
