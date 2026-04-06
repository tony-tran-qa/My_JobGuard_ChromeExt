// lib/jobguard-core.js
//
// Pure logic extracted from background.js and content.js.
// No chrome.* API calls here — these functions are side-effect free
// and can be imported directly by Jest without any browser or extension runtime.
//
// NOTE ON TEST SETUP:
// Jest testing for a Chrome extension requires more scaffolding than a plain
// Node.js project. Specifically:
//   - jest-chrome  : mocks the chrome.* APIs (storage, runtime, contextMenus)
//   - jest.config.js : sets testEnvironment to "jsdom" so browser globals exist
// This is the standard trade-off when unit-testing MV3 extensions — the pure
// logic lives here so it can be tested without any chrome.* dependency at all.

"use strict";

/**
 * Checks whether a company name matches any entry in the blacklist.
 * Uses bidirectional substring matching (same logic as background.js).
 *
 * @param {Array<{name: string, reason: string}>} blacklist
 * @param {string} companyName
 * @returns {{name: string, reason: string}|null} matched entry or null
 */
function checkBlacklist(blacklist, companyName) {
  if (!Array.isArray(blacklist) || !companyName) return null;
  const lower = companyName.toLowerCase().trim();
  return (
    blacklist.find(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        lower.includes(e.name.toLowerCase())
    ) || null
  );
}

/**
 * Builds a normalized cache key for a company + role pair.
 * Matches the key format used in background.js vetCompany().
 *
 * @param {string} company
 * @param {string} [role]
 * @returns {string}
 */
function buildCacheKey(company, role = "") {
  return `${company}::${role}`.toLowerCase();
}

/**
 * Parses and validates a vet result object returned from the Anthropic API.
 * Returns null if the result is missing required fields.
 *
 * @param {object} raw  Parsed JSON from the API response
 * @returns {{
 *   riskLevel: string,
 *   verdict: string,
 *   redFlags: string[],
 *   greenFlags: string[],
 *   verificationSteps: string[],
 *   recommendation: string
 * }|null}
 */
function parseVetResult(raw) {
  if (!raw || typeof raw !== "object") return null;

  const validRiskLevels = ["LOW", "MEDIUM", "HIGH"];
  const validRecommendations = ["APPLY", "CAUTION", "AVOID"];

  if (!validRiskLevels.includes(raw.riskLevel)) return null;
  if (!validRecommendations.includes(raw.recommendation)) return null;
  if (typeof raw.verdict !== "string" || !raw.verdict.trim()) return null;

  return {
    riskLevel: raw.riskLevel,
    verdict: raw.verdict.trim(),
    redFlags: Array.isArray(raw.redFlags) ? raw.redFlags : [],
    greenFlags: Array.isArray(raw.greenFlags) ? raw.greenFlags : [],
    verificationSteps: Array.isArray(raw.verificationSteps)
      ? raw.verificationSteps
      : [],
    recommendation: raw.recommendation,
  };
}

/**
 * Checks whether a cached result has expired.
 * Cache TTL: 24 hours (matches background.js behaviour).
 * Boundary: a result cached exactly 24 hours ago IS considered expired (>=).
 *
 * @param {number} cachedAt  Unix timestamp (ms) from cached result
 * @param {number} [nowMs]   Current time in ms — injectable for testing
 * @returns {boolean}
 */
function isCacheExpired(cachedAt, nowMs = Date.now()) {
  const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  return nowMs - cachedAt >= TTL_MS;
}

module.exports = { checkBlacklist, buildCacheKey, parseVetResult, isCacheExpired };
