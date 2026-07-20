import type { StringDecoder } from "node:string_decoder";

export const JOB_METADATA_VERSION = 1 as const;
export const JOB_RESULT_VERSION = 1 as const;

export type JobKind = "finite" | "service";
export type Placement = "down" | "right" | "tab";
export type DeliveryState = "pending" | "delivered" | "suppressed";
export type CleanupPolicy = "on_success" | "always" | "never";
export type PaneDisposition = "open" | "retained" | "closed" | "missing" | "closing" | "unknown";
export type TrackingDisposition = "active" | "retained" | "removed";
export type AgentExtensionMode = "normal" | "explicit";
export type AgentPlacement = "down" | "right" | "tab";

export interface ManagedAgentPaths {
  root: string;
  metadataFile: string;
  completionFile: string;
  sessionFile: string;
}

export interface ManagedAgentMetadata {
  version: 1;
  id: string;
  parentSessionId?: string;
  name: string;
  task: string;
  cwd: string;
  paneId: string;
  terminalId: string;
  extensionMode: AgentExtensionMode;
  extensions: string[];
  tools?: string[];
  sessionFile: string;
  startedAt: number;
}

export interface ManagedAgentCompletion {
  version: 1;
  id: string;
  completedAt: number;
  summary?: string;
}

export interface RunningManagedAgent {
  metadata: ManagedAgentMetadata;
  paths: ManagedAgentPaths;
  status: "starting" | "working" | "idle" | "blocked" | "completed" | "failed" | "closed";
  abortController?: AbortController;
  watcherStarted?: boolean;
  delivered?: boolean;
}

export interface JobPaths {
  root: string;
  commandFile: string;
  runnerFile: string;
  logFile: string;
  metadataFile: string;
  resultFile: string;
}

export interface PersistedJobMetadata {
  version: typeof JOB_METADATA_VERSION;
  id: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  name: string;
  command: string;
  cwd: string;
  kind: JobKind;
  paneId: string;
  placement: Placement;
  createdAt: number;
  startedAt: number;
  readyPattern?: string;
  readyRegex: boolean;
  readyTimeoutMs?: number;
  cleanup: CleanupPolicy;
  delivery: DeliveryState;
  state: string;
}

export interface JobResultArtifact {
  version: typeof JOB_RESULT_VERSION;
  id: string;
  exitCode: number;
  signal?: string;
  startedAt: number;
  completedAt: number;
}

export type ProcessState =
  | { kind: "launching"; startedAt: number }
  | { kind: "running"; startedAt: number; confirmedAt: number }
  | { kind: "interrupt_requested"; startedAt: number; requestedAt: number }
  | { kind: "completed"; startedAt: number; completedAt: number; exitCode: number }
  | { kind: "failed"; startedAt: number; completedAt: number; error: string; exitCode?: number }
  | { kind: "closed"; startedAt: number; closedAt: number };

export type ReadinessState =
  | { kind: "not_configured" }
  | { kind: "waiting"; since: number }
  | { kind: "ready"; detectedAt: number; matchedText?: string }
  | { kind: "timed_out"; timedOutAt: number };

export interface JobLifecycle {
  process: ProcessState;
  readiness: ReadinessState;
  delivery: DeliveryState;
  readyDelivered: boolean;
  timeoutDelivered: boolean;
  paneFailureSince?: number;
  paneMissingAt?: number;
}

export interface RunningJob {
  metadata: PersistedJobMetadata;
  paths: JobPaths;
  lifecycle: JobLifecycle;
  abortController?: AbortController;
  watcherStarted?: boolean;
  logOffset: number;
  logDecoder: StringDecoder;
  logRemainder: string;
  regexWindow: string;
  lastPaneCheckAt: number;
}

export type PaneInspection =
  | { kind: "present" }
  | { kind: "missing"; error?: string }
  | { kind: "unavailable"; error: string };

export type WatchEvent =
  | { kind: "ready"; matchedText?: string }
  | { kind: "ready_timeout" }
  | { kind: "result"; result: JobResultArtifact }
  | { kind: "failure"; error: string };

export interface HerdrAgentLaunch {
  paneId: string;
  terminalId: string;
}

export interface HerdrAgentInspection {
  kind: "present";
  status: "idle" | "working" | "blocked" | "done" | "unknown";
}

export interface HerdrOperations {
  createPane(options: {
    name: string;
    cwd: string;
    placement: Placement;
    ratio: number;
  }): Promise<string>;
  renamePane(paneId: string, name: string): Promise<void>;
  runPane(paneId: string, command: string): Promise<void>;
  inspectPane(paneId: string): Promise<PaneInspection>;
  readPane(paneId: string, lines: number): Promise<string>;
  interruptPane(paneId: string): Promise<void>;
  closePane(paneId: string): Promise<void>;
  startAgent(options: { name: string; cwd: string; placement: AgentPlacement; env: Record<string, string>; argv: string[] }): Promise<HerdrAgentLaunch>;
  inspectAgent(target: string): Promise<HerdrAgentInspection | { kind: "missing"; error?: string } | { kind: "unavailable"; error: string }>;
  readAgent(target: string, lines: number): Promise<string>;
  sendAgentText(target: string, text: string): Promise<void>;
}
