#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CostGuardState, NodeListResponse, RunListResponse, RunRequest, RunSummary } from "@ordis/shared";

const base = process.env.ORDIS_COORDINATOR_URL ?? "http://127.0.0.1:4310";
const token = process.env.ORDIS_SESSION_TOKEN;
const headers = token ? { authorization: `Bearer ${token}` } : undefined;
const server = new McpServer({ name: "cephalon-ordis", version: "0.1.0" });

server.tool("ordis_status", "Read allowance, nodes, and recent runs from the local Ordis coordinator", {}, async () => {
  const [allowanceResponse, nodesResponse, runsResponse] = await Promise.all(
    ["system/allowance", "nodes", "runs"].map((path) => fetch(`${base}/api/${path}`, { headers }))
  );
  for (const response of [allowanceResponse, nodesResponse, runsResponse]) {
    if (!response.ok) throw new Error(`Coordinator request failed: ${response.status}`);
  }
  const allowance = CostGuardState.parse(await allowanceResponse.json());
  const nodes = NodeListResponse.parse(await nodesResponse.json());
  const runs = RunListResponse.parse(await runsResponse.json());
  return { content: [{ type: "text", text: JSON.stringify({ allowance, nodes, runs }, null, 2) }] };
});

server.tool("ordis_queue", "Queue a named Ordis workflow without using a direct model API", {
  ...RunRequest.shape
}, async (input) => {
  const response = await fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(input) });
  if (!response.ok) {
    return { content: [{ type: "text", text: await response.text() }], isError: true };
  }
  const run = RunSummary.parse(await response.json());
  return { content: [{ type: "text", text: JSON.stringify(run) }] };
});

await server.connect(new StdioServerTransport());
