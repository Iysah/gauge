// Client for Huawei 5G CPE routers (HiLink web API), e.g. the Airtel Nigeria
// "5G CPE Max 6" outdoor unit (H362-383, made by Zowee for Huawei).
//
// The login flow mirrors the open-source huawei-lte-api Python library
// (https://github.com/Salamek/huawei-lte-api), which was confirmed working
// against an H362-383 before this adapter was written:
//
//   1. GET /            -> session cookie + CSRF token(s) in <meta name="csrf_token">
//                          (fallback: /api/webserver/token, then /api/webserver/SesTokInfo)
//   2. GET /api/user/state-login -> password_type (4 = SHA-256 scheme)
//   3. POST /api/user/login with
//        Password = b64(sha256hex(user + b64(sha256hex(password)) + csrfToken))
//      New CSRF tokens come back in the __RequestVerificationToken* headers.
//   4. GET the monitoring/device/lan endpoints with the session cookie.
//
// sample() returns the same record shape as the ZLT client in router.js, so the
// engine, charts and menu bar work unchanged. Counters arrive in bytes and are
// converted to MiB (Gauge's "MB") and kilobits per second.

import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

const MIB = 1048576;

const xml = new XMLParser({
  parseTagValue: false, // keep everything as strings, like the router sends it
  isArray: (name) => name === "Host",
  processEntities: true,
});

const num = (x) => {
  if (x === "" || x == null) return null;
  const n = Number.parseFloat(String(x)); // "-87dBm" -> -87, "12.0dB" -> 12
  return Number.isNaN(n) ? null : n;
};
const bytes = (x) => (x === "" || x == null || Number.isNaN(Number(x)) ? null : Number(x));
const toMib = (b) => (b == null ? null : b / MIB);
const toKbps = (bytesPerSecond) => (bytesPerSecond == null ? null : Math.round((bytesPerSecond * 8) / 1000));
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const esc = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

// Huawei error codes (from huawei-lte-api's enums)
const ERR = {
  NO_RIGHTS: 100003, // not logged in / session expired
  CSRF: 125002, // stale CSRF token
  WRONG_SESSION_TOKEN: 125003,
  USERNAME_WRONG: 108001,
  PASSWORD_WRONG: 108002,
  ALREADY_LOGIN: 108003,
  USERNAME_PWD_WRONG: 108006,
  USERNAME_PWD_OVERRUN: 108007, // too many attempts: router has locked logins
  USERNAME_PWD_MODIFY: 115002,
};
const LOGIN_ERRORS = new Set([
  ERR.USERNAME_WRONG,
  ERR.PASSWORD_WRONG,
  ERR.USERNAME_PWD_WRONG,
  ERR.USERNAME_PWD_OVERRUN,
  ERR.USERNAME_PWD_MODIFY,
]);
const SESSION_ERRORS = new Set([ERR.NO_RIGHTS, ERR.CSRF, ERR.WRONG_SESSION_TOKEN]);

class RouterError extends Error {
  constructor(code, message) {
    super(message);
    this.routerCode = code;
    if (LOGIN_ERRORS.has(code)) this.code = "LOGIN"; // engine halts polling on this
  }
}

/** Password encoding used by POST /api/user/login. Exported for tests. */
export function encodePassword(username, password, passwordType, csrfToken) {
  if (!password) return "";
  if (Number(passwordType) === 4) {
    return b64(sha256hex(username + b64(sha256hex(password)) + csrfToken));
  }
  return b64(password); // types 0 and 3
}

export function cleanBaseUrl(host) {
  let h = String(host || "192.168.118.1").trim();
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  const u = new URL(h);
  return `${u.protocol}//${u.host}/`;
}

function parseXml(text) {
  const doc = xml.parse(text || "");
  if (doc.error) {
    const code = Number(doc.error.code);
    throw new RouterError(code, `Router error ${code}${doc.error.message ? `: ${doc.error.message}` : ""}`);
  }
  const res = doc.response;
  return res === "" || res == null ? {} : res;
}

// Map the router's own network fields to a label like "5G (NSA)".
export function networkLabel(status = {}, signal = {}) {
  const ex = String(status.CurrentNetworkTypeEx || "");
  if (ex === "111") return "5G (SA)";
  if (status.EndcStatus === "1" || (num(signal.nrrsrp) != null && ex === "101")) return "5G (NSA)";
  if (ex === "1011") return "4G+";
  if (["101", "19"].includes(ex) || status.CurrentNetworkType === "19") return "4G LTE";
  return "Cellular";
}

// SINR is what decides real-world speed on these units, so it drives the quality label.
export function signalQuality(sinr, rsrp, poorFlag) {
  if (poorFlag) return "Poor";
  if (sinr == null && rsrp == null) return "Unknown";
  if (sinr != null) {
    if (sinr >= 20) return "Excellent";
    if (sinr >= 13) return "Good";
    if (sinr >= 3) return "Fair";
    return "Poor";
  }
  if (rsrp >= -80) return "Excellent";
  if (rsrp >= -90) return "Good";
  if (rsrp >= -100) return "Fair";
  return "Poor";
}

/** Turn raw endpoint replies into Gauge's sample record. Exported for tests. */
export function buildRecord(r, now = new Date()) {
  const month = r.month || {};
  const traffic = r.traffic || {};
  const status = r.status || {};
  const signal = r.signal || {};
  const info = r.info || {};
  const plmn = r.plmn || {};
  const start = r.start || {};

  const down = toMib(bytes(month.CurrentMonthDownload));
  const up = toMib(bytes(month.CurrentMonthUpload));

  const nrRsrp = num(signal.nrrsrp);
  const nrSinr = num(signal.nrsinr);
  const lteRsrp = num(signal.rsrp);
  const lteSinr = num(signal.sinr);
  const on5g = nrRsrp != null;
  const poor = status.poorSignalStatus === "1";
  const mainRsrp = on5g ? nrRsrp : lteRsrp;
  const mainSinr = on5g ? nrSinr : lteSinr;

  const hosts = r.hosts?.Hosts?.Host || [];
  const devices = hosts
    .filter((h) => h.Active !== "0")
    .map((h) => {
      const wired = /ethernet|lan/i.test(h.InterfaceType || "");
      return {
        mac: h.MacAddress,
        ip: String(h.IpAddress || "").split(";")[0] || null,
        name: h.ActualName || h.HostName || "Unknown Device",
        link: wired ? "eth" : "wlan",
        flow: null,
        wifi_connected: !wired,
        band: wired ? null : h.Frequency || null,
        rssi: null,
        tx_rate: null,
        rx_rate: null,
      };
    });

  const model = info.DeviceName
    ? `${info.spreadname_en || "Huawei 5G CPE"} (${info.DeviceName})`
    : "Huawei 5G CPE";

  return {
    ts: now.toISOString(),
    source: "huawei",
    model,
    month_mb: { down, up, total: down != null && up != null ? down + up : null },
    day_mb: { total: toMib(bytes(month.CurrentDayUsed)) },
    wan_bytes: {
      rx: bytes(traffic.TotalDownload),
      tx: bytes(traffic.TotalUpload),
      uptime_s: bytes(traffic.CurrentConnectTime),
    },
    speed_kbps: {
      down: toKbps(bytes(traffic.CurrentDownloadRate)),
      up: toKbps(bytes(traffic.CurrentUploadRate)),
    },
    billing: {
      startDay: num(start.StartDay),
      dataLimit: start.DataLimit || null,
    },
    cellular: {
      networkType: networkLabel(status, signal),
      operator: plmn.FullName || plmn.ShortName || "Cellular",
      signalLevel: num(status.SignalIconNr) ?? num(status.SignalIcon),
      maxSignal: num(status.maxsignal),
      rssi: mainRsrp, // the UI's bar reads this field
      rsrp: mainRsrp,
      sinr: mainSinr,
      quality: signalQuality(mainSinr, mainRsrp, poor),
      poorSignal: poor,
      band: signal.band || null,
      lte: { rsrp: lteRsrp, rsrq: num(signal.rsrq), sinr: lteSinr, band: signal.bandInfo || null },
      nr: on5g ? { rsrp: nrRsrp, rsrq: num(signal.nrrsrq), sinr: nrSinr } : null,
    },
    devices,
  };
}

export function createHuaweiRouter(cfg = {}) {
  const base = cleanBaseUrl(cfg.host);
  const username = cfg.user || "admin";
  const timeoutMs = cfg.timeoutMs || 10000;
  const jar = new Map();
  let tokens = [];
  let loggedIn = false;

  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const keepCookies = (headers) => {
    for (const c of headers["set-cookie"] || []) {
      const kv = c.split(";")[0];
      const i = kv.indexOf("=");
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
  };
  const keepTokens = (headers) => {
    const one = headers["__requestverificationtokenone"];
    const two = headers["__requestverificationtokentwo"];
    const single = headers["__requestverificationtoken"];
    if (one) {
      tokens.push(one);
      if (two) tokens.push(two);
    } else if (single) {
      tokens.push(single);
    }
  };

  function request(method, urlStr, { body, headers = {}, redirects = 5 } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr, base);
      const lib = url.protocol === "https:" ? https : http;
      const cookie = cookieHeader();
      const req = lib.request(
        url,
        {
          method,
          timeout: timeoutMs,
          rejectUnauthorized: false, // routers use self-signed certs
          headers: {
            Accept: "*/*",
            "X-Requested-With": "XMLHttpRequest",
            ...(cookie && { Cookie: cookie }),
            ...(body != null && { "Content-Length": Buffer.byteLength(body) }),
            ...headers,
          },
        },
        (res) => {
          keepCookies(res.headers);
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => {
            const loc = res.headers.location;
            if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects > 0 && method === "GET") {
              resolve(request("GET", new URL(loc, url).toString(), { headers, redirects: redirects - 1 }));
            } else {
              resolve({ status: res.statusCode, headers: res.headers, text });
            }
          });
        }
      );
      req.on("timeout", () => req.destroy(new Error(`Router at ${base} did not answer within ${timeoutMs / 1000}s`)));
      req.on("error", reject);
      req.end(body);
    });
  }

  async function apiGet(endpoint) {
    const headers = tokens.length === 1 ? { __RequestVerificationToken: tokens[0] } : {};
    const res = await request("GET", `api/${endpoint}`, { headers });
    return parseXml(res.text);
  }

  async function apiPost(endpoint, fields, { refreshTokens = false } = {}) {
    const inner = Object.entries(fields)
      .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
      .join("");
    const body = `<?xml version="1.0" encoding="UTF-8"?><request>${inner}</request>`;
    const headers = { "Content-Type": "application/xml" };
    if (tokens.length) headers.__RequestVerificationToken = tokens.length > 1 ? tokens.shift() : tokens[0];
    const res = await request("POST", `api/${endpoint}`, { body, headers });
    if (refreshTokens) tokens = [];
    keepTokens(res.headers);
    return parseXml(res.text);
  }

  async function initSession() {
    jar.clear();
    tokens = [];
    loggedIn = false;
    const home = await request("GET", "");
    const found = [...home.text.matchAll(/name="csrf_token"\s+content="(\S+)"/g)].map((m) => m[1]);
    if (found.length) {
      tokens = found;
      return;
    }
    try {
      const t = await apiGet("webserver/token");
      if (t.token) tokens.push(t.token);
    } catch {
      const s = await apiGet("webserver/SesTokInfo");
      if (s.TokInfo) tokens.push(s.TokInfo);
      if (s.SesInfo && !jar.has("SessionID")) jar.set("SessionID", String(s.SesInfo).replace(/^SessionID=/, ""));
    }
  }

  async function login() {
    await initSession();
    const state = await apiGet("user/state-login");
    const passwordType = Number(state.password_type || 0);
    const password = encodePassword(username, cfg.pass || "", passwordType, tokens[0] || "");
    try {
      await apiPost(
        "user/login",
        { Username: username, Password: password, password_type: passwordType },
        { refreshTokens: true }
      );
    } catch (e) {
      if (e.routerCode === ERR.USERNAME_PWD_OVERRUN) {
        e.message = "Too many failed logins: the router has paused logins for a few minutes. Wait, then check the password.";
      } else if (e.code === "LOGIN") {
        e.message = "Login rejected. Please check your router password (the one for the outdoor unit's web page).";
      }
      throw e;
    }
    loggedIn = true;
  }

  async function collect() {
    // Fetch sequentially: these routers dislike parallel requests on one session.
    const r = {};
    r.month = await apiGet("monitoring/month_statistics");
    r.traffic = await apiGet("monitoring/traffic-statistics");
    r.status = await apiGet("monitoring/status");
    const optional = {
      signal: "device/signal",
      info: "device/information",
      plmn: "net/current-plmn",
      start: "monitoring/start_date",
      hosts: "lan/HostInfo",
    };
    for (const [key, ep] of Object.entries(optional)) {
      try {
        r[key] = await apiGet(ep);
      } catch (e) {
        if (SESSION_ERRORS.has(e.routerCode)) throw e;
        r[key] = null; // not critical for the dashboard
      }
    }
    return buildRecord(r);
  }

  async function sample() {
    if (!loggedIn) await login();
    try {
      return await collect();
    } catch (e) {
      if (e.code === "LOGIN") throw e;
      // Session or CSRF token expired (or router rebooted): log in again once and retry.
      await login();
      return await collect();
    }
  }

  async function probe() {
    await login();
    const info = await apiGet("device/information").catch(() => ({}));
    return {
      success: true,
      vendor: "huawei",
      boardType: info.DeviceName
        ? `${info.spreadname_en || "Huawei 5G CPE"} (${info.DeviceName})`
        : "Huawei 5G CPE",
    };
  }

  return { sample, probe, kind: "huawei" };
}

/** True when the host answers like a Huawei HiLink router (no login needed). */
export async function looksLikeHuawei(host, timeoutMs = 4000) {
  try {
    // basic_information is public on these routers; any HiLink XML reply counts.
    const res = await new Promise((resolve, reject) => {
      const url = new URL("api/device/basic_information", cleanBaseUrl(host));
      const lib = url.protocol === "https:" ? https : http;
      const req = lib.get(url, { timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
        let t = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (t += c));
        res.on("end", () => resolve(t));
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    });
    return /<response>|<error>\s*<code>/.test(res);
  } catch {
    return false;
  }
}
