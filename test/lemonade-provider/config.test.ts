import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BASE_URL, getApiKey, getBaseUrl, normalizeModelId, toRootUrl } from "../../src/lemonade-provider/config.ts";

test("lemonade config uses a generic local default", () => {
  assert.equal(getBaseUrl({}), DEFAULT_BASE_URL);
  assert.equal(getApiKey({}), "ollama");
});

test("lemonade config supports namespaced environment variables", () => {
  assert.equal(getBaseUrl({ PI_LEMONADE_BASE_URL: "http://host.example/v1" }), "http://host.example/v1");
  assert.equal(getApiKey({ PI_LEMONADE_API_KEY: "secret" }), "secret");
});

test("lemonade config supports legacy short environment variables", () => {
  assert.equal(getBaseUrl({ LEMONADE_BASE_URL: "http://host.example/v1" }), "http://host.example/v1");
  assert.equal(getApiKey({ LEMONADE_API_KEY: "secret" }), "secret");
});

test("lemonade URLs and model ids are normalized", () => {
  assert.equal(toRootUrl("http://localhost:13305/v1/"), "http://localhost:13305");
  assert.equal(normalizeModelId(" model:latest "), "model");
});
