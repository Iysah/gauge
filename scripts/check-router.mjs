#!/usr/bin/env node
// Quick terminal check that Gauge can log in to your router and read its counters.
//   npm run check                 # uses 192.168.118.1
//   npm run check -- 192.168.0.1  # another address
// Logs in once only, so a typo can't lock you out.

import readline from "node:readline";
import { createRouterFor } from "../src/backend/routers.js";

const host = process.argv[2] || "192.168.118.1";

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const gb = (mb) => (mb == null ? "n/a" : `${(mb / 1024).toFixed(2)} GB`);
const speed = (k) => (k == null ? "n/a" : k >= 1000 ? `${(k / 1000).toFixed(2)} Mb/s` : `${k} kb/s`);

const pass = await askHidden(`Admin password for ${host} (not stored): `);
let detected = "auto";
const router = createRouterFor({ host, pass, type: "auto" }, { onDetected: (k) => (detected = k) });

try {
  const r = await router.sample();
  const c = r.cellular || {};
  console.log(`
  Router        ${r.model || "unknown"}  [${detected} API]
  Network       ${c.networkType || "n/a"} · ${c.operator || ""}
  Signal        ${c.quality || "n/a"} · RSRP ${c.rsrp ?? "n/a"} dBm · SINR ${c.sinr ?? "n/a"} dB${c.band ? ` · ${c.band}` : ""}
  This month    ${gb(r.month_mb?.total)}  (${gb(r.month_mb?.down)} down / ${gb(r.month_mb?.up)} up)
  Today         ${gb(r.day_mb?.total)}
  Live speed    ${speed(r.speed_kbps?.down)} down / ${speed(r.speed_kbps?.up)} up
  Devices seen  ${(r.devices || []).map((d) => d.name).join(", ") || "none"}
`);
  console.log("Gauge can read this router. Run `npm start` to open the app.");
} catch (e) {
  console.error(`\n${e.code === "LOGIN" ? "Login failed" : "Error"}: ${e.message}`);
  if (e.code === "LOGIN") console.error("Not retrying, so the router won't lock you out.");
  process.exit(1);
}
