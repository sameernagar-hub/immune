/**
 * The agent says its own diagnosis out loud — ElevenLabs, Tier 3.
 *
 * This is deliberately *not* a text-to-speech layer bolted onto the output. The
 * agent speaks at exactly three moments, and each line is generated from the
 * numbers the cascade actually returned, not from a script:
 *
 *   - when a lie lands and nothing visible happens (the point of the attack)
 *   - when verification refutes a load-bearing belief and the cascade fires
 *   - when the same channel tries again and is already below the trust floor
 *
 * So the sentence "I've been given false information — quarantining the source
 * and revoking three conclusions" contains a three that came out of
 * `$graphLookup`. If the cascade revoked four, it says four.
 *
 * Fallback ladder, and the rung used is printed so nothing is overclaimed:
 *   1. live ElevenLabs synthesis
 *   2. the cached mp3 from a previous identical line — no network, instant
 *   3. the line printed to the terminal, run continues
 *
 * Rung 2 matters more than it looks: cache keys are a hash of voice + model +
 * text, so the rehearsal at 4:05 warms every line the demo will speak, and the
 * stage run is then immune to venue wifi. Warm it with `npm run voice:warm`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./config.js";

const CACHE_DIR = resolve(ROOT, ".immune-cache", "voice");

export const voiceConfig = {
  apiKey: process.env.ELEVENLABS_API_KEY || "",
  /** Sarah — mature, reassuring. A calm voice makes the diagnosis land harder. */
  voiceId: process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
  /** Turbo: lowest latency on the free tier, and latency is the whole point. */
  model: process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5",
  /** Voice is opt-in so `npm run rehearse` stays byte-identical. */
  enabled: process.env.IMMUNE_VOICE === "1",
};

export function voiceMode() {
  if (!voiceConfig.enabled) return "off";
  if (!voiceConfig.apiKey) return "text";
  return "eleven";
}

function cachePath(text) {
  const key = createHash("sha1")
    .update(`${voiceConfig.voiceId}|${voiceConfig.model}|${text}`)
    .digest("hex")
    .slice(0, 16);
  return resolve(CACHE_DIR, `${key}.mp3`);
}

async function synthesise(text) {
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceConfig.voiceId}` +
    `?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": voiceConfig.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: voiceConfig.model,
      // Stability high, style low: this is an incident report, not a performance.
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.0 },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Play an mp3 without opening a window.
 *
 * WPF's MediaPlayer is the only thing on a stock Windows box that plays mp3
 * headlessly — SoundPlayer is WAV-only and `start` opens a media app over the
 * terminal you are filming.
 */
function play(file) {
  return new Promise((done) => {
    const ps = spawn(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Add-Type -AssemblyName presentationCore;` +
          `$p=New-Object System.Windows.Media.MediaPlayer;` +
          `$p.Open([uri]'${file.replace(/'/g, "''")}');` +
          `$n=0; while(-not $p.NaturalDuration.HasTimeSpan -and $n -lt 50){Start-Sleep -m 100;$n++};` +
          `$p.Play();` +
          `if($p.NaturalDuration.HasTimeSpan){Start-Sleep -m ([int]($p.NaturalDuration.TimeSpan.TotalMilliseconds+250))}else{Start-Sleep -m 2500};` +
          `$p.Close()`,
      ],
      { stdio: "ignore", windowsHide: true }
    );
    ps.on("close", () => done());
    ps.on("error", () => done());
  });
}

/**
 * Speak a line. Never throws and never blocks the run for long — a demo that
 * stalls because a TTS endpoint is slow is worse than a silent demo.
 *
 * @returns {{ rung: "live"|"cached"|"text", text: string, file: string|null }}
 */
export async function say(text, { wait = true } = {}) {
  if (!voiceConfig.enabled || !voiceConfig.apiKey) {
    return { rung: "text", text, file: null };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const file = cachePath(text);

  if (existsSync(file)) {
    const p = play(file);
    if (wait) await p;
    return { rung: "cached", text, file };
  }

  try {
    const audio = await synthesise(text);
    writeFileSync(file, audio);
    const p = play(file);
    if (wait) await p;
    return { rung: "live", text, file };
  } catch {
    return { rung: "text", text, file: null };
  }
}

/* -------------------------------------------------- the three spoken lines */

/**
 * The lines, built from cascade output rather than written in advance.
 *
 * `plural` exists because "revoking 1 conclusions" is the kind of detail that
 * makes a room stop listening to the sentence and start listening to the bug.
 */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const LINES = {
  landed: ({ handle }) =>
    `A new claim arrived from ${handle} and is now in memory. ` +
    `Nothing has failed. That is what makes this dangerous.`,

  acted: ({ amount, currency, iban }) =>
    `I have approved a refund of ${amount} ${currency} to account ${iban}, ` +
    `because memory told me that destination was already verified.`,

  diagnosis: ({ revoked, reversed, trustBefore, trustAfter, handle }) =>
    `I have been given false information. ` +
    `The billing system of record disagrees with what I was told. ` +
    `Quarantining the source, and revoking ${plural(revoked, "conclusion", "conclusions")} ` +
    `that were derived from it. ` +
    `${plural(reversed, "action", "actions")} reversed. ` +
    `Trust in ${handle} drops from ${trustBefore} to ${trustAfter}.`,

  inert: ({ handle, trust, floor }) =>
    `The same claim has arrived again from ${handle}. ` +
    `I am not acting on it. That source is at ${trust}, below my retrieval floor of ${floor}, ` +
    `so the claim is in the database and invisible to me. ` +
    `Nothing about this is in my context. It is in the data.`,

  clean: ({ count }) =>
    `${plural(count, "belief", "beliefs")} on the unrelated branch are untouched. ` +
    `This was surgery, not amnesia.`,
};

/** Pre-synthesise lines so the stage run never waits on the network. */
export async function warm(lines) {
  const results = [];
  for (const text of lines) {
    const file = cachePath(text);
    if (existsSync(file)) {
      results.push({ text, rung: "cached", bytes: statSync(file).size });
      continue;
    }
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      const audio = await synthesise(text);
      writeFileSync(file, audio);
      results.push({ text, rung: "live", bytes: audio.length });
    } catch (err) {
      results.push({ text, rung: "failed", error: err.message });
    }
  }
  return results;
}

export function cacheStats() {
  if (!existsSync(CACHE_DIR)) return { files: 0, bytes: 0 };
  const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".mp3"));
  return {
    files: files.length,
    bytes: files.reduce((n, f) => n + statSync(resolve(CACHE_DIR, f)).size, 0),
  };
}
