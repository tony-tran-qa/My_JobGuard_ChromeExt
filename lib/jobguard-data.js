// lib/jobguard-data.js
//
// Pure data helpers for JobGuard records, favorites and backups.
// No chrome.* calls, so Jest can import this directly.
//
// The backup format is shared with the JobGuard React web app:
//   { app: "jobguard", version: 1, exportedAt, blacklist, records, favorites, agencies }
// Imports only ever MERGE. Nothing already stored is deleted.
//
// Loaded three ways:
//   - Jest (CommonJS)            -> module.exports
//   - popup.html (<script>)      -> window.JobGuardData
//   - background.js (importScripts) -> self.JobGuardData

"use strict";

(function (root) {
  const BACKUP_APP = "jobguard";
  const BACKUP_VERSION = 1;
  const BACKUP_NAME = "jobguard-all-records.json";
  const ORG_TYPES = ["Staffing / Recruiter", "IT Consulting"];

  const isName = (e) => e && typeof e.name === "string" && e.name.trim();

  /** Keep only valid blacklist entries, normalised to {name, reason}. */
  function cleanBlacklist(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isName).map((e) => ({
      name: e.name.trim(),
      reason: typeof e.reason === "string" ? e.reason : "Imported",
    }));
  }

  /** Keep only valid agency entries, normalised to {name, url, type, note}. */
  function cleanAgencies(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(isName).map((e) => ({
      name: e.name.trim(),
      url: typeof e.url === "string" ? e.url : "",
      type: ORG_TYPES.includes(e.type) ? e.type : ORG_TYPES[0],
      note: typeof e.note === "string" ? e.note : "",
    }));
  }

  /** Keep only entries that look like records/favorites (company + id). */
  function cleanEntries(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e) => e && typeof e.company === "string" && e.id != null
    );
  }

  /** Merge by case-insensitive name. Existing entries win; nothing is removed. */
  function mergeByName(current, incoming) {
    const base = Array.isArray(current) ? current : [];
    const have = new Set(base.map((e) => e.name.toLowerCase()));
    const added = [];
    for (const e of incoming || []) {
      const key = e.name.toLowerCase();
      if (!have.has(key)) {
        have.add(key);
        added.push(e);
      }
    }
    return { merged: [...base, ...added], added: added.length };
  }

  /** Merge by id. Existing entries win; nothing is removed. */
  function mergeById(current, incoming) {
    const base = Array.isArray(current) ? current : [];
    const have = new Set(base.map((e) => e.id));
    const added = [];
    for (const e of incoming || []) {
      if (!have.has(e.id)) {
        have.add(e.id);
        added.push(e);
      }
    }
    return { merged: [...base, ...added], added: added.length };
  }

  const byNewest = (a, b) => (b.ts || 0) - (a.ts || 0);

  /** Serialise everything to the shared backup JSON. */
  function buildBackup(data, now = new Date()) {
    const d = data || {};
    return JSON.stringify(
      {
        app: BACKUP_APP,
        version: BACKUP_VERSION,
        exportedAt: now.toISOString(),
        blacklist: Array.isArray(d.blacklist) ? d.blacklist : [],
        records: Array.isArray(d.records) ? d.records : [],
        favorites: Array.isArray(d.favorites) ? d.favorites : [],
        agencies: Array.isArray(d.agencies) ? d.agencies : [],
      },
      null,
      2
    );
  }

  /**
   * Parse an import file. Accepts a full backup, or a plain blacklist array
   * (the React app's per-tab blacklist export). Throws on anything else.
   * @returns {{blacklist: Array, records: Array, favorites: Array, agencies: Array}}
   */
  function parseImport(text) {
    const d = JSON.parse(text);
    if (Array.isArray(d)) {
      const blacklist = cleanBlacklist(d);
      if (d.length && !blacklist.length)
        throw new Error("No blacklist entries found in this file.");
      return { blacklist, records: [], favorites: [], agencies: [] };
    }
    if (!d || d.app !== BACKUP_APP || !Array.isArray(d.blacklist))
      throw new Error("Not a JobGuard backup file.");
    return {
      blacklist: cleanBlacklist(d.blacklist),
      records: cleanEntries(d.records),
      favorites: cleanEntries(d.favorites),
      agencies: cleanAgencies(d.agencies),
    };
  }

  /** Merge parsed import data into the current stored data. Never deletes. */
  function applyImport(current, incoming) {
    const c = current || {};
    const bl = mergeByName(c.blacklist, incoming.blacklist);
    const rec = mergeById(c.records, incoming.records);
    const fav = mergeById(c.favorites, incoming.favorites);
    const ag = mergeByName(c.agencies, incoming.agencies);
    return {
      data: {
        blacklist: bl.merged,
        records: rec.merged.sort(byNewest),
        favorites: fav.merged,
        agencies: ag.merged,
      },
      added: {
        blacklist: bl.added,
        records: rec.added,
        favorites: fav.added,
        agencies: ag.added,
      },
    };
  }

  /** Build a record from a vet result, in the same shape as the web app. */
  function buildRecord(company, role, result, now = Date.now()) {
    const r = result || {};
    return {
      id: now,
      ts: now,
      company: String(company || "").trim(),
      role: String(role || "").trim(),
      riskLevel: r.riskLevel,
      recommendation: r.recommendation,
      verdict: r.verdict,
      redFlags: r.redFlags || [],
      greenFlags: r.greenFlags || [],
      verificationSteps: r.verificationSteps || [],
      companyType: r.companyType,
      orgType: r.orgType,
      fromCache: !!r.fromCache,
    };
  }

  /**
   * Insert a record, or replace the existing one for the same company + role
   * (keeping its id and first-vetted time). Newest first.
   */
  function upsertRecord(records, record) {
    const list = Array.isArray(records) ? [...records] : [];
    const idx = list.findIndex(
      (r) =>
        r.company.toLowerCase() === record.company.toLowerCase() &&
        (r.role || "").toLowerCase() === (record.role || "").toLowerCase()
    );
    if (idx >= 0) {
      list[idx] = {
        ...record,
        id: list[idx].id,
        firstVetted: list[idx].firstVetted || list[idx].ts,
      };
    } else {
      list.push(record);
    }
    return list.sort(byNewest);
  }

  /**
   * Work out a firm type from the AI's explicit orgType, falling back to
   * keywords in its companyType text. Same rules as the web app.
   * @returns {string|null} one of ORG_TYPES, or null
   */
  function inferOrgType(companyType, orgType) {
    if (ORG_TYPES.includes(orgType)) return orgType;
    const t = (companyType || "").toLowerCase();
    if (/staffing|recruit|head-?hunt|talent|workforce|placement/.test(t)) return ORG_TYPES[0];
    if (/(it|technology|software|tech)\s+(consult|services)|systems integrat|it consult/.test(t))
      return ORG_TYPES[1];
    return null;
  }

  /** Add a firm to the agencies list unless that name is already there. */
  function addAgencyIfNew(agencies, name, type, note = "Auto-added from vetting") {
    const list = Array.isArray(agencies) ? agencies : [];
    const clean = String(name || "").trim();
    if (!clean || !ORG_TYPES.includes(type)) return list;
    if (list.some((e) => e.name.toLowerCase() === clean.toLowerCase())) return list;
    return [...list, { name: clean, url: "", type, note }];
  }

  /** Scan saved records and add any staffing / consulting firms not yet listed. */
  function scanRecordsForAgencies(agencies, records) {
    let list = Array.isArray(agencies) ? agencies : [];
    const before = list.length;
    for (const r of records || []) {
      const type = inferOrgType(r.companyType, r.orgType);
      if (type) list = addAgencyIfNew(list, r.company, type);
    }
    return { agencies: list, added: list.length - before };
  }

  /** Add the record to favorites, or remove it if already there. */
  function toggleFavorite(favorites, record, now = Date.now()) {
    const list = Array.isArray(favorites) ? favorites : [];
    if (list.some((f) => f.id === record.id))
      return list.filter((f) => f.id !== record.id);
    return [{ ...record, favoritedAt: now }, ...list];
  }

  const api = {
    BACKUP_NAME,
    ORG_TYPES,
    inferOrgType,
    addAgencyIfNew,
    scanRecordsForAgencies,
    cleanBlacklist,
    cleanAgencies,
    cleanEntries,
    mergeByName,
    mergeById,
    buildBackup,
    parseImport,
    applyImport,
    buildRecord,
    upsertRecord,
    toggleFavorite,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.JobGuardData = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
