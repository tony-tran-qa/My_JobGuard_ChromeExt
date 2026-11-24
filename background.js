// JobGuard Background Service Worker
// Handles AI vetting API calls and context menu

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
    vetCompany(message.company, message.role)
      .then(result => sendResponse({ success: true, result }))
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

function checkBlacklist(blacklist, name) {
  const lower = name.toLowerCase().trim();
  return blacklist.find(e =>
    e.name.toLowerCase().includes(lower) ||
    lower.includes(e.name.toLowerCase())
  ) || null;
}

async function vetCompany(company, role = "") {
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
    chrome.storage.local.get(["apiKey"], r => resolve(r.apiKey || ""));
  });

  if (!apiKey) {
    throw new Error("No API key set. Please add your Anthropic API key in JobGuard settings.");
  }

  const prompt = `You are a job scam detection expert. Analyze this company${role ? ` and role` : ""} for potential fraud on LinkedIn.

Company: "${company}"${role ? `\nRole: "${role}"` : ""}

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "verdict": "one sentence summary under 20 words",
  "redFlags": ["up to 3 short flags"],
  "greenFlags": ["up to 3 short flags"],
  "verificationSteps": ["3 actionable steps"],
  "recommendation": "APPLY" | "CAUTION" | "AVOID"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "API request failed");
  }

  const data = await response.json();
  const text = data.content?.map(b => b.text || "").join("") || "";
  const clean = text.replace(/```json|```/g, "").trim();
  const result = JSON.parse(clean);

  // Cache it for 24 hours
  const newCache = { ...cached };
  newCache[cacheKey] = { ...result, cachedAt: Date.now() };
  // Limit cache to 100 entries
  const keys = Object.keys(newCache);
  if (keys.length > 100) delete newCache[keys[0]];
  chrome.storage.local.set({ vetCache: newCache });

  return result;
}
