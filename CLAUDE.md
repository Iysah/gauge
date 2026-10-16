# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install deps (Electron, fast-xml-parser, electron-packager).
- `npm start` — launch the Electron app (`electron .`).
- `npm run check` — `scripts/check-router.mjs`: prompts once for the router password, then prints usage and signal from a real router. Use this to verify router adapters without opening the UI.
- `npm test` — runs `node --test test/**/*.test.js` (Node's built-in runner, no framework). Run a single file with `node --test test/huawei.test.js`; filter by name with `--test-name-pattern="..."`.
- `npm run build:mac` / `build:mac:arm64` / `build:dmg` — package with electron-packager into `dist/`. Releases are built by `.github/workflows/release.yml` on `v*` tags (runs tests first).

No linter is configured. The project is ESM (`"type": "module"`), except `src/preload.cjs`.

## Architecture

Electron app with a Node backend that polls a 5G router and writes usage history.

- `src/main.js` — Electron lifecycle, window, tray/menu bar, notifications, and all `ipcMain` handlers. Instantiates `DataEngine` with `dataDir` = `app.getPath("userData")` when packaged, otherwise the repo root (so dev `config.json` and `usage.jsonl` live in the repo and are gitignored — never commit them).
- `src/preload.cjs` — context bridge between renderer and main IPC.
- `src/renderer/` — vanilla JS/CSS dashboard (`app.js` renders charts and views from the summary object returned over IPC; no framework or bundler).
- `src/backend/engine.js` — `DataEngine` (EventEmitter): loads `config.json`, polling loop (`step()`), in-memory samples + `usage.jsonl` append-only history, device tracking/nicknames, summary computation (`getSummary()`), and alert events. The router password is stored encrypted via `vault.js` (Electron `safeStorage`/Keychain) as `encryptedPassword`; a plaintext `password` in config is auto-upgraded.
- `src/backend/routers.js` — factory `createRouterFor(cfg)` choosing a client by `routerType` (`auto` | `huawei` | `zlt`). `auto` probes via `looksLikeHuawei` on first use and caches the result.
- `src/backend/router.js` (ZLT X17U JSON API) and `src/backend/huawei.js` (Huawei HiLink XML API with CSRF + SHA-256 login) are the router clients. **Both must expose the same `{ sample(), probe() }` interface and return the same sample record shape** (counters converted to MiB, speeds to kbps) so the engine, charts and tray work unchanged. New router support = a new client plus a branch in `routers.js`.
- Both clients deliberately stop after a single rejected login to avoid locking the router's admin account; preserve that behavior.
- `src/backend/server.js` — standalone HTTP bridge (`/api/summary`, `/api/refresh`, serves the renderer) wrapping the same `DataEngine`, for use outside Electron.
- `src/backend/local.js` — measures this computer's own network interface.

## Testing

Tests use recorded, sanitized router replies in `test/fixtures/` (`router_replies.json` for ZLT, `huawei_h362_replies.json` for Huawei), so no hardware is needed. When adding a router or endpoint, record real replies, scrub IMEI/IMSI/MACs/tokens, and add them as fixtures.

## Config notes

`config.json` keys (see `config.example.json`): `routerHost`, `routerType`, `username`, `planGb` (0 = unlimited), `dailyLimitGb`, `warnPercent`, `pollSeconds`, `gbBase` (1024 vs 1000). The default host is the Airtel outdoor unit `192.168.118.1`, whose password differs from any indoor Wi-Fi router's.
