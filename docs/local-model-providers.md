# Bespoke local model provider extensions

Reference for adding a locally served, OpenAI-compatible model server (llama.cpp, llama.cpp-served GGUF,
vLLM, Lemonade, MLX, custom uvicorn wrappers) as a Pi provider without making that server part of Pi's
startup failure surface.

Companion operational template: [`../skills/local-model-provider/SKILL.md`](../skills/local-model-provider/SKILL.md).

## Two server families

- **OpenAI-compatible** — `GET /v1/models` (llama.cpp server, vLLM, MLX, most custom uvicorn wrappers).
  Context length may ride along as `context_length`, `max_model_len`, or `meta.n_ctx`.
- **Ollama-compatible** — `GET /api/tags` for the list and `POST /api/show` for per-model metadata
  (`<architecture>.context_length`, or `llamacpp.context_length`). Lemonade serves this family.

One template covers both: try Ollama discovery first, fall back to `/v1/models`. A `404` from `/api/tags`
on a plain OpenAI-compatible server is expected, not an error.

## Why the obvious shape is wrong

The natural implementation is an async extension factory that discovers models, then registers them:

```ts
export default async function (pi: ExtensionAPI) {
  const ids = await fetchModelIds();        // ❌ network before registration
  pi.registerProvider("mylocal", { models: ids.map(...) });
}
```

With the server stopped this becomes a **hard startup failure**, not a degraded provider:

- `pi-coding-agent/dist/core/extensions/loader.js` does `await factory(api)` inside `initializeExtension`,
  and any rejection is reported as `Failed to load extension: <message>`.
- `main()` collects those as `type: "error"` diagnostics and calls `process.exit(1)`.

So one stopped optional server aborts the whole session and takes every other extension with it.

Independently, `docs/custom-provider.md` states: *"Pi waits for asynchronous factories before startup
continues."* An async factory also serializes startup behind every discovery round trip — including N
per-model `/api/show` probes.

**Rule: registration is synchronous and unconditional; discovery is always deferred and fallible.**

## The pattern

Four properties, in order:

1. **Sync register first.** The factory returns immediately after `pi.registerProvider()`.
2. **Fallback catalog.** Register at least the model ID you normally use, so it is selectable while the
   server is down. A live refresh replaces it.
3. **`refreshModels` for live discovery.** Legacy `ProviderConfig.refreshModels` returns model
   definitions and Pi replaces that registration's live models. Thread `context.signal` into I/O.
4. **Bounded, swallowed background warm-up.** Kick discovery with `void` and a timeout; catch everything.
   An offline server is a normal state, not an error.

```ts
export default function (pi: ExtensionAPI) {
  pi.registerProvider(PROVIDER_NAME, {
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: API_KEY,
    models: FALLBACK_MODEL_IDS.map((id) => toModelConfig(id, DEFAULT_CONTEXT_WINDOW)),
    refreshModels: ({ signal }) => discover(signal ?? AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)),
  });

  void refreshInBackground(pi); // never awaited by the factory
}
```

## Checklist

| # | Rule | Failure avoided |
|---|---|---|
| 1 | Factory is sync; no `await` of network before `registerProvider()` | `process.exit(1)` on cold start with server down |
| 2 | Every `fetch` gets `AbortSignal.timeout(...)` (5s typical), merged with the caller signal via `AbortSignal.any([signal, timeout])` | hung-but-open TCP socket stalls startup forever |
| 3 | `refreshModels: ({ signal }) => discover(signal)` | catalog frozen at startup; new models need a restart |
| 4 | `FALLBACK_MODEL_IDS` keeps the usual model selectable | nothing selectable while the server is down |
| 5 | Background discovery wrapped in `try/catch`; factory never rejects | load-failure diagnostic + exit 1 |
| 6 | Base URL and API key come from env (`PI_<NAME>_BASE_URL` / `PI_<NAME>_API_KEY`) with sane defaults; no host paths committed | extension is unportable across machines |
| 7 | Verify the address family: a `.lan` hostname with AAAA records may reset while IPv4 works — pin the IPv4 literal if so | `fetch failed` / `ECONNRESET` against a healthy server |
| 8 | Context window discovered with fallback (`128_000`); `maxTokens = Math.floor(ctx / 8)` | truncation or rejected requests |
| 9 | Read every context field the server might use: `context_length`, `max_model_len`, `meta.n_ctx`, `meta.n_ctx_train` | silently wrong window size |
| 10 | Thinking metadata verified against the real server, never assumed (see below) | dead `--thinking` levels, wasted tokens, empty replies |
| 11 | `normalizeModelId()` strips `:latest`; dedupe with `Map`/`Set` | duplicate entries, mismatched IDs |
| 12 | Type optional numbers as `number \| undefined` — do not copy `undefined as unknown as number` | lies to the type checker |

## Thinking metadata: measure, don't guess

Pi's level ladder is a fixed enum (`off, minimal, low, medium, high, xhigh, max`). Two functions in
`@earendil-works/pi-ai/dist/models.js` define what a model actually exposes:

- `getSupportedThinkingLevels(model)` — returns `["off"]` when `reasoning: false`; otherwise drops any
  level mapped to `null`, and drops `xhigh`/`max` unless explicitly mapped.
- `clampThinkingLevel(model, level)` — maps an unavailable request to the nearest available level.

Request-side, `api/openai-completions.js` only sends `reasoning_effort` when
`compat.supportsReasoningEffort` is set, and sends the `off` mapping when thinking is off. Response-side,
thinking deltas are picked up from `reasoning_content` / `reasoning` / `reasoning_text` **regardless of
the `reasoning` flag** — so a thinking server leaks thinking blocks into the transcript even when you
declared `reasoning: false`.

Probe the server before choosing. For the `halogen-flash` server:

| `reasoning_effort` sent | reasoning tokens |
|---|---|
| none sent | 26 |
| `low` / `medium` / `high` / `minimal` | 26 (ignored) |
| `none` | **0** |

That server is binary, so collapse the ladder to two states:

```ts
reasoning: true,
thinkingLevelMap: { off: "none", minimal: null, low: null, medium: null, high: "high" },
compat: { supportsReasoningEffort: true },
```

Result: the cycle is `off ↔ high`, and any requested on-level clamps to `high`. Pi's level names cannot
be renamed, so the "on" state displays as `high`.

If the model does not think at all, use `reasoning: false` and omit `thinkingLevelMap` and
`supportsReasoningEffort`.

## Verification recipe

```sh
# 1. Registered and discoverable?
pi --list-models | grep <provider>

# 2. Actually answers?
pi --model <provider>/<model> -p 'Reply with exactly OK.'

# 3. Tool loop works?
pi --model <provider>/<model> -p 'Use the bash tool to run: echo probe — then report the output.'

# 4. Thinking really toggles? Compare reasoning tokens in the newest session file.
pi --model <provider>/<model> --thinking off   -p 'What is 17*23? Answer with just the number.'
pi --model <provider>/<model> --thinking high  -p 'What is 17*23? Answer with just the number.'
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

Server-side probes, run from the machine that hosts Pi:

```sh
curl -4 -sv --max-time 5 http://<host>:<port>/v1/models      # -4 forces IPv4
curl -sv --max-time 5 http://127.0.0.1:<port>/v1/models
ss -ltnp | grep ":<port>"
```

A `404` on `/api/tags` is **expected** for a plain OpenAI-compatible server and is not a failure — that
endpoint is Ollama-specific.

## Status of local provider code

| Location | Shape | Notes |
|---|---|---|
| `extensions/lemonade-provider/` | **removed** | Violated rules 1–5: its async factory awaited discovery before registering, so a stopped Lemonade server produced `Failed to load extension` and a non-zero Pi exit. Ollama-compatible connections like Lemonade are now generated from the skill rather than maintained as repo code. |
| `~/.pi/agent/extensions/q38rocm-provider.ts` | ✅ non-blocking | Fallback catalog + `refreshModels` + 5s timeout. Not in the repo, so a fresh environment does not get it. |
| `~/.pi/agent/extensions/halogen-flash-provider.ts` | ✅ non-blocking | Adds IPv4 pinning and the collapsed two-state thinking map. Also outside the repo. |

The two working bespoke providers are the practical worked example until they are migrated in; see
[`../extensions/README.md`](../extensions/README.md).

## Related upstream docs

- [`custom-provider.md`](/home/squiddity/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md) — registration forms, `refreshModels` contracts, compat flags
- [`models.md`](/home/squiddity/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md) — `models.json`, the no-code path for compatible endpoints
