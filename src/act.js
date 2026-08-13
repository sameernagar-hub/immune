/**
 * Actions — things the agent actually did, and what justified them.
 *
 * `used_beliefs` is the join that makes reversal possible. An action is
 * reversed when its justification intersects the contaminated set and left
 * alone when it does not, which means "undo the damage" is a set operation
 * rather than a judgement call.
 */
import { collections } from "./db.js";

export async function execute({ kind, payload, usedBeliefs = [], runId = null }) {
  const { actions } = await collections();
  const doc = {
    kind,
    payload,
    used_beliefs: usedBeliefs,
    run_id: runId,
    status: "executed",
    ts: new Date(),
  };
  const { insertedId } = await actions.insertOne(doc);
  return { ...doc, _id: insertedId };
}

export async function listActions(filter = {}) {
  const { actions } = await collections();
  return actions.find(filter).sort({ ts: 1 }).toArray();
}

export async function countByStatus() {
  const { actions } = await collections();
  const rows = await actions
    .aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }])
    .toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}
