# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | :white_check_mark: |
| 1.x.x   | :x:                |

---

## Reporting a Vulnerability

We take the security and privacy of Tally users very seriously. If you discover a security vulnerability or credential leak issue, please do not file a public GitHub issue.

Instead, please send an email to the repository maintainer with:
1. A clear description of the vulnerability.
2. Steps to reproduce the issue.
3. Potential impact or affected components.

We will acknowledge receipt within 48 hours and work with you on a swift resolution.

---

## Security Architecture & Protections

### 1. macOS Keychain Credential Encryption
Tally uses Electron's native `safeStorage` subsystem on macOS. 
- Administrative router passwords are encrypted with Apple Keychain cryptography before being saved.
- Plaintext passwords are never written to `config.json` on disk.
- In-memory state strips passwords and ciphertext from all frontend-facing summaries and API endpoints.

### 2. Router Lockout Protection
- Broadband and 5G routers (such as ZLT and ZTE models) permanently or temporarily lock administrative logins after 3 consecutive wrong password attempts.
- Tally actively detects login rejections and immediately stops automatic background polling to protect your router from being locked out.

### 3. Repository & Git Hygiene
- `config.json` (holds local credentials) and `usage.jsonl` (holds device hostnames, IP and MAC addresses) are permanently ignored via `.gitignore`.
- Built binaries (`dist/`, `Tally.app`) are also strictly ignored to prevent binary bloat and accidental leakages.
- Test suites must always use sanitized fixtures from `test/fixtures/` where all IMEIs, IMSIs, MACs, and session tokens are replaced with synthetic test vectors.
