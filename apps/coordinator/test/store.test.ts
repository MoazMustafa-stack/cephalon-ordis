import { describe, expect, it, vi } from "vitest";
import { MemoryStore, PgStore, type StoreTable } from "../src/store.js";

describe("store contracts", () => {
  it.each([
    ["projects", "created_at"],
    ["nodes", "last_seen_at"],
    ["runs", "created_at"],
    ["approval_requests", "expires_at"],
    ["reports", "generated_at"],
    ["idea_graphs", "updated_at"],
    ["portfolio_transactions", "occurred_on"]
  ] satisfies Array<[StoreTable, string]>)("orders %s by its time column", async (table, column) => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PgStore({ query } as never);
    await store.list(table);
    expect(query).toHaveBeenCalledWith(
      `SELECT * FROM ${table} ORDER BY ${column} DESC, id DESC LIMIT 200`
    );
  });

  it("throws for unsupported MemoryStore tables", async () => {
    const store = new MemoryStore();
    await expect(store.list("reports")).rejects.toThrow("does not implement");
  });
});
