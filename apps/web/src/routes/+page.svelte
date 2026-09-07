<script lang="ts">
  import { onMount } from "svelte";
  import {
    CostGuardState,
    DispatchResult,
    NodeListResponse,
    ProjectListResponse,
    Report,
    RunEventListResponse,
    RunListResponse,
    Thread,
    ThreadListResponse,
    ChartRequest,
    ArtifactListResponse,
    type NodeStatus,
    type Project,
    type Report as ReportRecord,
    type Thread as ThreadRecord,
    type RunEvent,
    type RunSummary,

    Artifact

  } from "@ordis/shared";

  const api = import.meta.env.VITE_ORDIS_API_URL ?? "http://127.0.0.1:4310";
  let allowance: CostGuardState | undefined;
  let projects: Project[] = [];
  let threads: ThreadRecord[] = [];
  let runs: RunSummary[] = [];
  let nodes: NodeStatus[] = [];
  let connected = false;
  let selectedProjectId = "";
  let objective = "";
  let chartError = "";
  let charting = false;
  let dispatchError = "";
  let dispatchingThreadId = "";
  let selectedRunId = "";
  let events: RunEvent[] = [];
  let report: ReportRecord | undefined;
  let artifacts: Artifact[] = [];
  let reilaibilityBusy = false;
  let reilaibilityError = "";

  async function refresh() {
    const [guardResponse, projectResponse, threadResponse, runResponse, nodeResponse] = await Promise.all([
      fetch(`${api}/api/system/allowance`),
      fetch(`${api}/api/projects`),
      fetch(`${api}/api/threads`),
      fetch(`${api}/api/runs`),
      fetch(`${api}/api/nodes`)
    ]);
    for (const response of [guardResponse, projectResponse, threadResponse, runResponse, nodeResponse]) {
      if (!response.ok) throw new Error(`Coordinator request failed: ${response.status}`);
    }
    allowance = CostGuardState.parse(await guardResponse.json());
    projects = ProjectListResponse.parse(await projectResponse.json()).items;
    threads = ThreadListResponse.parse(await threadResponse.json()).items;
    runs = RunListResponse.parse(await runResponse.json()).items;
    nodes = NodeListResponse.parse(await nodeResponse.json()).items;
    if (!selectedProjectId && projects[0]) selectedProjectId = projects[0].id;
  }

  async function chart(event: SubmitEvent) {
    event.preventDefault();
    chartError = "";
    const parsed = ChartRequest.safeParse({ projectId: selectedProjectId, objective });
    if (!parsed.success) {
      chartError = "Choose a project and describe the objective.";
      return;
    }
    charting = true;
    try {
      const response = await fetch(`${api}/api/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data)
      });
      if (!response.ok) throw new Error(`Chart request failed: ${response.status}`);
      Thread.parse(await response.json());
      objective = "";
      await refresh();
    } catch (error) {
      chartError = error instanceof Error ? error.message : "Unable to chart this Thread.";
    } finally {
      charting = false;
    }
  }

  async function dispatch(threadId: string) {
    dispatchError = "";
    dispatchingThreadId = threadId;
    try {
      const response = await fetch(`${api}/api/threads/${threadId}/dispatch`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        throw new Error(body?.error === "dispatch_unavailable"
          ? "Dispatch needs an active, idle Hand with an available Reserve."
          : `Dispatch request failed: ${response.status}`);
      }
      DispatchResult.parse(await response.json());
      await refresh();
    } catch (error) {
      dispatchError = error instanceof Error ? error.message : "Unable to dispatch this Thread.";
    } finally {
      dispatchingThreadId = "";
    }
  }

  async function showChronicle(runId: string) {
    selectedRunId = runId;
    report = undefined;
    reilaibilityError = "";

    const [eventResponse, artifactResponse] = await Promise.all([
      fetch(`${api}/api/runs/${runId}/events`),
      fetch(`${api}/api/runs/${runId}/artifacts`)
    ]);

    if (!eventResponse.ok || !artifactResponse.ok) throw new Error("Unable to load COmmission evidence");
    
    events = RunEventListResponse.parse(await eventResponse.json()).items;
    artifacts = ArtifactListResponse.parse(await artifactResponse.json()).items;
  }

  async function generateReport() {
    if (!selectedRunId) return;
    const response = await fetch(`${api}/api/runs/${selectedRunId}/report`, { method: "POST" });
    if (!response.ok) throw new Error(`Report request failed: ${response.status}`);
    report = Report.parse(await response.json());
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

  <section class="chart">
    <div>
      <p class="eyebrow">CHART</p>
      <h2>Plan a Thread</h2>
      <p>Turn an objective into planned work. Dispatch assigns it to an available Hand.</p>
    </div>
    <form onsubmit={chart}>
      <label>
        Project
        <select bind:value={selectedProjectId} disabled={charting || projects.length === 0}>
          {#if projects.length === 0}
            <option value="">No registered projects</option>
          {:else}
            {#each projects as project (project.id)}
              <option value={project.id}>{project.name}</option>
            {/each}
          {/if}
        </select>
      </label>
      <label>
        Objective
        <textarea bind:value={objective} maxlength="4000" placeholder="What should this Thread accomplish?" disabled={charting}></textarea>
      </label>
      {#if chartError}<p class="form-error">{chartError}</p>{/if}
      <button type="submit" disabled={charting || projects.length === 0}>
        {charting ? "CHARTING&" : "CHART THREAD"}
      </button>
    </form>
  </section>

  <div class="grid">
    <section><div class="section-title"><h3>Active runs</h3><b>{runs.length}</b></div>
      {#if runs.length === 0}<p class="empty">No commands in the execution queue.</p>{/if}
      {#each runs as run (run.id)}<article><code>{run.id.slice(0, 8)}</code><strong>{run.state}</strong><button class="dispatch" type="button" onclick={() => showChronicle(run.id)}>CHRONICLE</button></article>{/each}
    </section>
    <section><div class="section-title"><h3>Hands (worker nodes)</h3><b>{nodes.filter((node) => node.presence === "active").length} active / {nodes.length} known</b></div>
      {#if nodes.length === 0}<p class="empty">Awaiting Windows or Arch heartbeat.</p>{/if}
      {#each nodes as node (node.id)}<article><code>{node.platform}</code><strong>{node.presence} � {node.allowance}</strong></article>{/each}
    </section>
  </div>

  {#if selectedRunId}
    <section class="threads">
      <div class="section-title"><h3>Commission Chronicle</h3><b>{events.length} events</b><button class="dispatch" type="button" onclick={generateReport}>DISTILL REPORT</button></div>
      {#if events.length === 0}<p class="empty">No Chronicle evidence recorded yet.</p>{/if}
      {#each events as event (event.id)}
        <article><code>{new Date(event.occurredAt).toLocaleTimeString()}</code><span>{event.type}
          {#if event.type === "commission.output"}
            <pre>{String(event.payload.stdout ?? "")}{event.payload.stderr ? "\n" + String(event.payload.stderr) : ""}</pre>
          {/if}
        </span></article>
      {/each}
      {#if report}
        <article><code>REPORT</code><span><strong>{report.title}</strong><br />{report.summary}<br /><small>{report.evidence.length} evidence records</small></span></article>
      {/if}
    </section>
  {/if}

  <section class="threads">
    <div class="section-title"><h3>Threads</h3><b>{threads.length}</b></div>
    {#if threads.length === 0}<p class="empty">No planned work. Chart an objective to begin.</p>{/if}
    {#each threads as thread (thread.id)}
      <article><code>{thread.id.slice(0, 8)}</code><span>{thread.objective}</span><strong>{thread.state}</strong>
        {#if thread.state === "planned"}
          <button class="dispatch" type="button" disabled={dispatchingThreadId !== ""} onclick={() => dispatch(thread.id)}>
            {dispatchingThreadId === thread.id ? "DISPATCHING�w^~)�v" : "DISPATCH"}
          </button>
        {/if}
      </article>
    {/each}
    {#if dispatchError}<p class="form-error">{dispatchError}</p>{/if}
  </section>
</main>

<style>
  :global(*){box-sizing:border-box} :global(body){margin:0;background:#071016;color:#d7e8e8;font-family:Inter,ui-sans-serif,system-ui;background-image:radial-gradient(circle at 65% -10%,#174354 0,transparent 35%),linear-gradient(135deg,#071016,#0b141d 60%,#101722);min-height:100vh}
  main{max-width:1120px;margin:auto;padding:42px 24px 80px} header{display:flex;align-items:center;gap:18px;border-bottom:1px solid #35505c;padding-bottom:24px}.brand-mark{width:54px;height:54px;border:1px solid #d6a95f;display:grid;place-items:center;transform:rotate(45deg);color:#e6c988;font:700 26px Georgia}.brand-mark::first-letter{transform:rotate(-45deg)}h1{margin:2px 0;font:400 32px Georgia;letter-spacing:.04em}h1 span{color:#e4bb72}.eyebrow{margin:0;color:#79a5ad;font-size:11px;letter-spacing:.28em}.link{margin-left:auto;color:#87969c;font-size:11px;letter-spacing:.2em}.link::before{content:'●';margin-right:8px}.online{color:#6ee7b7}.hero{margin:52px 0 26px;border:1px solid #2a4652;border-left:3px solid #d6a95f;background:linear-gradient(100deg,rgba(22,52,64,.8),rgba(13,24,33,.55));padding:28px 32px}.hero h2{text-transform:uppercase;margin:8px 0;color:#eefafa;font:400 42px Georgia}.hero p:last-child{color:#8ea9af;margin:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.grid section{border:1px solid #243b46;background:rgba(8,18,25,.78);min-height:230px;padding:22px}.section-title{display:flex;align-items:center;justify-content:space-between}.section-title h3{font:400 18px Georgia;margin:0;color:#d7c18e}.section-title b{color:#6f929a}article{display:flex;justify-content:space-between;border-top:1px solid #1f3640;padding:15px 2px;margin-top:12px}article code{color:#7fb0b8}article strong{text-transform:uppercase;color:#d7c18e;font-size:12px}.empty{color:#657c83;padding-top:45px;text-align:center}@media(max-width:700px){.grid{grid-template-columns:1fr}.hero h2{font-size:32px}}
  .chart,.threads{margin:26px 0;border:1px solid #243b46;background:rgba(8,18,25,.78);padding:22px}.chart{display:grid;grid-template-columns:minmax(220px,.75fr) 1.25fr;gap:28px}.chart h2{text-transform:uppercase;margin:8px 0;color:#eefafa;font:400 32px Georgia}.chart p{color:#8ea9af;margin:0}.chart form{display:grid;gap:13px}.chart label{display:grid;gap:6px;color:#9cb4b8;font-size:12px;letter-spacing:.08em}.chart select,.chart textarea{width:100%;border:1px solid #35505c;background:#071016;color:#d7e8e8;padding:10px;font:inherit}.chart textarea{min-height:86px;resize:vertical}.chart button{justify-self:start;border:1px solid #d6a95f;background:#d6a95f;color:#071016;padding:10px 15px;font-weight:700;letter-spacing:.08em;cursor:pointer}.chart button:disabled{cursor:not-allowed;opacity:.55}.dispatch{border:1px solid #79a5ad;background:transparent;color:#b8d7dc;padding:7px 10px;font-size:11px;font-weight:700;letter-spacing:.08em;cursor:pointer}.dispatch:disabled{cursor:not-allowed;opacity:.55}.form-error{color:#fda4af!important}article{gap:14px}article span{flex:1;color:#c7d8da}pre{white-space:pre-wrap;max-height:240px;overflow:auto;background:#050a0e;padding:10px;color:#b8d7dc}@media(max-width:700px){.grid,.chart{grid-template-columns:1fr}.chart{gap:18px}}
</style>
