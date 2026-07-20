export const DEFAULT_BASE_URL = "http://127.0.0.1:13305/v1";
export const DEFAULT_API_KEY = "ollama";

export function getBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_LEMONADE_BASE_URL ?? env.LEMONADE_BASE_URL ?? DEFAULT_BASE_URL;
}

export function getApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_LEMONADE_API_KEY ?? env.LEMONADE_API_KEY ?? DEFAULT_API_KEY;
}

export function toRootUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

export function normalizeModelId(id: string): string {
  return id.trim().replace(/:latest$/i, "");
}
