import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHuaweiRouter, encodePassword, buildRecord, looksLikeHuawei } from "../src/backend/huawei.js";
import { createRouterFor } from "../src/backend/routers.js";
import { DataEngine } from "../src/backend/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const replies = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "huawei_h362_replies.json"), "utf8"));
const MIB = 1048576;
const PASSWORD = "correct-horse";

const toXml = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => {
      if (Array.isArray(v)) return v.map((x) => `<${k}>${toXml(x)}</${k}>`).join("");
      if (v && typeof v === "object") return `<${k}>${toXml(v)}</${k}>`;
      return `<${k}>${v ?? ""}</${k}>`;
    })
    .join("");
const response = (obj) =>
  `<?xml version="1.0" encoding="UTF-8"?><response>${typeof obj === "string" ? obj : toXml(obj)}</response>`;
const errorXml = (code) => `<?xml version="1.0" encoding="UTF-8"?><error><code>${code}</code><message></message></error>`;

/** Fake H362-383 that enforces the same login rules as the real one. */
function startFakeRouter() {
  const state = { loginPosts: 0, validSession: null, csrf: ["csrfA", "csrfB"], sessionCounter: 0 };
  const server = http.createServer((req, res) => {
    const cookie = /SessionID=([^;]+)/.exec(req.headers.cookie || "")?.[1];
    const url = req.url.split("?")[0];
    const send = (body, headers = {}) => {
      res.writeHead(200, { "Content-Type": "text/xml", ...headers });
      res.end(body);
    };

    if (url === "/") {
      // The real UI redirects first, then serves the page with CSRF meta tags.
      res.writeHead(302, { Location: "/html/index.html", "Set-Cookie": "SessionID=anon; path=/; HttpOnly" });
      return res.end();
    }
    if (url === "/html/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(state.csrf.map((t) => `<meta name="csrf_token" content="${t}">`).join("\n"));
    }
    if (url === "/api/device/basic_information") return send(response(replies["device/basic_information"]));
    if (url === "/api/user/state-login") return send(response({ State: "-1", password_type: "4", username: "" }));

    if (url === "/api/user/login" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        state.loginPosts += 1;
        const sentToken = req.headers.__requestverificationtoken;
        const expected = encodePassword("admin", PASSWORD, 4, state.csrf[0]);
        const sentPassword = /<Password>([^<]*)<\/Password>/.exec(body)?.[1];
        if (sentToken !== state.csrf[0] || cookie !== "anon") return send(errorXml(125002));
        if (sentPassword !== expected) return send(errorXml(108006));
        state.sessionCounter += 1;
        state.validSession = `s${state.sessionCounter}`;
        send(response("OK"), {
          "Set-Cookie": `SessionID=${state.validSession}; path=/; HttpOnly`,
          __RequestVerificationTokenone: "afterLogin1",
          __RequestVerificationTokentwo: "afterLogin2",
        });
      });
      return;
    }

    const endpoint = url.replace(/^\/api\//, "");
    if (replies[endpoint]) {
      if (cookie !== state.validSession) return send(errorXml(100003));
      return send(response(replies[endpoint]));
    }
    res.writeHead(404);
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ host: `127.0.0.1:${server.address().port}`, state, close: () => server.close() });
    });
  });
}

test("password encoding matches huawei-lte-api (SHA-256 scheme, type 4)", () => {
  // Reference value computed with the Python library's algorithm.
  assert.equal(
    encodePassword("admin", "S3cret!pw", 4, "abc123TOKENxyz"),
    "NDJhZGJiYWI3NDlhOGRhZDg4MGEwMjQ0MDk1Y2QzMzJlMjBhMjUzYjIzYTc3OTUzYjA0NTRmOGU0ZjVhNWE1Yw=="
  );
  assert.equal(encodePassword("admin", "pw", 0, "x"), Buffer.from("pw").toString("base64"));
});

test("buildRecord converts H362-383 replies into Tally's record shape", () => {
  const rec = buildRecord({
    month: replies["monitoring/month_statistics"],
    traffic: replies["monitoring/traffic-statistics"],
    status: replies["monitoring/status"],
    signal: replies["device/signal"],
    info: replies["device/information"],
    plmn: replies["net/current-plmn"],
    start: replies["monitoring/start_date"],
    hosts: replies["lan/HostInfo"],
  });

  assert.equal(rec.model, "5G CPE Max 6 (H362-383)");
  assert.ok(Math.abs(rec.month_mb.down - 255697381173 / MIB) < 1e-6);
  assert.ok(Math.abs(rec.month_mb.up - 30276175652 / MIB) < 1e-6);
  assert.ok(Math.abs(rec.month_mb.total - (255697381173 + 30276175652) / MIB) < 1e-6);
  assert.ok(Math.abs(rec.day_mb.total - 8169342643 / MIB) < 1e-6);
  assert.equal(rec.speed_kbps.down, 1424); // 177979 B/s
  assert.equal(rec.speed_kbps.up, 29); // 3620 B/s
  assert.equal(rec.wan_bytes.rx, 577097978598);
  assert.equal(rec.cellular.networkType, "5G (NSA)");
  assert.equal(rec.cellular.operator, "Airtel Nigeria");
  assert.equal(rec.cellular.rsrp, -91);
  assert.equal(rec.cellular.sinr, 0);
  assert.equal(rec.cellular.quality, "Poor"); // router sets poorSignalStatus=1
  assert.equal(rec.cellular.lte.band, "B7");
  assert.equal(rec.billing.startDay, 1);
  assert.equal(rec.devices.length, 1);
  assert.deepEqual(
    { name: rec.devices[0].name, ip: rec.devices[0].ip, link: rec.devices[0].link },
    { name: "HUAWEI-AX30-20", ip: "192.168.118.5", link: "eth" }
  );
});

test("logs in like the web UI and samples every endpoint", async () => {
  const fake = await startFakeRouter();
  try {
    const router = createHuaweiRouter({ host: fake.host, pass: PASSWORD });
    const rec = await router.sample();
    assert.equal(fake.state.loginPosts, 1);
    assert.equal(rec.model, "5G CPE Max 6 (H362-383)");
    assert.equal(rec.cellular.networkType, "5G (NSA)");
    assert.equal(rec.devices[0].name, "HUAWEI-AX30-20");

    // Second poll reuses the session: no extra login.
    await router.sample();
    assert.equal(fake.state.loginPosts, 1);

    const probe = await router.probe();
    assert.equal(probe.boardType, "5G CPE Max 6 (H362-383)");
  } finally {
    fake.close();
  }
});

test("re-logs in once when the router drops the session", async () => {
  const fake = await startFakeRouter();
  try {
    const router = createHuaweiRouter({ host: fake.host, pass: PASSWORD });
    await router.sample();
    fake.state.validSession = "expired-by-router";
    const rec = await router.sample();
    assert.equal(fake.state.loginPosts, 2);
    assert.ok(rec.month_mb.total > 0);
  } finally {
    fake.close();
  }
});

test("wrong password fails with code LOGIN after a single attempt (lockout guard)", async () => {
  const fake = await startFakeRouter();
  try {
    const router = createHuaweiRouter({ host: fake.host, pass: "wrong" });
    await assert.rejects(router.sample(), (e) => e.code === "LOGIN" && /Login rejected/.test(e.message));
    assert.equal(fake.state.loginPosts, 1);
  } finally {
    fake.close();
  }
});

test("auto mode detects the Huawei API and reports it", async () => {
  const fake = await startFakeRouter();
  try {
    assert.equal(await looksLikeHuawei(fake.host), true);
    let detected = null;
    const router = createRouterFor({ host: fake.host, pass: PASSWORD, type: "auto" }, { onDetected: (k) => (detected = k) });
    const rec = await router.sample();
    assert.equal(detected, "huawei");
    assert.equal(rec.source, "huawei");
  } finally {
    fake.close();
  }
});

test("engine prefers the router's own 'used today' counter when it is larger", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tally-huawei-"));
  try {
    const engine = new DataEngine(tmpDir);
    const now = Date.now();
    const rec = (t, downMb, upMb, dayMb) => ({
      ts: new Date(t).toISOString(),
      month_mb: { down: downMb, up: upMb, total: downMb + upMb },
      day_mb: { total: dayMb },
      speed_kbps: { down: 1424, up: 29 },
      model: "5G CPE Max 6 (H362-383)",
      cellular: { networkType: "5G (NSA)", rssi: -91, sinr: 0, quality: "Poor" },
      devices: [],
    });
    // App only saw 100 MB today, but the router counted 8000 MB since midnight.
    engine.ingest(rec(now - 60e3, 10000, 1000, 7900));
    engine.ingest(rec(now, 10090, 1010, 8000));
    const s = engine.getSummary();
    const today = s.measured.today.down + s.measured.today.up;
    assert.ok(Math.abs(today - 8000) < 1e-6, `today was ${today}`);
    assert.ok(Math.abs(s.measured.today.down - 7200) < 1e-6); // 90/10 split from what was measured
    assert.equal(s.routerModel, "5G CPE Max 6 (H362-383)");
    assert.equal(s.days.at(-1).source, "router");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
