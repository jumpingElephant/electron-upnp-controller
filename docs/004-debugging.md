# Debugging guide

An Electron app is **two kinds of processes**, and each is debugged differently:

| Process                | Code                                             | Runs in                 | Debug protocol / port              |
|------------------------|--------------------------------------------------|-------------------------|------------------------------------|
| **Main**               | `src/main/**` (SSDP, SOAP, `ipc.ts`, controller) | Node.js inside Electron | V8 inspector, **9229**             |
| **Preload + Renderer** | `src/preload/**`, `src/renderer/**` (Svelte UI)  | Chromium                | Chrome DevTools Protocol, **9222** |

Most Raumfeld logic lives in the main process, so you usually want to attach to 9229.
IPC handlers (`src/main/ipc.ts`) sit on the boundary: the renderer calls `window.api.*`, which
arrives at an `ipcMain.handle(...)` there.

## npm scripts

| Script                  | What it does                                                                                                                                                |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `npm run dev`           | Normal dev run with hot reload, no debugger ports.                                                                                                          |
| `npm run dev:debug`     | Dev run + source maps + main inspector on `9229` + renderer debugging on `9222`.                                                                            |
| `npm run dev:debug-brk` | Same, but the main process **pauses before the first line** (use to debug startup, e.g. `registerIpc`/discovery start). It waits until a debugger attaches. |
| `npm run test:debug`    | Vitest paused at start, inspector on `9230`, single-threaded.                                                                                               |
| `npm run smoke:debug`   | Headless hardware smoke test paused at start, inspector on `9231` (no Electron).                                                                            |

Both debug ports bind to `127.0.0.1` only. Don't expose them: anything that reaches the port
can run code as you.

Quick check that the ports are live (after `npm run dev:debug`):

```
curl -s localhost:9229/json/list    # main process  (type: node)
curl -s localhost:9222/json/list    # renderer      (type: page, url http://localhost:5173/)
```

Notes:

- Main/preload edits require an Electron restart; renderer edits hot-reload. After a main
  restart the debugger disconnects and must reattach (see "reconnect" below).
- `--sourcemap` is what makes breakpoints land on your `.ts`/`.svelte` lines instead of
  `out/main/index.js`. Always debug via `dev:debug*`, not plain `dev`.
- The app holds a single-instance lock; close a running copy before starting another.

---

## A. JetBrains IDE (IntelliJ IDEA Ultimate / WebStorm)

The JavaScript debugger is part of IDEA Ultimate and WebStorm (not Community). Node.js and
JavaScript plugins must be enabled.

### One-time: create the run configurations

1. **Start the app:** `Run | Edit Configurations | + | npm`
    - Name: `dev:debug`, package.json: project `package.json`, Command: `run`, Scripts: `dev:debug`.
    - Run it with the normal ▶ **Run** button, _not_ Debug. The IDE's own Node debugger would
      debug the `electron-vite` launcher process, which isn't where your code runs.
2. **Attach to main:** `+ | Attach to Node.js/Chrome`
    - Name: `Attach main (9229)`, Host `localhost`, Port `9229`.
    - Tick **Reconnect automatically** so it survives main-process restarts.
3. **Attach to renderer:** `+ | Attach to Node.js/Chrome`
    - Name: `Attach renderer (9222)`, Host `localhost`, Port `9222`.
    - The IDE lists the Electron page target (s); pick `Raumfeld Controller`.
4. _(Optional)_ **Compound:** `+ | Compound` -> add `Attach main` and `Attach renderer`, so one click
   attaches both.

### Debug session

1. Run `dev:debug` (▶). Wait for the app window.
2. Run `Attach main (9229)` (🐞 Debug) and/or `Attach renderer (9222)`.
   The Debug tool window shows `Debugger attached`.
3. Set breakpoints by clicking the gutter. Good first ones:
    - `src/main/ipc.ts` in `withTarget` (every volume/mute/stop/play call goes through it) and
      in the `ipcMain.handle(CHANNELS.setVolume, ...)` handler.
    - `src/main/ipc.ts` `pollOnce` (hit every 2 s — use a _conditional_ breakpoint or logpoint
      to avoid pausing constantly).
    - `src/main/upnp/soap.ts` to inspect the raw SOAP request/response.
    - `src/renderer/src/lib/VolumeControl.svelte` for the UI side (needs the renderer attach).
4. Trigger the action in the app (move the slider). Execution pauses in the IDE; use **Evaluate Expression** (Alt+F8)
   and watches as usual.
   Use **Logpoints** (right-click gutter -> _Evaluate and log_) to print `udn`/`v` without pausing.

### Debugging startup (before the window exists)

Use `dev:debug-brk` instead of `dev:debug`. Run it, then start `Attach main (9229)`;
execution stays paused at the first line of `out/main/index.js` until you press **Resume**.

### Tests and the smoke script

- **Vitest:** open a test file, click the gutter ▶ next to `it(...)`/`describe(...)` and choose **Debug**. The Vitest
  run configuration is built in; no attach needed.
- **Smoke script:** `Run | Edit Configurations | + | Node.js`: Node parameters
  `--import tsx`, JavaScript file `scripts/smoke.mts`, Application parameters `--play` if wanted. (Or run
  `npm run smoke:debug` and use an _Attach to Node.js/Chrome_ on port `9231`.)

### Troubleshooting (JetBrains)

- _Breakpoints are grey / "not bound"_: you started with `npm run dev` instead of `dev:debug`
  (no source maps), or the file you're breaking in isn't part of the main bundle.
- _"Connection refused"_: the app isn't running yet; start `dev:debug` first, wait ~5 s.
- _Attached to the wrong thing_: port `9229` = main process, `9222` = Chromium. They are
  different debuggers; you can attach both at once.

---

## B. Independent of any IDE: Chrome DevTools

Needs only Chrome/Chromium (or Edge). Works the same on Linux, macOS and Windows.

### Main process (Node)

1. `npm run dev:debug`
2. In Chrome open `chrome://inspect` -> **Configure…** -> ensure `localhost:9229` is listed.
3. Under **Remote Target** the main process appears (type Node). Click **inspect**
   (or use the green Node icon in any DevTools window: _Open dedicated DevTools for Node_,
   which auto-discovers and auto-reconnects on restart).
4. **Sources** tab -> `Ctrl+P` and type `ipc.ts` to open the original TypeScript (source maps) ->
   click a line number to set a breakpoint. The **Console** is a REPL in the main process (you can't access `discovery`/
   `controller` unless a breakpoint pauses inside the closure).

### Renderer (Svelte UI)

Choose either:

- **In-app DevTools** (simplest): `RAUMFELD_DEVTOOLS=1 npm run dev:debug` opens a detached
  DevTools window for the UI. Or press `Ctrl+Shift+I` (`Cmd+Opt+I` on macOS) in the app window.
- **From Chrome** (same session as main): in `chrome://inspect` add `localhost:9222` under _Configure…_; the
  `Raumfeld Controller` page shows up under **Remote Target** -> **inspect**.
  Alternatively browse to `http://localhost:9222` for the target list.

Useful panels: **Console** (calls like `await window.api.getDevices()` hit the real preload
bridge -> `ipc.ts`), **Network** (the UI makes no UPnP requests itself — all SOAP/SSDP traffic
is in the main process), **Sources** (`src/renderer/src/lib/*.svelte`), **Elements**.

### Debugging startup

`npm run dev:debug-brk`, then attach as above; main stays paused on the first line until you
click **Resume** (▶) in DevTools.

### Tests and the smoke script

```
npm run test:debug     # open chrome://inspect, add localhost:9230, click inspect, press Resume
npm run smoke:debug    # same with localhost:9231
```

(Both start paused; the process waits for you.) Use `-- --play` after `smoke:debug` if you want
the favorite-playing step.

### Network-level debugging (no debugger needed)

Often the real question is "what is the speaker doing?", which no JS debugger shows:

```
gssdp-discover --timeout 3 --interface <iface>               # what SSDP announces (see docs/003)
curl -s http://<speaker-ip>:<port>/rendercontrol.xml         # service description
sudo tcpdump -i <iface> -A -s0 'host <speaker-ip> and tcp'   # SOAP bodies in plain HTTP
```

### Troubleshooting (Chrome)

- _Target missing in `chrome://inspect`_: add `localhost:9229`/`localhost:9222` under _Configure…_; verify with the
  `curl .../json/list` commands above.
- _Port already in use_: a previous run is still alive (`pgrep -fa electron`); kill it, or
  change the ports in `package.json`.
- _Everything is minified / `out/main/index.js` shown_: run via `dev:debug`, not `dev`/`preview`.
- _Packaged app_: `electron-builder` output has the fuses/flags of production; for debugging
  use `npm run dev:debug` instead of the AppImage.
