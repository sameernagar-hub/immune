/**
 * Pre-flight health check.
 *
 * Proves, in order: env loaded → cluster reachable → database writable →
 * $graphLookup available → vector index queryable. Every teammate runs this
 * before writing a line of code, because building against a cluster you have
 * not proven you can reach is how an afternoon disappears.
 */
import { collections, close, describeConnection } from "../src/db.js";
import { config } from "../src/config.js";
import { ensureSchema, vectorIndexStatus, waitForVectorIndex } from "../src/schema.js";
import { embed, embeddingMode } from "../src/embed.js";
import { c, ok, fail, warn, heading, kv } from "../src/render.js";

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(passed ? ok(`${name} ${c.grey(detail || "")}`) : fail(`${name} ${c.red(detail || "")}`));
}

async function main() {
  console.log(heading("IMMUNE · pre-flight"));

  // 1 — environment
  if (config.uris.length === 0) {
    record("environment", false, "no MONGODB_URI — copy .env.example to .env");
    process.exitCode = 1;
    return;
  }
  record(
    "environment",
    true,
    `${config.uris.length} connection candidate${config.uris.length > 1 ? "s" : ""}, db "${config.dbName}"`
  );

  // 2 — connectivity
  let cols;
  try {
    cols = await collections();
    record("cluster reachable", true, describeConnection());
  } catch (err) {
    record("cluster reachable", false, err.message);
    process.exitCode = 1;
    return;
  }

  // 3 — replica set (change streams and transactions both need one)
  try {
    const hello = await cols.db.admin().command({ hello: 1 });
    record(
      "replica set",
      Boolean(hello.setName),
      hello.setName ? `${hello.setName}, primary ${hello.primary ? "present" : "absent"}` : "standalone — no transactions or change streams"
    );
  } catch (err) {
    record("replica set", false, err.message);
  }

  // 4 — schema
  try {
    const { created, vector } = await ensureSchema();
    record(
      "collections + indexes",
      true,
      created.length ? `created ${created.join(", ")}` : "already present"
    );
    record(
      "vector index",
      vector.status !== "UNAVAILABLE",
      vector.created ? "created, building" : `${vector.status}${vector.error ? ` — ${vector.error}` : ""}`
    );
  } catch (err) {
    record("collections + indexes", false, err.message);
  }

  // 5 — write and read back
  try {
    const probe = await cols.runs.insertOne({ kind: "doctor", started_at: new Date() });
    await cols.runs.deleteOne({ _id: probe.insertedId });
    record("read/write", true, "insert and delete round-tripped");
  } catch (err) {
    record("read/write", false, err.message);
  }

  // 6 — $graphLookup, the mechanism we cannot ship without
  try {
    const probe = await cols.beliefs
      .aggregate([
        { $limit: 1 },
        {
          $graphLookup: {
            from: "beliefs",
            startWith: "$_id",
            connectFromField: "_id",
            connectToField: "derived_from",
            as: "descendants",
            maxDepth: 6,
            depthField: "distance",
          },
        },
      ])
      .toArray();
    record("$graphLookup", true, `traversal stage accepted (${probe.length} doc scanned)`);
  } catch (err) {
    record("$graphLookup", false, err.message);
  }

  // 7 — embeddings
  const vec = await embed("refunds are paid to account 4471");
  record("embeddings", vec.length === config.embedding.dimensions, `${embeddingMode()}, dim ${vec.length}`);

  // 8 — vector index queryable (the ~40 s wait, surfaced rather than hidden)
  let status = await vectorIndexStatus();
  if (status !== "READY" && status !== "UNAVAILABLE" && status !== "MISSING") {
    console.log(warn(`vector index is ${status} — waiting (this takes ~40 s on first build)`));
    const waited = await waitForVectorIndex({
      onTick: (s) => process.stdout.write(`\r    ${c.grey(`${s}s…`)}`),
    });
    process.stdout.write("\r                    \r");
    status = waited.ready ? "READY" : waited.status;
  }
  record(
    "vector index queryable",
    status === "READY",
    status === "READY" ? "READY" : `${status} — retrieval will use the $match fallback`
  );

  const hard = results.filter((r) => !r.passed && r.name !== "vector index queryable" && r.name !== "vector index");
  console.log(heading(hard.length === 0 ? c.green("ALL GREEN") : c.red("BLOCKED")));
  console.log(kv("connection", describeConnection()));
  console.log(kv("database", config.dbName));
  console.log(kv("embeddings", embeddingMode()));
  console.log(kv("vector index", status));
  if (status !== "READY") {
    console.log(
      kv("note", c.yellow("vector search degraded — src/retrieve.js falls back automatically"))
    );
  }
  console.log("");
  if (hard.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(fail(err.stack || err.message));
    process.exitCode = 1;
  })
  .finally(close);
