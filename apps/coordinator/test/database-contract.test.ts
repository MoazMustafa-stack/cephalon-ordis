import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWANCE_STATES,
  APPROVAL_STATUSES,
  NODE_PLATFORMS,
  RUN_STATES,
  THREAD_STATES
} from "@ordis/shared";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../db/migrations/001_initial.sql", import.meta.url)
);
const migration = readFileSync(migrationPath, "utf8");
const chartMigrationPath = fileURLToPath(
  new URL("../../../db/migrations/002_chart_threads.sql", import.meta.url)
);
const chartMigration = readFileSync(chartMigrationPath, "utf8");
const dispatchMigrationPath = fileURLToPath(
  new URL("../../../db/migrations/003_dispatch_threads.sql", import.meta.url)
);
const dispatchMigration = readFileSync(dispatchMigrationPath, "utf8");

function quotedValues(fragment: string): string[] {
  return [...fragment.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function capture(pattern: RegExp): string {
  const match = migration.match(pattern);
  if (!match?.[1]) throw new Error(`Migration fragment was not found: ${pattern}`);
  return match[1];
}

describe("database enum contract", () => {
  it("matches the canonical run states", () => {
    expect(quotedValues(capture(/CREATE TYPE run_state AS ENUM \(([^;]+)\);/s)))
      .toEqual([...RUN_STATES]);
  });

  it("matches the canonical node platforms", () => {
    expect(quotedValues(capture(/platform text NOT NULL CHECK \(platform IN \(([^)]+)\)\)/)))
      .toEqual([...NODE_PLATFORMS]);
  });

  it("matches the canonical allowance states", () => {
    expect(quotedValues(capture(/allowance text NOT NULL CHECK \(allowance IN \(([^)]+)\)\)/)))
      .toEqual([...ALLOWANCE_STATES]);
  });

  it("matches the canonical approval statuses", () => {
    expect(quotedValues(capture(/CHECK \(status IN \(([^)]+)\)\)/)))
      .toEqual([...APPROVAL_STATUSES]);
  });

  it("keeps the Chart migration initially planned", () => {
    const match = chartMigration.match(/CHECK \(state IN \(([^)]+)\)\)/);
    if (!match?.[1]) throw new Error("Chart Thread state constraint was not found");
    expect(quotedValues(match[1])).toEqual(["planned"]);
  });

  it("matches the canonical Thread states after the Dispatch migration", () => {
    const match = dispatchMigration.match(/CHECK \(state IN \(([^)]+)\)\)/);
    if (!match?.[1]) throw new Error("Dispatch Thread state constraint was not found");
    expect(quotedValues(match[1])).toEqual([...THREAD_STATES]);
  });
});
