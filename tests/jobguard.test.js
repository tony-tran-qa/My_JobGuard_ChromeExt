// tests/jobguard.test.js
// Jest unit tests for JobGuard pure logic (lib/jobguard-core.js)
//
// What's tested here:
//   - checkBlacklist  : fuzzy bidirectional name matching
//   - buildCacheKey   : cache key normalisation
//   - parseVetResult  : API response validation and normalisation
//   - isCacheExpired  : 24-hour TTL logic
//
// What's NOT tested here (requires a real Chrome runtime):
//   - chrome.storage reads/writes
//   - chrome.runtime.sendMessage flows
//   - DOM injection (badges, sidebar, banners)
// Those integration paths are covered by loading the extension in Chrome
// directly. See README — Testing section for the full rationale.

"use strict";

const {
  checkBlacklist,
  buildCacheKey,
  parseVetResult,
  isCacheExpired,
} = require("../lib/jobguard-core");

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BLACKLIST = [
  { name: "TechHire Global", reason: "Known phishing recruiter" },
  { name: "RemoteWork Pro", reason: "Fake job listings" },
  { name: "QuickHire Solutions", reason: "Requests payment for training" },
];

const VALID_VET_RESULT = {
  riskLevel: "HIGH",
  verdict: "Company shows multiple hallmarks of a recruitment scam.",
  redFlags: ["No verifiable web presence", "Requests personal info upfront"],
  greenFlags: [],
  verificationSteps: ["Search LinkedIn", "Check Glassdoor", "Verify domain age"],
  recommendation: "AVOID",
};

// ─── checkBlacklist ─────────────────────────────────────────────────────────

describe("checkBlacklist", () => {
  test("returns matching entry on exact name match", () => {
    const result = checkBlacklist(BLACKLIST, "TechHire Global");
    expect(result).not.toBeNull();
    expect(result.name).toBe("TechHire Global");
  });

  test("match is case-insensitive", () => {
    expect(checkBlacklist(BLACKLIST, "teckhire global")).toBeNull(); // typo — should not match
    expect(checkBlacklist(BLACKLIST, "TECHHIRE GLOBAL")).not.toBeNull();
    expect(checkBlacklist(BLACKLIST, "remotework pro")).not.toBeNull();
  });

  test("returns null when company is not in blacklist", () => {
    expect(checkBlacklist(BLACKLIST, "Google")).toBeNull();
    expect(checkBlacklist(BLACKLIST, "Shopify")).toBeNull();
  });

  test("bidirectional match — query is substring of blacklisted name", () => {
    // "TechHire" is contained within "TechHire Global"
    const result = checkBlacklist(BLACKLIST, "TechHire");
    expect(result).not.toBeNull();
    expect(result.name).toBe("TechHire Global");
  });

  test("bidirectional match — blacklisted name is substring of query", () => {
    // query "QuickHire Solutions Canada" contains blacklisted "QuickHire Solutions"
    const result = checkBlacklist(BLACKLIST, "QuickHire Solutions Canada");
    expect(result).not.toBeNull();
    expect(result.name).toBe("QuickHire Solutions");
  });

  test("returns first match when multiple entries could match", () => {
    const list = [
      { name: "Acme", reason: "First" },
      { name: "Acme Corp", reason: "Second" },
    ];
    const result = checkBlacklist(list, "Acme Corp");
    // "Acme" is substring of "acme corp" — first entry wins
    expect(result.reason).toBe("First");
  });

  test("returns null for empty blacklist", () => {
    expect(checkBlacklist([], "TechHire Global")).toBeNull();
  });

  test("returns null for null/undefined company name", () => {
    expect(checkBlacklist(BLACKLIST, null)).toBeNull();
    expect(checkBlacklist(BLACKLIST, undefined)).toBeNull();
    expect(checkBlacklist(BLACKLIST, "")).toBeNull();
  });

  test("returns null when blacklist is not an array", () => {
    expect(checkBlacklist(null, "TechHire Global")).toBeNull();
    expect(checkBlacklist(undefined, "TechHire Global")).toBeNull();
  });

  test("trims whitespace from company name before matching", () => {
    expect(checkBlacklist(BLACKLIST, "  TechHire Global  ")).not.toBeNull();
  });
});

// ─── buildCacheKey ──────────────────────────────────────────────────────────

describe("buildCacheKey", () => {
  test("returns lowercased company::role string", () => {
    expect(buildCacheKey("Google", "SWE")).toBe("google::swe");
  });

  test("role defaults to empty string when omitted", () => {
    expect(buildCacheKey("Google")).toBe("google::");
  });

  test("normalises to lowercase", () => {
    expect(buildCacheKey("TechHire Global", "QA Lead")).toBe(
      "techhire global::qa lead"
    );
  });

  test("same company + role always produces same key", () => {
    const k1 = buildCacheKey("Shopify", "Dev");
    const k2 = buildCacheKey("Shopify", "Dev");
    expect(k1).toBe(k2);
  });

  test("different roles produce different keys for same company", () => {
    expect(buildCacheKey("Ford", "QA")).not.toBe(buildCacheKey("Ford", "SWE"));
  });
});

// ─── parseVetResult ─────────────────────────────────────────────────────────

describe("parseVetResult", () => {
  test("returns structured result for a valid API response", () => {
    const result = parseVetResult(VALID_VET_RESULT);
    expect(result).not.toBeNull();
    expect(result.riskLevel).toBe("HIGH");
    expect(result.recommendation).toBe("AVOID");
    expect(result.verdict).toBe(
      "Company shows multiple hallmarks of a recruitment scam."
    );
  });

  test("accepts all valid riskLevel values", () => {
    ["LOW", "MEDIUM", "HIGH"].forEach((level) => {
      const r = parseVetResult({ ...VALID_VET_RESULT, riskLevel: level });
      expect(r).not.toBeNull();
      expect(r.riskLevel).toBe(level);
    });
  });

  test("accepts all valid recommendation values", () => {
    ["APPLY", "CAUTION", "AVOID"].forEach((rec) => {
      const r = parseVetResult({ ...VALID_VET_RESULT, recommendation: rec });
      expect(r).not.toBeNull();
      expect(r.recommendation).toBe(rec);
    });
  });

  test("returns null for invalid riskLevel", () => {
    expect(
      parseVetResult({ ...VALID_VET_RESULT, riskLevel: "UNKNOWN" })
    ).toBeNull();
    expect(
      parseVetResult({ ...VALID_VET_RESULT, riskLevel: "" })
    ).toBeNull();
  });

  test("returns null for invalid recommendation", () => {
    expect(
      parseVetResult({ ...VALID_VET_RESULT, recommendation: "MAYBE" })
    ).toBeNull();
  });

  test("returns null for missing or blank verdict", () => {
    expect(parseVetResult({ ...VALID_VET_RESULT, verdict: "" })).toBeNull();
    expect(parseVetResult({ ...VALID_VET_RESULT, verdict: "   " })).toBeNull();
    expect(
      parseVetResult({ ...VALID_VET_RESULT, verdict: undefined })
    ).toBeNull();
  });

  test("defaults missing flag arrays to empty arrays", () => {
    const r = parseVetResult({
      ...VALID_VET_RESULT,
      redFlags: undefined,
      greenFlags: null,
      verificationSteps: undefined,
    });
    expect(r.redFlags).toEqual([]);
    expect(r.greenFlags).toEqual([]);
    expect(r.verificationSteps).toEqual([]);
  });

  test("trims whitespace from verdict", () => {
    const r = parseVetResult({ ...VALID_VET_RESULT, verdict: "  Looks legit.  " });
    expect(r.verdict).toBe("Looks legit.");
  });

  test("returns null for null or non-object input", () => {
    expect(parseVetResult(null)).toBeNull();
    expect(parseVetResult(undefined)).toBeNull();
    expect(parseVetResult("string")).toBeNull();
    expect(parseVetResult(42)).toBeNull();
  });
});

// ─── isCacheExpired ─────────────────────────────────────────────────────────

describe("isCacheExpired", () => {
  const ONE_HOUR = 60 * 60 * 1000;
  const NOW = Date.now();

  test("returns false for a result cached 1 hour ago", () => {
    expect(isCacheExpired(NOW - ONE_HOUR, NOW)).toBe(false);
  });

  test("returns false for a result cached 23 hours ago", () => {
    expect(isCacheExpired(NOW - 23 * ONE_HOUR, NOW)).toBe(false);
  });

  test("returns true for a result cached exactly 24 hours ago", () => {
    expect(isCacheExpired(NOW - 24 * ONE_HOUR, NOW)).toBe(true);
  });

  test("returns true for a result cached 48 hours ago", () => {
    expect(isCacheExpired(NOW - 48 * ONE_HOUR, NOW)).toBe(true);
  });

  test("uses Date.now() by default when nowMs is not provided", () => {
    const freshTimestamp = Date.now() - ONE_HOUR;
    expect(isCacheExpired(freshTimestamp)).toBe(false);
  });
});
