import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALLOWANCE_STATES,
  APPROVAL_STATUSES,
  NODE_PLATFORMS,
  RUN_STATES
} from "@ordis/shared";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../../db/migrations/001_initial.sql", import.meta.url)
);
const migration = readFileSync(migrationPath, "utf8");

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
});
