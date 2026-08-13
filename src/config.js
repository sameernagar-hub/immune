/**
 * Configuration and environment loading.
 *
 * Deliberately dependency-free: a five-line .env parser is cheaper than a
 * package, and it means `npm install` has exactly one dependency (the driver).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue; // real env wins
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

export const config = {
  /**
   * Connection candidates, tried in order.
   *
   * `mongodb+srv://` needs a DNS SRV lookup, which some networks refuse even
   * when ordinary name resolution works — venue and conference wifi are common
   * offenders, and it fails with `querySrv ECONNREFUSED` on a perfectly healthy
   * link. The direct form addresses the same cluster by its shard hosts with an
   * explicit replicaSet and never asks for an SRV record, so it survives that.
   *
   * This is an environment fault, not a code fault, which is why the fix is a
   * second connection string rather than a resolver override in application code.
   */
  uris: [process.env.MONGODB_URI, process.env.MONGODB_URI_DIRECT].filter(Boolean),
  dbName: process.env.MONGODB_DB || "immune",

  embedding: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.EMBED_MODEL || "openai/text-embedding-3-small",
    /** Dimension is pinned so a provider swap can never silently break the index. */
    dimensions: 256,
  },

  llm: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model: process.env.OPENROUTER_MODEL || "anthropic/claude-3.5-haiku",
    temperature: 0, // demo determinism, non-negotiable
    maxTokens: 400,
  },

  vectorIndex: "belief_vec",
  searchIndex: "belief_text",

  /** Retrieval pre-filter floor. A source below this is invisible to the agent. */
  minTrust: 0.5,
};

export const COLLECTIONS = ["sources", "beliefs", "actions", "runs"];
