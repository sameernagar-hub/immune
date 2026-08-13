/**
 * Connection management.
 *
 * One client for the whole process, opened lazily, reused everywhere. The
 * driver pools connections internally, so opening a second client per module
 * would burn cluster connection slots for nothing.
 */
import { MongoClient } from "mongodb";
import { config } from "./config.js";

let client = null;
let db = null;
let usedUri = null;

/**
 * Connects, walking the URI candidates in order.
 *
 * Candidate 1 is the SRV form; candidate 2 is the direct form used when the
 * network refuses SRV lookups. Falling through is silent by design: the
 * fallback is expected on venue wifi, and a stack trace at 4:10 PM is a
 * distraction, not information. `describeConnection()` reports which one won.
 */
export async function getDb() {
  if (db) return { db, client, uri: usedUri };

  if (config.uris.length === 0) {
    throw new Error(
      "No connection string. Copy .env.example to .env and set MONGODB_URI."
    );
  }

  const failures = [];
  for (const uri of config.uris) {
    try {
      const candidate = new MongoClient(uri, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
      });
      await candidate.connect();
      await candidate.db(config.dbName).command({ ping: 1 });
      client = candidate;
      db = client.db(config.dbName);
      usedUri = uri;
      return { db, client, uri };
    } catch (err) {
      failures.push(`${scheme(uri)}: ${err.message.split("\n")[0]}`);
    }
  }

  throw new Error(
    `Could not reach the cluster on any connection string.\n  ${failures.join("\n  ")}`
  );
}

export function scheme(uri) {
  return uri.startsWith("mongodb+srv://") ? "SRV" : "direct";
}

export function describeConnection() {
  if (!usedUri) return "not connected";
  const host = usedUri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, "").split(/[/?,]/)[0];
  return `${host} (${scheme(usedUri)})`;
}

export async function collections() {
  const { db } = await getDb();
  return {
    db,
    sources: db.collection("sources"),
    beliefs: db.collection("beliefs"),
    actions: db.collection("actions"),
    runs: db.collection("runs"),
  };
}

export async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    usedUri = null;
  }
}
