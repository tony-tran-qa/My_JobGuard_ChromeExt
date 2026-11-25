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

test("BACKUP_NAME matches the web app", () => {
  expect(D.BACKUP_NAME).toBe("jobguard-all-records.json");
});
