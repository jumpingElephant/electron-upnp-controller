# Plan: Electron UPnP controller for Teufel Raumfeld

## Context

Greenfield project (empty dir, Node 24 / npm 11 available). Goal: a small, friendly desktop app that finds Raumfeld
devices on the LAN via UPnP/SSDP and offers: volume, mute, play a favorite, stop. Linux first, macOS second, Windows
best-effort (dropped if it becomes a maintenance burden). Proprietary features outside UPnP are out of scope.

## Scope (MVP)

1. Auto-discover Raumfeld host/zones on the LAN (SSDP), with manual-IP fallback.
2. Zone/room list; select the target.
3. Volume slider, mute toggle.
4. Favorites list (from Raumfeld's ContentDirectory) → click to play.
5. Stop button, plus now-playing/state display.

Non-goals: library browsing, grouping/room management, firmware/settings, queue editing, streaming-service logins.

## Architecture

- **Main process** (Node, TypeScript): all networking (UDP multicast, HTTP/SOAP). Renderer never touches the network.
- **Preload** with `contextBridge` exposing a narrow typed API; `contextIsolation: true`, `nodeIntegration: false`,
  sandbox on, strict CSP.
- **Renderer**: Vite + Svelte (or React; Svelte chosen for small footprint) with plain CSS; single window, dark/light
  via `prefers-color-scheme`.
- **IPC**: `ipcMain.handle` for commands (`discover`, `selectZone`, `setVolume`, `setMute`, `playFavorite`, `stop`,
  `listFavorites`); `webContents.send` for events (`devices-changed`, `state-changed`).
- **Packaging**: electron-builder — AppImage + deb (Linux), dmg (macOS), nsis (Windows, optional/CI-only).

### Dependency choice: custom thin UPnP layer vs. library

Write our own small modules (~400 LOC) using `node:dgram` + `fetch` + `fast-xml-parser` rather than an unmaintained UPnP
library. Raumfeld needs custom handling (zone topology, favorites DIDL, room volume) anyway, and the SOAP surface we
need is tiny.

## Module layout

```
src/main/
  index.ts              window + app lifecycle, single-instance lock
  ipc.ts                IPC handlers/events <-> controller
  upnp/ssdp.ts          M-SEARCH (multicast 239.255.255.250:1900) + NOTIFY listen; filter by device description
  upnp/description.ts   fetch/parse device description XML -> services + controlURLs
  upnp/soap.ts          generic SOAP action call + fault parsing, timeouts, retry
  upnp/didl.ts          DIDL-Lite parse/serialize (needed to play favorites)
  upnp/interfaces.ts    enumerate/filter NICs, per-interface socket lifecycle, rescan on change
  raumfeld/discovery.ts classify devices (Teufel manufacturer / raumfeld URNs; Renderer, ConfigDevice, MediaServer; ignore RaumfeldDevice), dedupe by UDN, group by serial, emit device list
  raumfeld/zones.ts     read zone topology (zones/rooms -> virtual renderer per zone)
  raumfeld/favorites.ts Browse ContentDirectory favorites container
  raumfeld/controller.ts  high-level: setVolume/mute/play/stop/getState
  raumfeld/events.ts    GENA SUBSCRIBE for live state (fallback: poll 2s)
src/preload/index.ts    typed bridge
src/renderer/           App, DeviceSelector, ZoneList, VolumeControl, Favorites, NowPlaying
```

## UPnP details (to be verified against a real device in step 1)

- **Discovery** (see "Observed on the home network" below for evidence): SSDP `M-SEARCH` with `ST: ssdp:all` (plus
  targeted `MediaRenderer:1`, `MediaServer:1`, `urn:schemas-raumfeld-com:device:ConfigDevice:1`) **and** passive
  listening for `NOTIFY ssdp:alive/byebye`, on a **per-interface socket** (see Interface handling). Fetch each unique
  LOCATION, parse the description, classify by `deviceType`/namespace. Never hardcode ports. Manual `host` entry
  fallback: connect to the IP, but ports must still come from SSDP/description, so manual mode = "enter IP and run
  unicast M-SEARCH to `ip:1900`", and if that fails, accept a full description URL.
- **Zones**: the `ConfigDevice` (`ConfigService`) is the host-side entry point for zone topology. Spike step: fetch its
  SCPD (`/ConfigService.xml`) and list actions/state variables; also probe the well-known Raumfeld web endpoint
  `http://<ip>:47365/getZones` (used by community tools) as an alternative. Zone playback is addressed through the
  zone's _virtual_ MediaRenderer (appears when a zone exists), whereas room renderers (like "Speaker One Room") are
  per-device.
- **Volume/mute**: `RenderingControl` `SetVolume`/`GetVolume`/`SetMute`/`GetMute` (InstanceID 0, Channel Master) on the
  zone renderer. Optional per-room volume (`SetRoomVolume`) is a Raumfeld extension — include only if simple.
- **Favorites**: `ContentDirectory.Browse` on the host's media server for the favorites containers (Raumfeld uses
  `0/Favorites/...` style container IDs, e.g. radio favorites). Parse DIDL items (title, album art, `res`).
- **Play favorite**: `AVTransport.SetAVTransportURI` with the item's `res` URI + DIDL metadata, then `Play`.
  Container-type favorites may need Raumfeld's `dlna-playcontainer://` URI form — confirm by sniffing the official app /
  inspecting Browse output.
- **Stop**: `AVTransport.Stop`. **State**: `GetTransportInfo`/`GetPositionInfo` + GENA events.
- Throttle volume slider IPC (~100ms trailing) to avoid flooding SOAP.

## Observed on the home network (Teufel One M, fw protocolVersion 12345, hardwareType 19)

Discovered via `gssdp-discover --interface wlxc83a35bd96bd --message-type available`; one speaker at 192.168.178.32
announced three root devices, each on its own **dynamic port**:

| deviceType                                         | friendlyName             | port  | services                                                              | Use                                          |
|----------------------------------------------------|--------------------------|-------|-----------------------------------------------------------------------|----------------------------------------------|
| `urn:schemas-upnp-org:device:MediaRenderer:1`      | "Speaker One Room"       | 52475 | RenderingControl, AVTransport, ConnectionManager, `RaumfeldGenerator` | volume/mute, transport (room renderer)       |
| `urn:schemas-raumfeld-com:device:RaumfeldDevice:1` | "Teufel Raumfeld Device" | 51025 | `SetupService`                                                        | **ignore** (setup/provisioning, proprietary) |
| `urn:schemas-raumfeld-com:device:ConfigDevice:1`   | "Raumfeld ConfigDevice"  | 51069 | `ConfigService`                                                       | zone/room topology                           |
| `urn:schemas-upnp-org:device:MediaServer:1`        | "Raumfeld MediaServer"   | 50869 | ContentDirectory (`/cd/Control`), ConnectionManager                   | **favorites** (Browse)                       |

(Same host, 192.168.178.32. ConfigDevice and MediaServer share the _host_ serial
`12c14a8f-8bd8-4f9b-9d50-5e8c553f70ba`.)

Findings and consequences:

1. **Manufacturer is "Lautsprecher Teufel GmbH"**, not "Raumfeld" (my earlier filter would have missed it; the user's
   `grep -i raumfeld` only matched via URNs). Identification rule: `deviceType` or description namespace contains
   `schemas-raumfeld-com`, **or** manufacturer matches /teufel|raumfeld/i. The serial numbers do **not** unify the
   devices (MAC vs. host serial), so group the Raumfeld devices into one "speaker/system" in the UI by **source IP**
   (plus `modelName`), not by serial.
2. **Ports are ephemeral** (52475/51025/51069) and change after reboot → the 47365 assumption is dropped; always follow
   SSDP `LOCATION`. Cache last-known UDNs, not ports, and re-resolve via SSDP.
3. **Duplicates**: each description was returned twice (multiple NT/USN announcements per device). Dedupe by `UDN`, keep
   newest LOCATION.
4. **The MediaServer was hidden by the grep filter — confirmed by the unfiltered scan.** It is
   `urn:schemas-upnp-org:device:MediaServer:1`, friendlyName "Raumfeld MediaServer", UDN `c436e837-…`, port 50869,
   `ContentDirectory` (`SCPD /cds.xml`, control `/cd/Control`, event `/cd/Event`) and `ConnectionManager` (`cm.xml` —
   note: **no leading slash**, resolve relative to the description URL). Its USN contains no "raumfeld" at all, so it
   can only be recognised from the fetched description (manufacturer "Lautsprecher Teufel GmbH", friendlyName,
   `raumfeld:` namespace elements). This is the source for favorites.
    - **Other MediaServers exist on the LAN**: the FRITZ!Box (192.168.178.1:49000, `MediaServerDevDesc.xml`, plus
      IGD/WAN/l2tpv3/fritzbox devices). The app must **never accept a device just because it is a
      MediaServer/MediaRenderer**; classification requires the fetched description to carry the Teufel/Raumfeld marker
      (manufacturer /teufel|raumfeld/i, or `raumfeld:protocolVersion`/`raumfeld:hardwareType` elements present). Good
      cheap rule: description contains the `xmlns:raumfeld="urn:schemas-raumfeld-com:device"` elements.
    - **A malformed announcement** was seen: `USN uuid:0b5a682f-…` with `Location: 192.168.178.32` (bare IP, no
      scheme/port). Parser must ignore LOCATIONs that are not valid `http(s)` URLs (curl to it hit port 80, refused).
      Also skip fetching descriptions for non-Teufel hosts cheaply: fetch each distinct LOCATION once, cache negatives
      (the Fritz!Box announces ~40 USNs for 6 descriptions; dedupe by LOCATION before any HTTP).
    - **Still not seen: a virtual zone renderer** ("Raumfeld Virtual Media Player"). With a single room, only the room
      renderer `Speaker One Room` exists. Open question for the spike: does the host create the zone/virtual renderer on
      demand (via `ConfigService`) or can the room renderer be driven directly with `SetAVTransportURI`+`Play`? Plan:
      try direct room-renderer playback first (simplest, pure UPnP); if the device refuses, create a zone via
      ConfigService.
5. **Interface selection matters**: SSDP multicast leaves/arrives only on the interface it's
   bound to; on this Linux host with multiple NICs (wifi plus likely ethernet/docker/virtual), the
   default route may not be the speaker's LAN. The app therefore must not rely on a single default socket.
6. Speaker is on a subnet; the model name `Teufel One M` is a useful display label next to friendlyName.
7. The description XML's `RaumfeldGenerator` service on the renderer is proprietary — not used.

### Interface handling (new design requirement)

- Enumerate `os.networkInterfaces()`; candidates = non-internal IPv4 interfaces that are up. De-prioritize/skip
  `docker*`, `veth*`, `br-*`, `virbr*`, `tun*/tap*`, `vboxnet*`, `vmnet*`, `lo`.
- Create **one UDP socket per candidate interface**, bind to that interface's address (port 0 for M-SEARCH replies;
  separate listener on 1900 with `reuseAddr` and `addMembership('239.255.255.250', ifaceAddr)` for NOTIFYs), set
  `setMulticastInterface(ifaceAddr)`, TTL 2–4.
- Tag every discovered device with the interface it was seen on; use that source address when talking to it and when
  advertising a GENA callback URL (`CALLBACK: <http://ifaceIp:port/...>`).
- UI: "Network" dropdown under Settings (Auto = all candidates; or pick one interface), persisted. Show which interface
  found the speaker. If nothing is found, show a hint listing the interfaces tried plus the firewall note (UDP 1900 in,
  ephemeral UDP replies, TCP callback port).
- Re-scan on interface change (`os.networkInterfaces()` polling every ~10s; no native event) — handles wifi reconnects.

### Fixtures to commit (from the user's captured output)

`test/fixtures/` gets the four Raumfeld description XMLs verbatim (renderer, RaumfeldDevice, ConfigDevice, MediaServer),
a trimmed FRITZ!Box `MediaServerDevDesc.xml` as a negative case, a raw SSDP capture (including the bare-IP LOCATION
oddity), plus the SCPDs fetched in the spike (`rendercontrol.xml`, `avtransport.xml`, `ConfigService.xml`, `cds.xml`).
Parser tests assert classification: renderer → usable, MediaServer (Teufel) → favorites source, ConfigDevice → zone
source, RaumfeldDevice → ignored, FRITZ!Box MediaServer → rejected, malformed LOCATION → dropped. Note the
descriptions' first sample had an XML declaration while later ones did not; the parser must handle both.

## UX

- First run: "Searching for Raumfeld devices…" spinner → list autofills; single result auto-selected; "Enter IP
  manually" link; clear error states (no network, firewall blocking UDP 1900, device lost → auto-retry).
- Main view: zone dropdown, big stop button, volume slider + mute, grid of favorite tiles (art + title), now-playing
  bar.
- Remember last zone in `electron-store`/JSON in `app.getPath('userData')`.
- Keyboard: media keys optional later; arrow keys adjust volume when slider focused.

## Platform notes

- Linux: AppImage/deb; firewall (ufw) may block SSDP replies and GENA callbacks → polling fallback and a help hint.
  Wayland/X11 both fine.
- macOS: first multicast use triggers Local Network permission prompt (add `NSLocalNetworkUsageDescription` +
  `NSBonjourServices` to Info.plist via electron-builder `extendInfo`). Unsigned builds fine for personal use.
- Windows: keep in CI build matrix only while cheap; drop if firewall prompts/multi-NIC multicast issues cause
  maintenance cost.

## Implementation steps

1. Scaffold (electron-vite + TS + Svelte, eslint/prettier, vitest). Add `docs/` note on discovery findings.
2. Spike (before any UI; ContentDirectory already located at `:50869/cd/Control`): `curl` the SCPDs
   (`:52475/rendercontrol.xml`, `/avtransport.xml`, `:51069/ConfigService.xml`, `:50869/cds.xml`); SOAP `Browse`
   ObjectID `0` on the MediaServer and walk down to find the favorites container (s); try `SetAVTransportURI`+`Play`
   directly on the room renderer; try `GetVolume` via `curl` SOAP on `:52475/RenderingControl/ctrl`; probe
   `:47365/getZones`. Then implement `ssdp.ts` (per-interface) + `description.ts` against the real device; save samples
   into `test/fixtures/`.
3. `soap.ts`, `didl.ts` with unit tests on fixtures.
4. Zones, volume/mute, stop in `controller.ts`; CLI-ish smoke script to prove it before UI.
5. Favorites browse + play (the riskiest step; verify on device).
6. IPC + preload + renderer UI; events/polling.
7. Settings persistence, error handling, manual IP.
8. Packaging with electron-builder; CI (GitHub Actions) for linux/macOS (+windows optional).

## Verification

- Unit: vitest for SOAP envelope building/fault parsing, DIDL parse, SSDP response parsing using fixtures.
- Integration: a mock UPnP server (node http + dgram) emulating Raumfeld
  description/RenderingControl/AVTransport/ContentDirectory, run in CI.
- Manual on real hardware (Linux first): discover → pick zone → change volume/mute (audible) → play a favorite radio
  station → stop; unplug/replug device to test rediscovery. Repeat smoke test on macOS.
- `npm run dev` for UI iteration; `npm run build && ` run packaged AppImage to confirm discovery works from the packaged
  app.

## Open risks

- Exact Raumfeld favorites container IDs and play URI format (mitigated by step 2/5 spike).
- ContentDirectory is confirmed; a virtual zone renderer is not visible in a single-room setup. If the room renderer
  rejects direct playback, zone creation via ConfigService (proprietary) may be needed — resolve in the step 2 spike and
  adjust scope with the user if needed.
- Multi-NIC multicast quirks (see Interface handling); Windows multicast-on-multiple-NICs is the main candidate for
  dropping Windows support.
- No hardware available in CI → rely on mock server + fixtures.
