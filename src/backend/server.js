import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataEngine } from "./engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const RENDERER_DIR = path.resolve(__dirname, "../renderer");

const engine = new DataEngine(ROOT_DIR);
engine.start();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];

  // API Endpoints
  if (urlPath === "/api/summary") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(engine.getSummary()));
  }

  if (urlPath === "/api/refresh") {
    try {
      const summary = await engine.step();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(summary));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message, summary: engine.getSummary() }));
    }
  if (urlPath === "/api/disconnect" && req.method === "POST") {
    engine.disconnect();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ success: true }));
  }

  if (urlPath === "/api/connect" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const creds = JSON.parse(body);
        const summary = await engine.connect(creds);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, connected: false }));
      }
    });
    return;
  }

  if (urlPath === "/api/config" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const newCfg = JSON.parse(body);
        engine.saveConfig(newCfg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, config: engine.config }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath === "/api/devices/nickname" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { mac, nickname } = JSON.parse(body);
        engine.setDeviceNickname(mac, nickname);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, summary: engine.getSummary() }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (urlPath === "/api/test-connection" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const creds = JSON.parse(body);
        const result = await engine.testConnection(creds);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, result }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(RENDERER_DIR, urlPath === "/" ? "index.html" : urlPath);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT_DIR, urlPath);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    return res.end(fs.readFileSync(filePath));
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

function listen(port, tries = 5) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && tries > 0) {
      listen(port + 1, tries - 1);
    } else {
      console.error("Server listen error:", err.message);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const activePort = server.address().port;
    fs.writeFileSync(path.join(ROOT_DIR, ".active_port"), String(activePort));
    console.log(`Tally background engine running on http://127.0.0.1:${activePort}`);
  });
}

listen(engine.config.port || 3000);
