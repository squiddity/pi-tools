import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Box, Key, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createJobId, ensureJobDirectory, getArtifactRoot, getJobPaths, getManagedAgentPaths, listMetadata, readLogTail, readResult, writeAtomicJson } from "../../src/herdr-jobs/artifacts.ts";
import { formatElapsed, formatFailureMessage, formatReadyMessage, formatReadyTimeoutMessage, formatResultMessage, jobSummary } from "../../src/herdr-jobs/format.ts";
import { ensureHerdrAvailable, herdr, shellReadyDelayMs } from "../../src/herdr-jobs/herdr.ts";
import { isActive, markClosed, markInterruptRequested, markResult, projectLifecycle } from "../../src/herdr-jobs/lifecycle.ts";
import { createRunningJob, getRuntime, hasSessionDelivery, persistJob, clearWidgetTimer, withDeliveryLock } from "../../src/herdr-jobs/runtime.ts";
import { buildManagedAgentArgv, findLastAssistantText, resolveExtensionPaths, splitCommaList } from "../../src/herdr-jobs/managed-agent.ts";
import { watchManagedAgent } from "../../src/herdr-jobs/managed-agent-watcher.ts";
import { paneRunCommand, writeRunnerFiles } from "../../src/herdr-jobs/runner.ts";
import type { AgentExtensionMode, AgentPlacement, CleanupPolicy, JobKind, ManagedAgentCompletion, ManagedAgentMetadata, PersistedJobMetadata, Placement, RunningJob, RunningManagedAgent, WatchEvent } from "../../src/herdr-jobs/types.ts";
import { watchJob } from "../../src/herdr-jobs/watcher.ts";

const runtime = getRuntime();
const AGENT_START_SCHEMA = Type.Object({
  name: Type.String({ description: "Short display name for the managed Pi agent." }),
  task: Type.String({ description: "Initial task for the managed Pi agent." }),
  cwd: Type.Optional(Type.String({ description: "Working directory; relative paths use the current Pi cwd." })),
  extensionMode: Type.Optional(StringEnum(["normal", "explicit"] as const)),
  extensions: Type.Optional(Type.String({ description: "Comma-separated extension entry paths. Relative paths use the managed agent cwd." })),
  tools: Type.Optional(Type.String({ description: "Comma-separated Pi built-in or extension tool names to enable." })),
  model: Type.Optional(Type.String({ description: "Optional exact provider/model id. Defaults to the invoking Pi model when available." })),
  thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
  placement: Type.Optional(StringEnum(["down", "right", "tab"] as const)),
});

const START_SCHEMA = Type.Object({
  name: Type.String({ description: "Short display name for the job." }),
  command: Type.String({ description: "Shell command to run in the herdr pane." }),
  cwd: Type.Optional(Type.String({ description: "Working directory; relative paths use the current Pi cwd." })),
  kind: Type.Optional(StringEnum(["finite", "service"] as const)),
  placement: Type.Optional(StringEnum(["down", "right", "tab"] as const)),
  ratio: Type.Optional(Type.Number({ minimum: 0.1, maximum: 0.9 })),
  readyPattern: Type.Optional(Type.String({ description: "Substring or regular expression to detect in the durable output log." })),
  readyRegex: Type.Optional(Type.Boolean()),
  readyTimeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  cleanup: Type.Optional(StringEnum(["on_success", "always", "never"] as const)),
  // Deprecated compatibility alias. true maps to never; false maps to always.
  keepPane: Type.Optional(Type.Boolean()),
});

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveCleanup(cleanup: CleanupPolicy | undefined, keepPane: boolean | undefined): CleanupPolicy {
  if (cleanup !== undefined && keepPane !== undefined) throw new Error("Specify cleanup or keepPane, not both.");
  if (cleanup) return cleanup;
  if (keepPane !== undefined) return keepPane ? "never" : "always";
  return "on_success";
}

function shouldCloseAfterTerminal(job: RunningJob, exitCode: number | undefined): boolean {
  return job.metadata.cleanup === "always" || (job.metadata.cleanup === "on_success" && exitCode === 0);
}

function panelTop(title: string, info: string, width: number, border: (text: string) => string): string {
  if (width <= 0) return "";
  if (width === 1) return border("╭");
  const inner = width - 2;
  const titlePart = `─ ${title} `;
  const infoPart = ` ${info} ─`;
  const fill = "─".repeat(Math.max(0, inner - titlePart.length - infoPart.length));
  return border(`╭${`${titlePart}${fill}${infoPart}`.slice(0, inner).padEnd(inner, "─")}╮`);
}

function panelLine(left: string, right: string, width: number, border: (text: string) => string): string {
  if (width <= 0) return "";
  if (width === 1) return border("│");
  const inner = width - 2;
  const rightWidth = visibleWidth(right);
  if (rightWidth >= inner) return `${border("│")}${truncateToWidth(right, inner)}${border("│")}`;
  const truncatedLeft = truncateToWidth(left, Math.max(0, inner - rightWidth));
  const padding = " ".repeat(Math.max(0, inner - visibleWidth(truncatedLeft) - rightWidth));
  return `${border("│")}${truncatedLeft}${padding}${right}${border("│")}`;
}

function panelBottom(width: number, border: (text: string) => string): string {
  if (width <= 0) return "";
  return border(width === 1 ? "╰" : `╰${"─".repeat(width - 2)}╯`);
}

function updateWidget(): void {
  const ctx = runtime.latestCtx;
  if (!ctx?.hasUI) return;
  const activeJobs = [...runtime.jobs.values()].filter((job) => isActive(job.lifecycle));
  const activeAgents = [...runtime.managedAgents.values()].filter((agent) =>
    agent.status !== "completed" && agent.status !== "failed" && agent.status !== "closed",
  );
  if (activeJobs.length === 0 && activeAgents.length === 0) {
    ctx.ui.setWidget("herdr-jobs", undefined);
    clearWidgetTimer(runtime);
    return;
  }
  ctx.ui.setWidget("herdr-jobs", (_tui, theme) => ({
    invalidate() {},
    render(width: number) {
      const now = Date.now();
      const jobs = [...runtime.jobs.values()].filter((job) => isActive(job.lifecycle));
      const agents = [...runtime.managedAgents.values()].filter((agent) =>
        agent.status !== "completed" && agent.status !== "failed" && agent.status !== "closed",
      );
      const active = jobs.length + agents.length;
      const ready = jobs.filter((job) => job.lifecycle.readiness.kind === "ready").length;
      const info = `${active} active${ready ? ` · ${ready} ready` : ""}`;
      const border = (text: string) => theme.fg("accent", text);
      const expanded = runtime.widgetExpanded ?? true;
      const lines = [panelTop(`${expanded ? "▼" : "▶"} herdr jobs`, info, width, border)];
      if (expanded) {
        for (const job of jobs) {
          const projection = projectLifecycle(job.lifecycle, now);
          const color = projection === "failed" ? "error" : projection === "ready" || projection === "completed" ? "success" : projection === "stalled" ? "warning" : "muted";
          const left = ` ${formatElapsed(job.metadata.startedAt, now)}  ${job.metadata.name} `;
          const right = ` ${theme.fg(color, `${projection} · ${job.metadata.paneId}`)} `;
          lines.push(panelLine(left, right, width, border));
        }
        for (const agent of agents) {
          const color = agent.status === "blocked" ? "warning" : agent.status === "working" ? "accent" : "muted";
          const left = ` ${formatElapsed(agent.metadata.startedAt, now)}  ${agent.metadata.name} `;
          const right = ` ${theme.fg(color, `agent ${agent.status} · ${agent.metadata.paneId}`)} `;
          lines.push(panelLine(left, right, width, border));
        }
      } else {
        lines.push(panelLine(` ${theme.fg("dim", "F8 expands jobs")}`, "", width, border));
      }
      lines.push(panelBottom(width, border));
      return lines;
    },
  }), { placement: "aboveEditor" });
}

function toggleWidget(): boolean {
  if (
    ![...runtime.jobs.values()].some((job) => isActive(job.lifecycle)) &&
    ![...runtime.managedAgents.values()].some((agent) => agent.status !== "completed" && agent.status !== "failed" && agent.status !== "closed")
  ) return false;
  runtime.widgetExpanded = !(runtime.widgetExpanded ?? true);
  updateWidget();
  return true;
}

function startWidgetRefresh(): void {
  if (runtime.widgetInterval) return;
  runtime.widgetInterval = setInterval(updateWidget, 1_000);
  updateWidget();
}

function eventKey(job: RunningJob, event: WatchEvent): string {
  return `${job.metadata.id}:${event.kind === "ready" ? "ready" : event.kind === "ready_timeout" ? "status" : "result"}`;
}

function belongsToCurrentSession(job: RunningJob): boolean {
  return runtime.sessionId === job.metadata.parentSessionId;
}

async function deliverEvent(job: RunningJob, event: WatchEvent): Promise<void> {
  if (!belongsToCurrentSession(job) || job.lifecycle.delivery === "suppressed") return;
  await withDeliveryLock(runtime, eventKey(job, event), async () => {
    if (!belongsToCurrentSession(job) || job.lifecycle.delivery === "suppressed") return;
    const ctx = runtime.latestCtx;
    if (!ctx) return;

    if (event.kind === "ready") {
      if (job.lifecycle.readyDelivered || hasSessionDelivery(ctx, job.metadata.id, "ready")) return;
      job.lifecycle.readyDelivered = true;
      await persistJob(job);
      if (!belongsToCurrentSession(job) || !runtime.pi || !runtime.latestCtx) return;
      runtime.pi.sendMessage({ customType: "herdr_job_ready", content: formatReadyMessage(job, event.matchedText), display: true, details: { jobId: job.metadata.id, event: "ready", paneId: job.metadata.paneId } }, { triggerTurn: true, deliverAs: "steer" });
      updateWidget();
      return;
    }

    if (event.kind === "ready_timeout") {
      if (job.lifecycle.timeoutDelivered || hasSessionDelivery(ctx, job.metadata.id, "status")) return;
      job.lifecycle.timeoutDelivered = true;
      await persistJob(job);
      if (!belongsToCurrentSession(job) || !runtime.pi || !runtime.latestCtx) return;
      runtime.pi.sendMessage({ customType: "herdr_job_status", content: formatReadyTimeoutMessage(job), display: true, details: { jobId: job.metadata.id, event: "status", paneId: job.metadata.paneId, status: "ready_timeout" } }, { triggerTurn: true, deliverAs: "steer" });
      updateWidget();
      return;
    }

    const exitCode = event.kind === "result" ? event.result.exitCode : undefined;
    if (job.lifecycle.delivery !== "pending" || hasSessionDelivery(ctx, job.metadata.id, "result")) {
      job.lifecycle.delivery = "delivered";
      await persistJob(job);
      if (!belongsToCurrentSession(job)) return;
      if (shouldCloseAfterTerminal(job, exitCode)) {
        try { await herdr.closePane(job.metadata.paneId); } catch { /* terminal artifacts remain available */ }
        runtime.jobs.delete(job.metadata.id);
      }
      updateWidget();
      return;
    }

    const failure = event.kind === "failure" ? event.error : undefined;
    const content = exitCode === undefined
      ? await formatFailureMessage(job, failure ?? "herdr job watcher failed.")
      : await formatResultMessage(job, exitCode);
    if (!belongsToCurrentSession(job)) return;
    job.lifecycle.delivery = "delivered";
    await persistJob(job);
    if (!belongsToCurrentSession(job) || !runtime.pi || !runtime.latestCtx) return;
    if (shouldCloseAfterTerminal(job, exitCode)) {
      try { await herdr.closePane(job.metadata.paneId); } catch { /* result artifact has already been preserved */ }
      runtime.jobs.delete(job.metadata.id);
    }
    updateWidget();
    runtime.pi.sendMessage({
      customType: "herdr_job_result",
      content,
      display: true,
      details: { jobId: job.metadata.id, event: "result", paneId: job.metadata.paneId, ...(exitCode === undefined ? { error: failure } : { exitCode }) },
    }, { triggerTurn: true, deliverAs: "steer" });
  });
}

function startWatcher(job: RunningJob): void {
  if (job.watcherStarted) return;
  job.watcherStarted = true;
  const controller = new AbortController();
  job.abortController = controller;
  startWidgetRefresh();
  void watchJob(job, controller.signal, herdr, (event) => deliverEvent(job, event))
    .catch(async (error: unknown) => {
      if (controller.signal.aborted || job.lifecycle.delivery === "suppressed") return;
      await deliverEvent(job, { kind: "failure", error: error instanceof Error ? error.message : String(error) });
    });
}

const MANAGED_AGENT_CHILD_EXTENSION = fileURLToPath(new URL("./managed-agent-child.ts", import.meta.url));

function belongsToCurrentAgentSession(agent: RunningManagedAgent): boolean {
  return runtime.sessionId === agent.metadata.parentSessionId;
}

async function deliverManagedAgentResult(agent: RunningManagedAgent, completion: ManagedAgentCompletion | undefined, error?: string): Promise<void> {
  if (agent.delivered || !belongsToCurrentAgentSession(agent)) return;
  await withDeliveryLock(runtime, `managed-agent:${agent.metadata.id}`, async () => {
    if (agent.delivered || !belongsToCurrentAgentSession(agent)) return;
    agent.delivered = true;
    agent.status = error ? "failed" : "completed";
    updateWidget();
    const summary = completion?.summary || await findLastAssistantText(agent.paths.sessionFile) || (error ? "No completion summary was available." : "Managed agent completed without a summary.");
    const content = error
      ? `herdr managed agent "${agent.metadata.name}" failed after ${formatElapsed(agent.metadata.startedAt)}.\nReason: ${error}\nPane: ${agent.metadata.paneId}\nSession: ${agent.paths.sessionFile}`
      : `herdr managed agent "${agent.metadata.name}" completed in ${formatElapsed(agent.metadata.startedAt, completion?.completedAt)}.\nPane: ${agent.metadata.paneId}\nSession: ${agent.paths.sessionFile}\n\n${summary}`;
    if (!runtime.pi) return;
    runtime.pi.sendMessage({
      customType: "herdr_agent_result",
      content,
      display: true,
      details: { agentId: agent.metadata.id, event: "result", name: agent.metadata.name, paneId: agent.metadata.paneId, terminalId: agent.metadata.terminalId, sessionFile: agent.paths.sessionFile, ...(error ? { error } : {}) },
    }, { triggerTurn: true, deliverAs: "steer" });
  });
}

function startManagedAgentWatcher(agent: RunningManagedAgent): void {
  if (agent.watcherStarted) return;
  agent.watcherStarted = true;
  const controller = new AbortController();
  agent.abortController = controller;
  startWidgetRefresh();
  void watchManagedAgent(agent, controller.signal, herdr, updateWidget)
    .then((completion) => deliverManagedAgentResult(agent, completion))
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      return deliverManagedAgentResult(agent, undefined, error instanceof Error ? error.message : String(error));
    });
}

function resolveJob(id?: string, name?: string): RunningJob {
  if (id) {
    const job = runtime.jobs.get(id);
    if (!job) throw new Error(`No tracked herdr job with id ${id}.`);
    return job;
  }
  if (!name) throw new Error("Specify a herdr job id or name.");
  const matches = [...runtime.jobs.values()].filter((job) => job.metadata.name === name);
  if (matches.length === 0) throw new Error(`No tracked herdr job named ${name}.`);
  if (matches.length > 1) throw new Error(`herdr job name ${name} is ambiguous; use one of: ${matches.map((job) => job.metadata.id).join(", ")}.`);
  return matches[0]!;
}

async function validatedCwd(input: string | undefined, ctx: ExtensionContext): Promise<string> {
  const cwd = input ? (isAbsolute(input) ? resolve(input) : resolve(ctx.cwd, input)) : ctx.cwd;
  const info = await stat(cwd);
  if (!info.isDirectory()) throw new Error(`herdr job cwd is not a directory: ${cwd}`);
  return cwd;
}

async function reattach(ctx: ExtensionContext): Promise<void> {
  if (!ctx.sessionManager.getSessionFile()) return;
  const root = getArtifactRoot(ctx.sessionManager.getSessionDir(), ctx.sessionManager.getSessionId());
  let saved: Awaited<ReturnType<typeof listMetadata>>;
  try { saved = await listMetadata(root); } catch (error) { ctx.ui.notify(`Could not scan herdr job artifacts: ${String(error)}`, "warning"); return; }
  for (const { metadata, paths } of saved) {
    if (metadata.delivery !== "pending" || metadata.parentSessionId !== ctx.sessionManager.getSessionId() || runtime.jobs.has(metadata.id)) continue;
    const job = createRunningJob(metadata, paths);
    runtime.jobs.set(metadata.id, job);
    const result = await readResult(paths, metadata.id);
    if (result) job.lifecycle = markResult(job.lifecycle, result);
    startWatcher(job);
  }
  if (runtime.jobs.size) startWidgetRefresh();
}

export default function herdrJobsExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    runtime.pi = pi;
    runtime.latestCtx = ctx;
    runtime.sessionId = ctx.sessionManager.getSessionId();
    updateWidget();
    await reattach(ctx);
  });

  pi.registerShortcut(Key.f8, {
    description: "Expand or collapse Herdr jobs status",
    handler(ctx) {
      if (!toggleWidget()) ctx.ui.notify("No active Herdr jobs to show.");
    },
  });

  pi.on("session_shutdown", async (event) => {
    clearWidgetTimer(runtime);
    if (event.reason === "reload") {
      // Keep watcher state, but never pair the reloaded extension API with the
      // old session context while Pi is rebuilding its extension bindings.
      runtime.pi = undefined;
      runtime.latestCtx = undefined;
      return;
    }
    // Invalidate delivery before aborting so an in-flight formatter cannot send
    // an event into a session which has already been replaced.
    runtime.sessionId = undefined;
    runtime.latestCtx = undefined;
    runtime.pi = undefined;
    for (const job of runtime.jobs.values()) job.abortController?.abort();
    for (const agent of runtime.managedAgents.values()) agent.abortController?.abort();
    runtime.jobs.clear();
    runtime.managedAgents.clear();
  });

  for (const type of ["herdr_job_ready", "herdr_job_result", "herdr_job_status"] as const) {
    pi.registerMessageRenderer(type, (message, options, theme) => {
      const content = typeof message.content === "string" ? message.content : "herdr job event";
      const details = message.details as { exitCode?: unknown } | undefined;
      const exitCode = typeof details?.exitCode === "number" ? details.exitCode : undefined;
      const color = type === "herdr_job_result"
        ? exitCode === 0 ? "success" : "error"
        : type === "herdr_job_ready" ? "success" : "warning";
      const background = type === "herdr_job_result"
        ? exitCode === 0 ? "toolSuccessBg" : "toolErrorBg"
        : "customMessageBg";
      const prefix = type === "herdr_job_result"
        ? exitCode === 0 ? "herdr job complete" : "herdr job failed"
        : type === "herdr_job_ready" ? "herdr job ready" : "herdr job status";
      const outputMarker = "\n\nLast output:\n";
      const outputIndex = content.indexOf(outputMarker);
      const body = !options.expanded && outputIndex >= 0
        ? `${content.slice(0, outputIndex)}\n${theme.fg("dim", "Ctrl+O to show last output")}`
        : content;
      const expandedDetails = options.expanded && message.details
        ? `\n${theme.fg("dim", JSON.stringify(message.details, null, 2))}`
        : "";
      const box = new Box(1, 1, (text) => theme.bg(background, text));
      box.addChild(new Text(`${theme.fg(color, theme.bold(`[${prefix}]`))}\n${theme.fg("customMessageText", body)}${expandedDetails}`, 0, 0));
      return box;
    });
  }

  pi.registerMessageRenderer("herdr_agent_result", (message, options, theme) => {
    const details = message.details as { error?: unknown } | undefined;
    const failed = typeof details?.error === "string";
    const content = typeof message.content === "string" ? message.content : "herdr managed agent event";
    const box = new Box(1, 1, (text) => theme.bg(failed ? "toolErrorBg" : "toolSuccessBg", text));
    box.addChild(new Text(`${theme.fg(failed ? "error" : "success", theme.bold(`[herdr managed agent ${failed ? "failed" : "complete"}]`))}\n${theme.fg("customMessageText", content)}${options.expanded && message.details ? `\n${theme.fg("dim", JSON.stringify(message.details, null, 2))}` : ""}`, 0, 0));
    return box;
  });

  pi.registerTool({
    name: "herdr_agent_start",
    label: "herdr agent start",
    description: "Start a managed Pi agent in a dedicated herdr pane with caller-selected extensions and active tools. Use it for long-running orchestrators, experimental tools, isolated agent environments, or agents needing direct TTY interaction. The child must call herdr_agent_done when it has processed all required descendant results. For ordinary shared-environment delegation, prefer subagent; for non-agent commands, prefer herdr_job_start.",
    promptSnippet: "Start an isolated managed Pi agent in herdr with custom extensions/tools and explicit completion.",
    promptGuidelines: ["Use herdr_agent_start for an isolated Pi orchestrator requiring custom tools or extension loading. Use subagent for ordinary integrated delegation, and herdr_job_start for non-agent commands."],
    parameters: AGENT_START_SCHEMA,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("herdr agent start")), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const name = params.name.trim();
      const task = params.task.trim();
      if (!name || name.length > 80) throw new Error("managed agent name must contain 1–80 characters.");
      if (!task) throw new Error("managed agent task must not be empty.");
      await ensureHerdrAvailable();
      const cwd = await validatedCwd(params.cwd, ctx);
      const extensionMode: AgentExtensionMode = params.extensionMode ?? "normal";
      const extensions = resolveExtensionPaths(params.extensions, cwd);
      for (const extension of extensions) {
        try { await stat(extension); } catch { throw new Error(`Managed agent extension was not found: ${extension}`); }
      }
      const tools = splitCommaList(params.tools);
      const id = createJobId();
      const root = ctx.sessionManager.getSessionFile()
        ? getArtifactRoot(ctx.sessionManager.getSessionDir(), ctx.sessionManager.getSessionId())
        : getArtifactRoot(undefined, undefined);
      const paths = getManagedAgentPaths(root, id);
      await ensureJobDirectory(paths);
      const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const model = params.model ?? parentModel;
      const thinking = params.thinking ?? pi.getThinkingLevel();
      const argv = buildManagedAgentArgv({
        sessionFile: paths.sessionFile,
        childExtension: MANAGED_AGENT_CHILD_EXTENSION,
        task,
        extensionMode,
        extensions,
        ...(tools.length ? { tools } : {}),
        ...(model ? { model } : {}),
        ...(thinking ? { thinking } : {}),
      });
      const launched = await herdr.startAgent({
        name,
        cwd,
        placement: (params.placement ?? "tab") as AgentPlacement,
        env: {
          PI_HERDR_MANAGED_AGENT_ID: id,
          PI_HERDR_MANAGED_AGENT_COMPLETION_FILE: paths.completionFile,
        },
        argv,
      });
      const metadata: ManagedAgentMetadata = {
        version: 1,
        id,
        parentSessionId: ctx.sessionManager.getSessionId(),
        name,
        task,
        cwd,
        paneId: launched.paneId,
        terminalId: launched.terminalId,
        extensionMode,
        extensions,
        ...(tools.length ? { tools } : {}),
        sessionFile: paths.sessionFile,
        startedAt: Date.now(),
      };
      await writeAtomicJson(paths.metadataFile, metadata);
      const agent: RunningManagedAgent = { metadata, paths, status: "starting" };
      runtime.managedAgents.set(id, agent);
      startManagedAgentWatcher(agent);
      return textResult(`herdr managed agent "${name}" started in pane ${launched.paneId}. It will report completion after it calls herdr_agent_done.`, {
        agentId: id,
        paneId: launched.paneId,
        terminalId: launched.terminalId,
        sessionFile: paths.sessionFile,
        extensionMode,
        extensions,
        tools,
        status: "started",
      });
    },
  });

  pi.registerTool({
    name: "herdr_job_start",
    label: "herdr job start",
    description: "Start an ordinary shell command in a dedicated herdr pane and return immediately. This is fire-and-forget: readiness and completion are delivered automatically. Do not poll it with bash, herdr wait, sleeps, or repeated reads.",
    promptSnippet: "Start a non-blocking herdr job for a long-running test, build, server, or watcher; completion arrives automatically.",
    promptGuidelines: ["Use herdr_job_start for ordinary long-running commands in herdr. After calling herdr_job_start, do not poll with bash, herdr wait, sleeps, or repeated reads; wait for its automatic steer notification."],
    parameters: START_SCHEMA,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("herdr job start")), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const name = params.name.trim();
      const command = params.command.trim();
      if (!name || name.length > 80) throw new Error("herdr job name must contain 1–80 characters.");
      if (!command) throw new Error("herdr job command must not be empty.");
      if (params.readyTimeoutMs !== undefined && !params.readyPattern) throw new Error("readyTimeoutMs requires readyPattern.");
      const cleanup = resolveCleanup(params.cleanup, params.keepPane);
      if (params.readyPattern && params.readyRegex) {
        try { new RegExp(params.readyPattern); } catch (error) { throw new Error(`Invalid readiness regular expression: ${error instanceof Error ? error.message : String(error)}`); }
      }
      await ensureHerdrAvailable();
      const cwd = await validatedCwd(params.cwd, ctx);
      const kind: JobKind = params.kind ?? "finite";
      const placement: Placement = params.placement ?? "tab";
      const ratio = params.ratio ?? 0.3;
      const startedAt = Date.now();
      const id = createJobId();
      const root = ctx.sessionManager.getSessionFile()
        ? getArtifactRoot(ctx.sessionManager.getSessionDir(), ctx.sessionManager.getSessionId())
        : getArtifactRoot(undefined, undefined);
      const paths = getJobPaths(root, id);
      await ensureJobDirectory(paths);
      let paneId: string | undefined;
      let metadata: PersistedJobMetadata | undefined;
      try {
        paneId = await herdr.createPane({ name, cwd, placement, ratio });
        try { await herdr.renamePane(paneId, name); } catch { /* pane labels are cosmetic */ }
        metadata = {
          version: 1 as const, id, parentSessionId: ctx.sessionManager.getSessionId(), parentSessionFile: ctx.sessionManager.getSessionFile(), name, command, cwd, kind, paneId, placement, createdAt: startedAt, startedAt,
          ...(params.readyPattern ? { readyPattern: params.readyPattern } : {}), readyRegex: params.readyRegex ?? false,
          ...(params.readyTimeoutMs !== undefined ? { readyTimeoutMs: params.readyTimeoutMs } : {}), cleanup, delivery: "pending" as const, state: "launching",
        };
        await writeRunnerFiles({ id, command: params.command, cwd, paths, startedAt });
        await writeAtomicJson(paths.metadataFile, metadata);
        await sleep(shellReadyDelayMs());
        await herdr.runPane(paneId, paneRunCommand(paths.runnerFile));
        const job = createRunningJob(metadata, paths);
        runtime.jobs.set(id, job);
        startWatcher(job);
        return textResult(`herdr job "${name}" started in pane ${paneId}. Do not poll it; completion will be delivered automatically.`, { jobId: id, paneId, name, kind, cwd, artifactDir: paths.root, logFile: paths.logFile, cleanup, status: "started" });
      } catch (error) {
        // The start tool is already reporting this failure synchronously. Do not
        // leave a pending artifact that a future resume would misreport as a
        // vanished background pane.
        if (metadata) {
          try { await writeAtomicJson(paths.metadataFile, { ...metadata, delivery: "suppressed", state: "launch_failed" }); } catch { /* best effort */ }
        }
        if (paneId) { try { await herdr.closePane(paneId); } catch { /* best effort */ } }
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "herdr_job_interrupt", label: "herdr job interrupt",
    description: "Send Ctrl+C to one tracked herdr job. Tracking continues until the real exit result arrives.",
    parameters: Type.Object({ id: Type.Optional(Type.String()), name: Type.Optional(Type.String()) }),
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("herdr job interrupt")), 0, 0);
    },
    async execute(_id, params) {
      if ((params.id ? 1 : 0) + (params.name ? 1 : 0) !== 1) throw new Error("Specify exactly one of id or name.");
      const job = resolveJob(params.id, params.name);
      await herdr.interruptPane(job.metadata.paneId);
      job.lifecycle = markInterruptRequested(job.lifecycle, Date.now());
      await persistJob(job);
      updateWidget();
      return textResult(`Interrupt requested for herdr job "${job.metadata.name}" (${job.metadata.id}).`, { jobId: job.metadata.id, status: "interrupt_requested" });
    },
  });

  pi.registerTool({
    name: "herdr_job_read", label: "herdr job read",
    description: "Read a bounded tail of a tracked herdr job's durable log. Use for explicit inspection, not polling.",
    parameters: Type.Object({ id: Type.String(), lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("herdr job read")), 0, 0);
    },
    async execute(_id, params) {
      const job = resolveJob(params.id);
      const tail = await readLogTail(job.paths.logFile, params.lines ?? 80);
      return textResult(`${tail.content}${tail.notice ? `\n\n${tail.notice}` : ""}\n\nLog: ${job.paths.logFile}`, { jobId: job.metadata.id, logFile: job.paths.logFile, truncated: tail.truncated });
    },
  });

  pi.registerTool({
    name: "herdr_jobs_list", label: "herdr jobs list",
    description: "List currently tracked asynchronous herdr jobs. This is for explicit inspection, not polling.",
    parameters: Type.Object({}),
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("herdr jobs list")), 0, 0);
    },
    async execute() {
      const jobs = [...runtime.jobs.values()];
      if (!jobs.length) return textResult("No tracked herdr jobs.", { jobs: [] });
      return textResult(jobs.map((job) => `${job.metadata.id}  ${jobSummary(job)}`).join("\n"), { jobs: jobs.map((job) => ({ id: job.metadata.id, name: job.metadata.name, paneId: job.metadata.paneId, kind: job.metadata.kind, state: projectLifecycle(job.lifecycle, Date.now()), readiness: job.lifecycle.readiness.kind, logFile: job.paths.logFile, artifactDir: job.paths.root })) });
    },
  });

  pi.registerTool({
    name: "herdr_job_close", label: "herdr job close",
    description: "Close a tracked herdr job pane. Active jobs require force=true; prefer herdr_job_interrupt first.",
    parameters: Type.Object({ id: Type.String(), force: Type.Optional(Type.Boolean()) }),
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("herdr job close")), 0, 0);
    },
    async execute(_id, params) {
      const job = resolveJob(params.id);
      if (isActive(job.lifecycle) && !params.force) throw new Error("The herdr job is active. Interrupt it first, or pass force: true to close it intentionally.");
      job.lifecycle = markClosed(job.lifecycle, Date.now());
      await persistJob(job);
      job.abortController?.abort();
      await herdr.closePane(job.metadata.paneId);
      runtime.jobs.delete(job.metadata.id);
      updateWidget();
      return textResult(`Closed herdr job pane ${job.metadata.paneId}.`, { jobId: job.metadata.id, status: "closed" });
    },
  });
}
