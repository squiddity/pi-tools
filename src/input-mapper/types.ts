export type InputKey = "up" | "down" | "enter" | "space" | "escape" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12";
export type MouseReport = "wheel-up" | "wheel-down" | "left-release" | "right-release";

export type InputMapping = {
  report: MouseReport;
  send: InputKey;
};

export type InputProfile = {
  id: string;
  activate?: { tool?: string };
  mouse?: { protocol?: "sgr"; tracking?: "buttons" };
  gestures?: {
    thresholdCells?: number;
    axisLockRatio?: number;
    suppressTapAfterWheel?: boolean;
  };
  mappings: InputMapping[];
};

export type InputMapperConfig = {
  version: 1;
  profiles: Record<string, Partial<Omit<InputProfile, "id">>>;
};

export type ConfigSource = "user" | "project";

export type ResolvedProfile = InputProfile & { sources: ConfigSource[] };

export type DiagnosticEntry = {
  at: number;
  raw: string;
  decoded?: string;
  profile?: string;
  action?: string;
  decision: "pass" | "consume" | "substitute";
};
