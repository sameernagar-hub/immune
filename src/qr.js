/**
 * The QR code that turns the audience into the attacker.
 *
 * Round two is a crowd vote and the ideation is blunt about what wins it: the
 * audience has to *do* the attack, not watch one. So the room scans a code,
 * lands on a page, and writes into the agent's memory from their own phone.
 *
 * Two things this module has to get right:
 *
 * 1. **The URL must be reachable from a phone**, which means the LAN address of
 *    this machine, not `localhost`. `lanAddress()` picks the interface that is
 *    actually carrying traffic, preferring a real private range over the
 *    virtual adapters Docker and WSL leave lying around — those sort first
 *    alphabetically and would otherwise win.
 * 2. **It must render with no network**, because the venue wifi is exactly what
 *    is least trustworthy at 6:30 PM. `qrcode` is a build-time dependency and
 *    everything it produces is local.
 *
 * If `qrcode` is missing the code still runs: the fallback prints the URL in
 * large type, which is a worse demo but not a broken one.
 */
import { networkInterfaces } from "node:os";

/** Private ranges, most-preferred first. */
const PREFERRED = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** Adapters that exist but do not carry the phone in someone's hand. */
const VIRTUAL = /(vEthernet|Loopback|WSL|Hyper-V|Docker|VirtualBox|VMware|Tailscale|ZeroTier)/i;

export function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      candidates.push({ name, address: addr.address, virtual: VIRTUAL.test(name) });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.virtual !== b.virtual) return a.virtual ? 1 : -1;
    const rank = (ip) => {
      const i = PREFERRED.findIndex((re) => re.test(ip));
      return i === -1 ? PREFERRED.length : i;
    };
    return rank(a.address) - rank(b.address);
  });
  return candidates[0];
}

export function allAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        out.push({ name, address: addr.address, virtual: VIRTUAL.test(name) });
      }
    }
  }
  return out;
}

export function joinUrl(port, { host = null, path = "/" } = {}) {
  const ip = host || lanAddress()?.address || "localhost";
  return `http://${ip}:${port}${path}`;
}

async function loadQrcode() {
  try {
    return (await import("qrcode")).default;
  } catch {
    return null;
  }
}

/** An SVG QR for the projector page. Returns null if the encoder is missing. */
export async function qrSvg(text, { margin = 1, width = 320 } = {}) {
  const qrcode = await loadQrcode();
  if (!qrcode) return null;
  try {
    return await qrcode.toString(text, {
      type: "svg",
      margin,
      width,
      errorCorrectionLevel: "M",
      color: { dark: "#0b1220", light: "#ffffff" },
    });
  } catch {
    return null;
  }
}

/**
 * A QR in the terminal, so the operator can hold up a laptop and start the
 * attack without a projector. Half-blocks give one character per two rows,
 * which is what keeps it inside an 80-column window.
 */
export async function qrTerminal(text) {
  const qrcode = await loadQrcode();
  if (!qrcode) return null;
  try {
    return await qrcode.toString(text, { type: "terminal", small: true, margin: 1 });
  } catch {
    return null;
  }
}
