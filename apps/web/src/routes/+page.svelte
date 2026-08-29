<script lang="ts">
  import { onMount } from "svelte";
  import {
    CostGuardState,
    NodeListResponse,
    RunListResponse,
    type NodeRecord,
    type RunSummary
  } from "@ordis/shared";

  const api = import.meta.env.VITE_ORDIS_API_URL ?? "http://127.0.0.1:4310";
  let allowance: CostGuardState | undefined;
  let runs: RunSummary[] = [];
  let nodes: NodeRecord[] = [];
  let connected = false;

  async function refresh() {
    const [guardResponse, runResponse, nodeResponse] = await Promise.all([
      fetch(`${api}/api/system/allowance`),
      fetch(`${api}/api/runs`),
      fetch(`${api}/api/nodes`)
    ]);
    for (const response of [guardResponse, runResponse, nodeResponse]) {
      if (!response.ok) throw new Error(`Coordinator request failed: ${response.status}`);
    }
    allowance = CostGuardState.parse(await guardResponse.json());
    runs = RunListResponse.parse(await runResponse.json()).items;
    nodes = NodeListResponse.parse(await nodeResponse.json()).items;
  }

  onMount(() => {
    refresh().catch(console.error);
    const ws = new WebSocket(api.replace(/^http/, "ws") + "/ws/events");
    ws.onopen = () => connected = true;
    ws.onclose = () => connected = false;
    ws.onmessage = () => refresh().catch(console.error);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js");
    return () => ws.close();
  });
</script>

<svelte:head><title>Cephalon Ordis</title><meta name="description" content="Local-first Codex operations console" /></svelte:head>

<main>
  <header>
    <div class="brand-mark">O</div>
    <div><p class="eyebrow">LOCAL OPERATIONS</p><h1>Cephalon <span>Ordis</span></h1></div>
    <div class:online={connected} class="link">{connected ? "LINKED" : "OFFLINE"}</div>
  </header>

  <section class="hero">
    <p class="eyebrow">SUBSCRIPTION GUARD</p>
    <h2>{allowance?.allowance ?? "loading"}</h2>
    <p>Local Codex sessions only · direct API disabled</p>
  </section>

  <div class="grid">
    <section><div class="section-title"><h3>Active runs</h3><b>{runs.length}</b></div>
      {#if runs.length === 0}<p class="empty">No commands in the execution queue.</p>{/if}
      {#each runs as run (run.id)}<article><code>{run.id.slice(0, 8)}</code><strong>{run.state}</strong></article>{/each}
    </section>
    <section><div class="section-title"><h3>Worker nodes</h3><b>{nodes.length}</b></div>
      {#if nodes.length === 0}<p class="empty">Awaiting Windows or Arch heartbeat.</p>{/if}
      {#each nodes as node (node.id)}<article><code>{node.platform}</code><strong>{node.allowance}</strong></article>{/each}
    </section>
  </div>
</main>

<style>
  :global(*){box-sizing:border-box} :global(body){margin:0;background:#071016;color:#d7e8e8;font-family:Inter,ui-sans-serif,system-ui;background-image:radial-gradient(circle at 65% -10%,#174354 0,transparent 35%),linear-gradient(135deg,#071016,#0b141d 60%,#101722);min-height:100vh}
  main{max-width:1120px;margin:auto;padding:42px 24px 80px} header{display:flex;align-items:center;gap:18px;border-bottom:1px solid #35505c;padding-bottom:24px}.brand-mark{width:54px;height:54px;border:1px solid #d6a95f;display:grid;place-items:center;transform:rotate(45deg);color:#e6c988;font:700 26px Georgia}.brand-mark::first-letter{transform:rotate(-45deg)}h1{margin:2px 0;font:400 32px Georgia;letter-spacing:.04em}h1 span{color:#e4bb72}.eyebrow{margin:0;color:#79a5ad;font-size:11px;letter-spacing:.28em}.link{margin-left:auto;color:#87969c;font-size:11px;letter-spacing:.2em}.link::before{content:'●';margin-right:8px}.online{color:#6ee7b7}.hero{margin:52px 0 26px;border:1px solid #2a4652;border-left:3px solid #d6a95f;background:linear-gradient(100deg,rgba(22,52,64,.8),rgba(13,24,33,.55));padding:28px 32px}.hero h2{text-transform:uppercase;margin:8px 0;color:#eefafa;font:400 42px Georgia}.hero p:last-child{color:#8ea9af;margin:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.grid section{border:1px solid #243b46;background:rgba(8,18,25,.78);min-height:230px;padding:22px}.section-title{display:flex;align-items:center;justify-content:space-between}.section-title h3{font:400 18px Georgia;margin:0;color:#d7c18e}.section-title b{color:#6f929a}article{display:flex;justify-content:space-between;border-top:1px solid #1f3640;padding:15px 2px;margin-top:12px}article code{color:#7fb0b8}article strong{text-transform:uppercase;color:#d7c18e;font-size:12px}.empty{color:#657c83;padding-top:45px;text-align:center}@media(max-width:700px){.grid{grid-template-columns:1fr}.hero h2{font-size:32px}}
</style>
