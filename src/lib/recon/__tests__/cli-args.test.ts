import { describe, expect, it } from "vitest";
import { HELP_TEXT, parseCli } from "../../../../scripts/cli-args";

/** Pure parser tests only — the CLI never touches the database from here. */
describe("cli argument parsing", () => {
  it("returns help for no args and for help flags", () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"], ["--", "--help"]]) {
      expect(parseCli(argv)).toEqual({ ok: true, value: { command: "help" } });
    }
    expect(HELP_TEXT).toContain("ingest-settlements <PROCESSOR> <file>");
  });

  it("rejects unknown commands with exit code 2", () => {
    const result = parseCli(["frobnicate"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.exitCode).toBe(2);
    expect(result.error).toContain('unknown command "frobnicate"');
  });

  it("requires a file for ingest-transactions", () => {
    expect(parseCli(["ingest-transactions"])).toMatchObject({ ok: false, exitCode: 2 });
    expect(parseCli(["ingest-transactions", "a.csv"])).toEqual({
      ok: true,
      value: { command: "ingest-transactions", file: "a.csv" },
    });
    expect(parseCli(["ingest-transactions", "a.csv", "b.csv"])).toMatchObject({ ok: false });
  });

  it("validates the processor for ingest-settlements", () => {
    const bad = parseCli(["ingest-settlements", "PAYPAL", "f.csv"]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("unknown processor");

    expect(parseCli(["ingest-settlements", "nusapay", "f.csv"])).toEqual({
      ok: true,
      value: { command: "ingest-settlements", processor: "NUSAPAY", file: "f.csv" },
    });
    expect(parseCli(["ingest-settlements", "MEKONGPAY"])).toMatchObject({ ok: false });
    expect(parseCli(["ingest-settlements"])).toMatchObject({ ok: false });
  });

  it("parses reconcile flags", () => {
    expect(parseCli(["reconcile"])).toEqual({
      ok: true,
      value: { command: "reconcile", asOf: undefined, rematchAll: false },
    });
    expect(parseCli(["reconcile", "--rematch-all"])).toEqual({
      ok: true,
      value: { command: "reconcile", asOf: undefined, rematchAll: true },
    });
    expect(parseCli(["reconcile", "--as-of", "2026-07-30T23:00:00.000Z", "--rematch-all"])).toEqual({
      ok: true,
      value: { command: "reconcile", asOf: "2026-07-30T23:00:00.000Z", rematchAll: true },
    });
    expect(parseCli(["reconcile", "--as-of"])).toMatchObject({ ok: false, exitCode: 2 });
    expect(parseCli(["reconcile", "--as-of", "yesterday"])).toMatchObject({ ok: false });
    expect(parseCli(["reconcile", "--force"])).toMatchObject({ ok: false });
  });

  it("parses trace and report arguments", () => {
    expect(parseCli(["trace", " DMO-ME-0003 "])).toEqual({
      ok: true,
      value: { command: "trace", query: "DMO-ME-0003" },
    });
    expect(parseCli(["trace"])).toMatchObject({ ok: false, exitCode: 2 });
    expect(parseCli(["trace", "a", "b"])).toMatchObject({ ok: false });
    expect(parseCli(["report"])).toEqual({ ok: true, value: { command: "report" } });
    expect(parseCli(["report", "extra"])).toMatchObject({ ok: false });
    expect(parseCli(["load-demo"])).toEqual({ ok: true, value: { command: "load-demo" } });
    expect(parseCli(["load-demo", "now"])).toMatchObject({ ok: false });
  });
});
