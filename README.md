# TraceLock

TraceLock is a Manifest V3 browser extension for Chrome/Edge that exposes the invisible activity happening on every page you visit. It monitors network requests, highlights tracker domains, detects sensitive permission usage, and summarizes per-site risk in a privacy-focused popup UI.

## Features

- **Real-time network timeline** – Capture the latest requests (including method, type, tracker status) with quick filters and search.
- **Tracker taxonomy** – Map requests into categories (ads, analytics, CDN, social, media, API, other) using an extensible domain dataset.
- **Risk scoring** – Dynamic risk level that factors in tracker volume, request mix, and permission usage.
- **Permission probes** – Detect access to geolocation, notifications, camera, and microphone without shipping page content to any server.
- **Historical trends** – Persist the last seven sessions per host in `chrome.storage.local` and render a sparkline + summary list.
- **Proactive guidance** – Surface actionable tips when patterns look risky (e.g., tracker surges, sensitive permissions).

## Project Structure

```text
tracelock/
├─ manifest.json
├─ src/
│  ├─ background.js        # Service worker: request logging, risk calc, history persistence, script injection
│  ├─ content.js           # Content script: permission probe bridge
│  ├─ page/probe.js        # Main-world script: monkey patches geolocation/notifications/media APIs
│  ├─ popup/
│  │  ├─ index.html        # Popup shell
│  │  ├─ popup.css         # Glassmorphism UI + timeline styling
│  │  └─ popup.js          # Popup logic, filters, history, guidance rendering
│  └─ data/trackers.json   # Tracker taxonomy (domain → category, label)
├─ icons/                  # Placeholder extension icons
└─ README.md
```

## Getting Started

1. Install dependencies: none – TraceLock is plain HTML/CSS/JS.
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the `tracelock/` directory.
3. Pin the extension and open the popup while browsing to inspect live activity.

## Safety & Privacy

- No API keys, secrets, or external services are bundled; all analysis happens locally in the browser.
- The permission probe uses `chrome.scripting.executeScript` to inject the `probe.js` file in compliance with CSP and MV3 requirements.
- Historical data lives in `chrome.storage.local` and never leaves the device.

## Development Notes

- Tracker categories live in `src/data/trackers.json`; expand or fine-tune the taxonomy as new services appear.
- The background worker caps in-memory request history per tab at 200 entries to stay lightweight.
- Use the TODOs in `background.js` for future roadmap items (Supabase sync, blocking, dashboard).

## Roadmap

- DeclarativeNetRequest integration for optional blocking mode
- Supabase-powered cross-device analytics (opt-in)
- Configurable alert thresholds and per-site allowlists
- Export/share session reports

## Contributing

Pull requests and issue reports are welcome. Please lint/format JavaScript (standard Chrome formatting) and keep additions free of third-party trackers or unnecessary dependencies.

## License

This project is licensed under the [MIT License](LICENSE).
