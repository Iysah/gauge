# Tally ⚡

> **A native macOS data monitor and bandwidth analytics app for 5G and broadband routers.**

Tally connects directly to your router's administrative interface to track live speeds, monthly data quotas, per-device consumption, and historical usage patterns in real time from your macOS desktop and menu bar.

---

## 🔒 Trust, Security & Privacy

Tally is engineered from the ground up for strict local privacy and device safety:

- **macOS Keychain Encryption**: Passwords are never saved in plain text. Tally uses Electron's native `safeStorage` API to encrypt your router password directly in your macOS Keychain.
- **Router Lockout Protection**: 
  > **IMPORTANT**: Router firmware locks administrative logins for several minutes after 3 consecutive failed password attempts. To protect you from accidental router lockouts, Tally automatically halts all polling and connection attempts immediately after a single rejected login.
- **Git History Hygiene**: `config.json` (which contains your local network configuration) and `usage.jsonl` (which stores real device hostnames and MAC addresses) as well as `dist/` and `Tally.app` are ignored in `.gitignore` and must never be committed to git.
- **Zero Third-Party Telemetry**: Tally runs 100% locally on your machine with no external tracking or analytics servers.

---

## ✨ Features

- **Real-Time Bandwidth & Speed**: Live download and upload speed meters with instantaneous refresh.
- **Custom Device Nicknames**: Phones and gadgets often appear as generic names like "iPhone" or unreadable identifiers. Tally lets you rename any device (e.g., "Jerry's iPhone" or "Living Room Apple TV") and preserves your custom names.
- **Native macOS Alerts**:
  - **New Device Alert**: Receive a desktop notification whenever a new device connects to your Wi-Fi or LAN.
  - **Daily Usage Threshold**: Configurable limit (e.g., 15 GB) notifying you when today's traffic exceeds your threshold.
  - **Monthly Plan Warning**: Configurable warning percentage (e.g., 80% of your 350 GB plan).
  - **Router Offline Alert**: Immediate notification if the router drops offline or becomes unreachable.
- **Quota & Plan Tracking**: Set your monthly bundle size and track remaining allowance, pace, and daily projected usage.
- **Interactive Analytics**:
  - **Daily Breakdown**: 14-day trailing visual bar chart showing download vs. upload ratios.
  - **Hourly Heatmap**: See what times of day your network experiences peak traffic.
  - **Monthly Distribution**: Clean donut chart visualizing current month vs. historical records.
- **Menu Bar Tray Companion**: Compact menu bar item displaying current monthly consumption, live speeds, and quick status.
- **Long-term History & CSV Export**: Archive month-by-month usage metrics and export records to CSV.

---

## 🚀 Getting Started

### Prerequisites

- macOS 11.0 (Big Sur) or newer
- [Node.js](https://nodejs.org) (v18 or higher recommended)
- Compatible router (e.g., 5G routers, ZTE / ZLT series such as ZLT X17U)

### Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/tally.git
   cd tally
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start in development mode**:
   ```bash
   npm start
   ```

4. **Connect to your router**:
   - Enter your router gateway address (default: `192.168.0.1`) and admin password.
   - Click **Connect Router**.

---

## 🧪 Testing with Recorded Fixtures

Contributors do **not** need to own the physical router hardware to run tests or develop new features!

Tally includes recorded, sanitized router reply fixtures (`test/fixtures/router_replies.json`) where all sensitive identifiers (IMEI, IMSI, MAC addresses, and session tokens) have been replaced with safe mock values.

Run the automated test suite using Node's built-in test runner:

```bash
npm test
```

---

## 📦 Building the macOS Application Bundle

To build a standalone `.app` bundle for macOS:

```bash
npm run build:mac
```

The compiled `Tally.app` will be created inside the `dist/` directory.

---

## ⚙️ Configuration

Settings can be changed anytime in the app's **Settings** screen. For headless or automated setups, copy `config.example.json`:

```bash
cp config.example.json config.json
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `routerHost` | `string` | `"192.168.0.1"` | Gateway IP address of the router |
| `username` | `string` | `"admin"` | Administrative login username |
| `planGb` | `number` | `350` | Monthly data allowance in GB |
| `dailyLimitGb` | `number` | `15` | Daily threshold triggering desktop notification |
| `warnPercent` | `number` | `80` | Monthly quota warning percentage |
| `notifyNewDevice` | `boolean` | `true` | Send notification when an unknown device joins |
| `notifyOffline` | `boolean` | `true` | Send notification when router is unreachable |
| `showMenuBar` | `boolean` | `true` | Show status in macOS menu bar |
| `openAtLogin` | `boolean` | `false` | Launch automatically on macOS startup |
| `pollSeconds` | `number` | `30` | Polling frequency in seconds |
| `gbBase` | `number` | `1024` | 1000 vs. 1024 GB computation |

---

## 📁 Project Structure

```
├── assets/                  # Icons and menu bar tray assets
│   ├── icon.icns            # macOS app bundle icon
│   ├── icon.png             # Dock and window icon
│   └── trayTemplate*.png    # Menu bar status icons
├── test/
│   ├── fixtures/            # Sanitized router API responses
│   │   └── router_replies.json
│   ├── engine.test.js       # DataEngine & nickname unit tests
│   ├── router.test.js       # Router parser & lockout tests
│   └── vault.test.js        # Keychain safeStorage tests
├── src/
│   ├── backend/             # Core monitoring engine
│   │   ├── engine.js        # Polling loops, state cache, JSONL writer
│   │   ├── router.js        # Router HTTP API client & auth session handler
│   │   ├── vault.js         # macOS Keychain safeStorage encryption
│   │   ├── local.js         # macOS local network interface measurement
│   │   └── server.js        # Internal local bridge
│   ├── renderer/            # Frontend dashboard UI
│   │   ├── index.html       # Dashboard, device table & nickname modal
│   │   ├── style.css        # Space Grotesk tokens & dark/light styling
│   │   └── app.js           # Chart rendering, IPC bridge, reactive views
│   ├── main.js              # Electron lifecycle, window & notifications
│   └── preload.cjs          # Secure IPC context bridge
├── CONTRIBUTING.md          # Contribution guidelines
├── SECURITY.md              # Security policy & vulnerability reporting
├── package.json
├── config.example.json
└── README.md
```

---

## 🤝 Community & Support

- See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
- See [SECURITY.md](SECURITY.md) for vulnerability reporting and credential security guidelines.

---

## 📄 License

Distributed under the [MIT License](LICENSE).
