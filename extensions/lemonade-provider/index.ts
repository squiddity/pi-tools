import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getApiKey, getBaseUrl, normalizeModelId, toRootUrl } from "../../src/lemonade-provider/config.ts";

const baseUrl = getBaseUrl();
const apiKey = getApiKey();

type OllamaTagsResponse = {
  models?: Array<{ name?: string; model?: string }>;
};

type OpenAIModelsResponse = {
  data?: Array<{ id?: string }>;
};

type OllamaShowResponse = {
  model_info?: Record<string, string | number>;
};

function titleCaseModel(id: string): string {
  return `${id} (Local)`;
}

async function fetchContextLength(modelId: string): Promise<number | undefined> {
  try {
    const response = await fetch(`${toRootUrl(baseUrl)}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId }),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as OllamaShowResponse;
    const info = payload.model_info ?? {};
    const architecture = String(info["general.architecture"] ?? "");
    const length = info[`${architecture}.context_length`] ?? info["llamacpp.context_length"];
    return typeof length === "number" && length > 0 ? length : undefined;
  } catch {
    return undefined;
  }
}

async function fetchModelIds(): Promise<string[]> {
  const rootUrl = toRootUrl(baseUrl);

  // Lemonade exposes Ollama-compatible discovery. Keep an OpenAI-compatible
  // fallback for deployments that only expose /v1/models.
  try {
    const response = await fetch(`${rootUrl}/api/tags`);
    if (response.ok) {
      const payload = (await response.json()) as OllamaTagsResponse;
      const ids = (payload.models ?? [])
        .map((model) => model.model ?? model.name)
        .filter((id): id is string => Boolean(id?.trim()))
        .map(normalizeModelId);
      if (ids.length > 0) return [...new Set(ids)];
    }
  } catch {
    // Try the OpenAI-compatible endpoint below.
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`);
  if (!response.ok) {
    throw new Error(`Failed model discovery (${response.status} ${response.statusText})`);
  }
  const payload = (await response.json()) as OpenAIModelsResponse;
  const ids = (payload.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => Boolean(id?.trim()))
    .map(normalizeModelId);
  return [...new Set(ids)];
}

export default async function lemonadeProvider(pi: ExtensionAPI): Promise<void> {
  const ids = await fetchModelIds();
  const contextLengths = await Promise.all(ids.map((id) => fetchContextLength(id)));

  pi.registerProvider("lemonade", {
    baseUrl,
    api: "openai-completions",
    apiKey,
    models: ids.map((id, index) => {
      const contextWindow = contextLengths[index] ?? 128_000;
      return {
        id,
        name: titleCaseModel(id),
        input: ["text"],
        reasoning: false,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: Math.floor(contextWindow / 8),
      };
    }),
  });
}
