---
name: local-model-provider
description: Register a locally served OpenAI-compatible or Ollama-compatible model server (llama.cpp, GGUF, vLLM, MLX, Lemonade, custom uvicorn) as a Pi provider. Use when wiring up a new local model endpoint, when a provider extension fails with "Failed to load extension: fetch failed", when a local model's context window or thinking levels behave wrong, or when recreating local providers on a fresh machine.
---

# Local model provider

Add a bespoke local model server as a Pi provider without letting that server affect Pi startup. No
provider extensions are maintained in the repo — generate one here instead.

Read `../../docs/local-model-providers.md` in the repo for rationale and evidence. The rules below are
the operative version.

## Step 1 — identify the server family

Two families, different discovery endpoints:

| Family | List models | Per-model metadata |
|---|---|---|
| OpenAI-compatible | `GET /v1/models` | fields on the model entry (`context_length`, `max_model_len`, `meta.n_ctx`) |
| Ollama-compatible (Lemonade) | `GET /api/tags` | `POST /api/show` → `<arch>.context_length` / `llamacpp.context_length` |

Probe from the machine that hosts Pi (use `-4` to rule out IPv6 problems early):

```sh
curl -4 -s -o /dev/null -w 'api/tags   %{http_code}\n' --max-time 5 http://HOST:PORT/api/tags
curl -4 -s -o /dev/null -w 'v1/models  %{http_code}\n' --max-time 5 http://HOST:PORT/v1/models
```

`404` on `/api/tags` is expected for a plain OpenAI-compatible server and is not a failure. The template
below auto-detects, so an unknown family is fine.

## Hard rules

1. **The extension factory must be synchronous.** Never `await` network I/O before
   `pi.registerProvider()`. Pi awaits async factories, and a rejected factory becomes
   `Failed to load extension: <msg>` → `process.exit(1)`. A stopped local server must never be able to
   kill the session.
2. **Every fetch is bounded.** `AbortSignal.timeout(5_000)`, merged with the caller's signal via
   `AbortSignal.any([signal, timeout])`. A hung-but-open socket otherwise stalls startup forever.
3. **Register a fallback catalog.** Put the model ID you normally use in `FALLBACK_MODEL_IDS` so it is
   selectable while the server is down.
4. **Provide `refreshModels`** so the live catalog can be re-discovered without restarting Pi.
5. **Background warm-up is `void` + `try/catch`.** Offline is a normal state, not an error.
6. **No host paths or secrets in committed files.** Base URL and key come from env vars with defaults.
   `ollama` is the usual local placeholder key, not a credential.

## Step 2 — template

Copy to `~/.pi/agent/extensions/<name>-provider.ts` and edit the CONFIG block.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ---- CONFIG ---------------------------------------------------------------
const PROVIDER_NAME = "mylocal";
const BASE_URL = process.env.PI_MYLOCAL_BASE_URL ?? "http://127.0.0.1:11434/v1";
const API_KEY = process.env.PI_MYLOCAL_API_KEY ?? "ollama";
const FALLBACK_MODEL_IDS = ["my-model-id"]; // keep selectable while the server is down
// "auto" tries Ollama-style discovery then OpenAI-style. Pin it once known.
const FAMILY: "auto" | "openai" | "ollama" = "auto";
// -------------------------------------------------------------------------

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DISCOVERY_TIMEOUT_MS = 5_000;

type Discovered = { id: string; contextWindow?: number };

function normalizeModelId(id: string): string {
  return id.trim().replace(/:latest$/i, "");
}

function toModelConfig(id: string, contextWindow: number) {
  return {
    id,
    name: `${id} (Local)`,
    input: ["text"] as const,
    // Verify thinking against the real server before copying this block.
    // If the model does not think, use: reasoning: false, and drop the next two fields.
    reasoning: true,
    thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high" },
    compat: { supportsReasoningEffort: true },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.floor(contextWindow / 8),
  };
}

function withTimeout(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function rootUrl(): string {
  return BASE_URL.replace(/\/+$/, "").replace(/\/v1$/, "");
}

// --- Ollama-compatible: /api/tags + /api/show ------------------------------
async function discoverOllama(signal: AbortSignal): Promise<Discovered[]> {
  const res = await fetch(`${rootUrl()}/api/tags`, { signal });
  if (!res.ok) return [];
  const payload = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
  return (payload.models ?? [])
    .map((model) => ({ id: normalizeModelId(model.model ?? model.name ?? "") }))
    .filter((model) => model.id.length > 0);
}

async function ollamaContextLength(id: string, signal: AbortSignal): Promise<number | undefined> {
  try {
    const res = await fetch(`${rootUrl()}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: id }),
      signal,
    });
    if (!res.ok) return undefined;
    const info = ((await res.json()) as { model_info?: Record<string, string | number> }).model_info ?? {};
    const arch = String(info["general.architecture"] ?? "");
    const length = info[`${arch}.context_length`] ?? info["llamacpp.context_length"];
    return typeof length === "number" && length > 0 ? length : undefined;
  } catch {
    return undefined;
  }
}

// --- OpenAI-compatible: /v1/models ----------------------------------------
async function discoverOpenAi(signal: AbortSignal): Promise<Discovered[]> {
  const res = await fetch(`${BASE_URL.replace(/\/+$/, "")}/models`, { signal });
  if (!res.ok) throw new Error(`Model discovery failed (${res.status} ${res.statusText})`);
  const payload = (await res.json()) as {
    data?: Array<{
      id?: string;
      context_length?: number;
      max_model_len?: number;
      meta?: { n_ctx?: number; n_ctx_train?: number };
    }>;
  };
  return (payload.data ?? [])
    .filter((model): model is typeof model & { id: string } => Boolean(model.id?.trim()))
    .map((model) => ({
      id: normalizeModelId(model.id),
      contextWindow:
        model.context_length ?? model.max_model_len ?? model.meta?.n_ctx ?? model.meta?.n_ctx_train,
    }));
}

async function discover(signal?: AbortSignal) {
  const scoped = withTimeout(signal);
  if (FAMILY !== "openai") {
    const ollama = await discoverOllama(scoped).catch(() => [] as Discovered[]);
    if (ollama.length > 0) {
      const contexts = await Promise.all(
        ollama.map((model) => ollamaContextLength(model.id, scoped).catch(() => undefined)),
      );
      return ollama.map((model, index) =>
        toModelConfig(model.id, contexts[index] ?? DEFAULT_CONTEXT_WINDOW),
      );
    }
    if (FAMILY === "ollama") throw new Error("Ollama-style discovery returned no models");
  }
  const openAi = await discoverOpenAi(scoped);
  return openAi.map((model) => toModelConfig(model.id, model.contextWindow ?? DEFAULT_CONTEXT_WINDOW));
}

async function warmUp(pi: ExtensionAPI): Promise<void> {
  try {
    const models = await discover();
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl: BASE_URL,
      api: "openai-completions",
      apiKey: API_KEY,
      models,
    });
  } catch {
    // Server optional and currently offline: keep the fallback catalog.
  }
}

export default function (pi: ExtensionAPI) {
  // Synchronous and unconditional. Discovery is deferred and fallible.
  pi.registerProvider(PROVIDER_NAME, {
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: API_KEY,
    models: FALLBACK_MODEL_IDS.map((id) => toModelConfig(id, DEFAULT_CONTEXT_WINDOW)),
    refreshModels: ({ signal }) => discover(signal),
  });

  void warmUp(pi);
}
```

## Step 3 — verify before calling it done

```sh
pi --list-models | grep <provider>                                  # registered
pi --model <provider>/<model> -p 'Reply with exactly OK.'           # answers
pi --model <provider>/<model> -p 'Use the bash tool to run: echo probe — report the output.'
```

Thinking really toggles (compare reasoning tokens in the newest session file):

```sh
pi --model <provider>/<model> --thinking off  -p 'What is 17*23? Answer with just the number.'
pi --model <provider>/<model> --thinking high -p 'What is 17*23? Answer with just the number.'
python3 - <<'PY'
import glob, json, os
newest = max(glob.glob(os.path.expanduser("~/.pi/agent/sessions/*/*.jsonl")), key=os.path.getmtime)
for line in open(newest):
    d = json.loads(line)
    if d.get("type") == "thinking_level_change":
        print("level ->", d.get("thinkingLevel"))
    m = d.get("message", {})
    if m.get("role") == "assistant":
        u = m.get("usage", {})
        print("reasoning:", u.get("reasoning"), "| output:", u.get("output"))
PY
```

Expected: `off` → `reasoning: 0`; `high` → non-zero reasoning tokens. If both are zero, the `off`
mapping or `supportsReasoningEffort` is wrong. If the levels are indistinguishable, the server is binary
— collapse the ladder with `null` as in the template.

## Gotchas

- **IPv6 that resets.** A `.lan`/mDNS hostname with AAAA records can `ECONNRESET` while IPv4 works.
  Probe with `curl -4 -sv --max-time 5 http://HOST:PORT/v1/models` and, if only IPv4 works, pin the
  IPv4 literal in `BASE_URL` with a comment explaining why.
- **Thinking leaks regardless of the flag.** Pi reads `reasoning_content`/`reasoning`/`reasoning_text`
  deltas even with `reasoning: false`, so declaring `false` does not suppress thinking — only
  `reasoning_effort: "none"` (or the server equivalent) does.
- **Level names are a fixed enum.** You cannot label the on-state `on`; pick one level (`high` reads as
  "thinking enabled", `low` reads humbler) and null out the rest.
- **Empty replies with tiny `max_tokens`.** A reasoning model can spend the whole budget on thinking and
  return empty `content`. That is a budget artifact, not a broken provider.
- **`/reload` or restart** is required for provider metadata changes to take effect in a live session.
