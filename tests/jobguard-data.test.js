// tests/jobguard-data.test.js
// Jest unit tests for records, favorites and backup helpers (lib/jobguard-data.js)

"use strict";

const D = require("../lib/jobguard-data");

const vet = {
  riskLevel: "HIGH",
  recommendation: "AVOID",
  verdict: "Looks like a payment scam",
  redFlags: ["asks for money"],
  greenFlags: [],
  verificationSteps: ["check domain"],
};

describe("cleanBlacklist", () => {
  test("trims names and defaults a missing reason", () => {
    expect(D.cleanBlacklist([{ name: "  Acme " }, { name: "B", reason: "bad" }])).toEqual([
      { name: "Acme", reason: "Imported" },
      { name: "B", reason: "bad" },
    ]);
  });
  test("drops invalid entries and non-arrays", () => {
    expect(D.cleanBlacklist([null, {}, { name: "  " }, { name: 5 }])).toEqual([]);
    expect(D.cleanBlacklist("nope")).toEqual([]);
  });
});

describe("cleanAgencies", () => {
  test("normalises type, url and note", () => {
    expect(
      D.cleanAgencies([
        { name: "Hays", type: "IT Consulting", url: "h.com", note: "n" },
        { name: "Robert", type: "weird" },
      ])
    ).toEqual([
      { name: "Hays", url: "h.com", type: "IT Consulting", note: "n" },
      { name: "Robert", url: "", type: "Staffing / Recruiter", note: "" },
    ]);
  });
  test("returns [] for non-arrays", () => {
    expect(D.cleanAgencies(undefined)).toEqual([]);
  });
});

describe("cleanEntries", () => {
  test("requires company and id", () => {
    const ok = { id: 1, company: "A" };
    expect(D.cleanEntries([ok, { company: "B" }, { id: 2 }, null])).toEqual([ok]);
    expect(D.cleanEntries(null)).toEqual([]);
  });
});

describe("mergeByName", () => {
  test("adds new names, keeps existing, case-insensitive", () => {
    const cur = [{ name: "Acme", reason: "x" }];
    const r = D.mergeByName(cur, [
      { name: "acme", reason: "dup" },
      { name: "Beta", reason: "y" },
      { name: "BETA", reason: "dup2" },
    ]);
    expect(r.added).toBe(1);
    expect(r.merged.map((e) => e.name)).toEqual(["Acme", "Beta"]);
    expect(r.merged[0].reason).toBe("x");
  });
  test("handles missing inputs", () => {
    expect(D.mergeByName(undefined, undefined)).toEqual({ merged: [], added: 0 });
  });
});

describe("mergeById", () => {
  test("adds unseen ids only", () => {
    const r = D.mergeById([{ id: 1 }], [{ id: 1 }, { id: 2 }, { id: 2 }]);
    expect(r.added).toBe(1);
    expect(r.merged.map((e) => e.id)).toEqual([1, 2]);
  });
  test("handles missing inputs", () => {
    expect(D.mergeById(null, null)).toEqual({ merged: [], added: 0 });
  });
});

describe("backup round trip", () => {
  test("buildBackup then parseImport keeps all four lists", () => {
    const data = {
      blacklist: [{ name: "Acme", reason: "bad" }],
      records: [{ id: 1, company: "A", ts: 5 }],
      favorites: [{ id: 1, company: "A" }],
      agencies: [{ name: "Hays", url: "", type: "IT Consulting", note: "" }],
    };
    const text = D.buildBackup(data, new Date("2026-11-25T12:00:00Z"));
    const json = JSON.parse(text);
    expect(json.app).toBe("jobguard");
    expect(json.version).toBe(1);
    expect(json.exportedAt).toBe("2026-11-25T12:00:00.000Z");
    expect(D.parseImport(text)).toEqual(data);
  });
  test("always writes all four arrays so the web app accepts the file", () => {
    const json = JSON.parse(D.buildBackup({ blacklist: [{ name: "A", reason: "r" }] }));
    expect(json.records).toEqual([]);
    expect(json.favorites).toEqual([]);
    expect(json.agencies).toEqual([]);
    expect(JSON.parse(D.buildBackup()).blacklist).toEqual([]);
  });
});

describe("parseImport", () => {
  test("accepts a web-app backup", () => {
    const text = JSON.stringify({
      app: "jobguard",
      version: 1,
      blacklist: [{ name: "A", reason: "r" }],
      records: [{ id: 9, company: "X", ts: 1 }],
      favorites: [],
      agencies: [{ name: "Hays", type: "IT Consulting" }],
    });
    const r = D.parseImport(text);
    expect(r.records).toHaveLength(1);
    expect(r.agencies[0].url).toBe("");
  });
  test("accepts a plain blacklist array", () => {
    const r = D.parseImport(JSON.stringify([{ name: "A", reason: "r" }]));
    expect(r.blacklist).toEqual([{ name: "A", reason: "r" }]);
    expect(r.records).toEqual([]);
  });
  test("accepts an empty array", () => {
    expect(D.parseImport("[]").blacklist).toEqual([]);
  });
  test("rejects an array with no valid entries", () => {
    expect(() => D.parseImport(JSON.stringify([{ foo: 1 }]))).toThrow(/No blacklist entries/);
  });
  test("rejects other JSON and bad JSON", () => {
    expect(() => D.parseImport(JSON.stringify({ app: "other", blacklist: [] }))).toThrow(
      /Not a JobGuard backup/
    );
    expect(() => D.parseImport(JSON.stringify({ app: "jobguard" }))).toThrow(
      /Not a JobGuard backup/
    );
    expect(() => D.parseImport("null")).toThrow(/Not a JobGuard backup/);
    expect(() => D.parseImport("{oops")).toThrow();
  });
});

describe("applyImport", () => {
  test("merges without deleting and sorts records newest first", () => {
    const current = {
      blacklist: [{ name: "Old", reason: "keep" }],
      records: [{ id: 1, company: "A", ts: 10 }],
      favorites: [{ id: 1, company: "A" }],
      agencies: [],
    };
    const incoming = {
      blacklist: [{ name: "old", reason: "dup" }, { name: "New", reason: "n" }],
      records: [{ id: 2, company: "B", ts: 99 }],
      favorites: [{ id: 1, company: "A" }],
      agencies: [{ name: "Hays", url: "", type: "IT Consulting", note: "" }],
    };
    const { data, added } = D.applyImport(current, incoming);
    expect(added).toEqual({ blacklist: 1, records: 1, favorites: 0, agencies: 1 });
    expect(data.blacklist.map((e) => e.name)).toEqual(["Old", "New"]);
    expect(data.records.map((r) => r.id)).toEqual([2, 1]);
    expect(data.favorites).toHaveLength(1);
  });
  test("works with nothing stored yet", () => {
    const { data } = D.applyImport(undefined, D.parseImport("[]"));
    expect(data).toEqual({ blacklist: [], records: [], favorites: [], agencies: [] });
  });
});

describe("buildRecord", () => {
  test("matches the web app shape", () => {
    const r = D.buildRecord("  Acme ", " Dev ", vet, 1000);
    expect(r).toMatchObject({
      id: 1000,
      ts: 1000,
      company: "Acme",
      role: "Dev",
      riskLevel: "HIGH",
      recommendation: "AVOID",
      verdict: "Looks like a payment scam",
      fromCache: false,
    });
    expect(r.redFlags).toEqual(["asks for money"]);
  });
  test("defaults arrays and flags cached results", () => {
    const r = D.buildRecord("A", undefined, { fromCache: true }, 5);
    expect(r.role).toBe("");
    expect(r.redFlags).toEqual([]);
    expect(r.fromCache).toBe(true);
    expect(D.buildRecord("A", "", { orgType: "IT Consulting", companyType: "IT" }, 1)).toMatchObject({
      orgType: "IT Consulting",
      companyType: "IT",
    });
    expect(D.buildRecord(undefined, "", undefined, 1).company).toBe("");
  });
});

describe("upsertRecord", () => {
  test("adds a new record, newest first", () => {
    const a = D.buildRecord("A", "", vet, 1);
    const b = D.buildRecord("B", "", vet, 2);
    expect(D.upsertRecord(D.upsertRecord([], a), b).map((r) => r.company)).toEqual(["B", "A"]);
  });
  test("replaces same company and role, keeping id and first-vetted time", () => {
    const first = D.buildRecord("Acme", "Dev", vet, 100);
    const again = D.buildRecord("acme", "dev", { ...vet, riskLevel: "LOW" }, 500);
    const list = D.upsertRecord([first], again);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(100);
    expect(list[0].firstVetted).toBe(100);
    expect(list[0].riskLevel).toBe("LOW");
  });
  test("keeps an existing firstVetted", () => {
    const first = { ...D.buildRecord("A", "", vet, 100), firstVetted: 50 };
    const list = D.upsertRecord([first], D.buildRecord("A", "", vet, 200));
    expect(list[0].firstVetted).toBe(50);
  });
  test("same company with a different role is a separate record", () => {
    const list = D.upsertRecord([D.buildRecord("A", "Dev", vet, 1)], D.buildRecord("A", "QA", vet, 2));
    expect(list).toHaveLength(2);
  });
});

describe("toggleFavorite", () => {
  test("adds then removes", () => {
    const rec = D.buildRecord("A", "", vet, 1);
    const added = D.toggleFavorite([], rec, 777);
    expect(added).toHaveLength(1);
    expect(added[0].favoritedAt).toBe(777);
    expect(D.toggleFavorite(added, rec)).toEqual([]);
  });
  test("handles missing list", () => {
    expect(D.toggleFavorite(undefined, { id: 1, company: "A" }, 1)).toHaveLength(1);
  });
});

describe("inferOrgType", () => {
  test("uses the explicit orgType first", () => {
    expect(D.inferOrgType("Software / SaaS", "Staffing / Recruiter")).toBe("Staffing / Recruiter");
    expect(D.inferOrgType("Staffing Agency", "IT Consulting")).toBe("IT Consulting");
  });
  test("falls back to keywords in companyType", () => {
    expect(D.inferOrgType("IT Staffing and Professional Services")).toBe("Staffing / Recruiter");
    expect(D.inferOrgType("Technology services")).toBe("IT Consulting");
    expect(D.inferOrgType("Systems integration")).toBe("IT Consulting");
    // "Other" is not a firm type, so the keyword fallback still applies (same as the web app).
    expect(D.inferOrgType("Systems integrator", "Other")).toBe("IT Consulting");
  });
  test("returns null for ordinary employers and empty input", () => {
    expect(D.inferOrgType("Financial Services", "Other")).toBeNull();
    expect(D.inferOrgType()).toBeNull();
  });
});

describe("addAgencyIfNew", () => {
  test("adds a new firm", () => {
    expect(D.addAgencyIfNew([], " Procom ", "Staffing / Recruiter")).toEqual([
      { name: "Procom", url: "", type: "Staffing / Recruiter", note: "Auto-added from vetting" },
    ]);
  });
  test("skips duplicates (case-insensitive), blank names and unknown types", () => {
    const cur = [{ name: "Procom", url: "", type: "Staffing / Recruiter", note: "" }];
    expect(D.addAgencyIfNew(cur, "PROCOM", "IT Consulting")).toBe(cur);
    expect(D.addAgencyIfNew(cur, "  ", "IT Consulting")).toBe(cur);
    expect(D.addAgencyIfNew(cur, "Other Co", "Other")).toBe(cur);
    expect(D.addAgencyIfNew(undefined, "X", "IT Consulting")).toHaveLength(1);
  });
});

describe("scanRecordsForAgencies", () => {
  test("adds firms found in records and counts them", () => {
    const records = [
      { id: 1, company: "Procom", orgType: "Staffing / Recruiter" },
      { id: 2, company: "Acme Bank", companyType: "Financial Services" },
      { id: 3, company: "Hays", companyType: "Recruitment agency" },
      { id: 4, company: "procom", orgType: "Staffing / Recruiter" },
    ];
    const r = D.scanRecordsForAgencies([], records);
    expect(r.added).toBe(2);
    expect(r.agencies.map((e) => e.name)).toEqual(["Procom", "Hays"]);
  });
  test("handles empty input", () => {
    expect(D.scanRecordsForAgencies(undefined, undefined)).toEqual({ agencies: [], added: 0 });
  });
});

test("BACKUP_NAME matches the web app", () => {
  expect(D.BACKUP_NAME).toBe("jobguard-all-records.json");
});

describe("extractDomain", () => {
  test.each([
    ["https://www.anthropic.com/jobs", "anthropic.com"],
    ["anthropic.com", "anthropic.com"],
    ["HTTP://Sub.Example.co.uk/x?y=1", "sub.example.co.uk"],
    ["not a url", ""],
    ["", ""],
    [null, ""],
  ])("%s -> %s", (input, out) => {
    expect(D.extractDomain(input)).toBe(out);
  });
});

describe("parseTab and mergeTab", () => {
  test("TAB_FILES match the web app file names", () => {
    expect(D.TAB_FILES).toEqual({
      blacklist: "jobguard-blacklist.json",
      records: "jobguard-records.json",
      favorites: "jobguard-favorites.json",
      agencies: "jobguard-agencies.json",
    });
  });
  test("blacklist file is cleaned", () => {
    const out = D.parseTab("blacklist", JSON.stringify([{ name: " Acme " }, { nope: 1 }]));
    expect(out).toEqual([{ name: "Acme", reason: "Imported" }]);
  });
  test("rejects non-list and wrong-shape files", () => {
    expect(() => D.parseTab("records", "{}")).toThrow(/not a records list/);
    expect(() => D.parseTab("records", JSON.stringify([{ a: 1 }]))).toThrow(/No records entries/);
    expect(() => D.parseTab("records", "nope")).toThrow();
  });
  test("an empty list is accepted", () => {
    expect(D.parseTab("favorites", "[]")).toEqual([]);
  });
  test("merge never removes and skips duplicates", () => {
    const a = D.mergeTab("blacklist", [{ name: "A", reason: "x" }], [{ name: "a", reason: "y" }, { name: "B", reason: "z" }]);
    expect(a.added).toBe(1);
    expect(a.merged.map((e) => e.name)).toEqual(["A", "B"]);
    const r = D.mergeTab("records", [{ id: 1, company: "A" }], [{ id: 1, company: "A" }, { id: 2, company: "B" }]);
    expect(r.added).toBe(1);
  });
});

describe("filterRecords", () => {
  const recs = [
    { id: 1, ts: 1, company: "Zeta Corp", role: "QA", riskLevel: "LOW", recommendation: "APPLY", ownership: "Public", companyType: "Software" },
    { id: 2, ts: 3, company: "Procom", role: "SDET", riskLevel: "MEDIUM", recommendation: "CAUTION", ownership: "Private", companyType: "Staffing Agency" },
    { id: 3, ts: 2, company: "Alpha Scam", role: "Clerk", riskLevel: "HIGH", recommendation: "AVOID", ownership: "Unknown", companyType: "Unknown" },
  ];
  const names = (o, ag = []) => D.filterRecords(recs, ag, o).map((r) => r.company);

  test("default sort is newest first", () => {
    expect(names({})).toEqual(["Procom", "Alpha Scam", "Zeta Corp"]);
  });
  test("sorts", () => {
    expect(names({ sort: "oldest" })).toEqual(["Zeta Corp", "Alpha Scam", "Procom"]);
    expect(names({ sort: "risk" })).toEqual(["Alpha Scam", "Procom", "Zeta Corp"]);
    expect(names({ sort: "az" })).toEqual(["Alpha Scam", "Procom", "Zeta Corp"]);
  });
  test("search matches company, role and type, case-insensitively", () => {
    expect(names({ search: "sdet" })).toEqual(["Procom"]);
    expect(names({ search: "SOFTWARE" })).toEqual(["Zeta Corp"]);
    expect(names({ search: "zzz" })).toEqual([]);
  });
  test("risk, recommendation and ownership filters", () => {
    expect(names({ filter: "HIGH" })).toEqual(["Alpha Scam"]);
    expect(names({ filter: "APPLY" })).toEqual(["Zeta Corp"]);
    expect(names({ filter: "Private" })).toEqual(["Procom"]);
  });
  test("agency filters use the Agencies list and the record's own type", () => {
    expect(names({ filter: "ORG_ANY" })).toEqual(["Procom"]);
    expect(names({ filter: "Staffing / Recruiter" })).toEqual(["Procom"]);
    expect(names({ filter: "ORG_NONE" })).toEqual(["Alpha Scam", "Zeta Corp"]);
    const ag = [{ name: "Zeta Corp", type: "IT Consulting" }];
    expect(names({ filter: "IT Consulting" }, ag)).toEqual(["Zeta Corp"]);
  });
  test("does not mutate the input", () => {
    const copy = JSON.stringify(recs);
    D.filterRecords(recs, [], { sort: "az" });
    expect(JSON.stringify(recs)).toBe(copy);
  });
});

test("buildRecord keeps the company intel and URL", () => {
  const rec = D.buildRecord("Acme", "QA", { ...vet, url: "acme.com", ownership: "Private", headcount: "51-200", headquarters: "Toronto, Canada" }, 5);
  expect(rec).toMatchObject({ url: "acme.com", ownership: "Private", headcount: "51-200", headquarters: "Toronto, Canada" });
});

describe("company website on records", () => {
  test("the URL the user typed wins over the AI's website", () => {
    const rec = D.buildRecord("Acme", "", { ...vet, url: "https://www.acme.com/jobs", website: "other.com" }, 1);
    expect(rec.website).toBe("acme.com");
  });
  test("falls back to the AI website, and to empty when unknown", () => {
    expect(D.buildRecord("Acme", "", { ...vet, website: "https://acme.io" }, 1).website).toBe("acme.io");
    expect(D.buildRecord("Acme", "", { ...vet, website: "Unknown" }, 1).website).toBe("");
    expect(D.buildRecord("Acme", "", vet, 1).website).toBe("");
  });
});
