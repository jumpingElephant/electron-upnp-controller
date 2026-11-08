# Raumfeld Controller

Small Electron app to control Teufel Raumfeld speakers over UPnP/SSDP: speaker list, volume, mute,
favorites, stop, now playing. See `docs/003-discovery-findings.md` for what was learned about the device.

```
npm install        # then run `node node_modules/electron/install.js` to get electron binary
npm run dev        # run with hot reload
npm run dev:debug  # + debugger ports 9229 (main) / 9222 (renderer); see docs/004-debugging.md
npm test           # unit + mock-server integration tests
npm run smoke      # headless check against real hardware (add -- --play to play a favorite)
npm run dist       # package (AppImage/deb on Linux, dmg on macOS)
```

Network: discovery uses one SSDP socket per interface (Settings → Network to pin one). If nothing is
found, allow UDP 1900 and UDP replies in your firewall; on macOS grant Local Network access.

Status: discovery, volume, mute, stop, state, favorites listing and **playing a favorite** work on
hardware. Favorites are played through the speaker's zone (virtual renderer); if none exists yet, start
the speaker once with its own button. See the findings doc:
[003-discovery-findings.md](docs/003-discovery-findings.md).
