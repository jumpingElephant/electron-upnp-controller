# First Actions

I'll start by checking the working directory and tool versions.

The speaker is reachable, so I can run the spike against real hardware. I'll fetch the descriptions and SCPDs into the
fixtures directory.

ConfigService has no zone actions, so I'll probe the media server's favorites, volume, and the other endpoints next.

Browse and volume both work. Next I'll look at the Favorites children and the Zones and Renderers containers.

Favorite items have no `res`, only `raumfeld:ebrowse`. I'll try the `dlna-playsingle://` URI form on the room renderer,
which will briefly play audio on the speaker. I'll stop it right afterwards.

The renderer accepted the URI but reported no media. I'll try the item's `ebrowse` TuneIn URL, which should resolve to a
real stream URL.

Dependencies are installed. Now the config files and the shared types.

Next the UPnP layer: SOAP, description parsing, DIDL, interface handling and SSDP.

Now the Raumfeld layer: discovery, favorites, controller, and settings.

Now the main process entry, IPC, and preload.

Now the renderer (Svelte 5).

Typecheck and build pass. I'll remove the unused svelte config, then write the smoke script and tests.

Top-level await isn't supported in CJS mode. I'll rename the script to `.mts`.

Unit tests pass. Next an integration test against a mock UPnP server, plus packaging, CI and docs.

Both test files pass. Now packaging, CI and docs.

Lint and typecheck flagged a few things. I'll relax the `any` rule for the XML parsing code, where the parsed shape is
untyped, and fix the rest.

Lint, typecheck, tests and build are clean. As a last check, I'll launch the real Electron app briefly to confirm it
starts without errors.

The app starts and stays up with no errors until `timeout` stops it. I did not inspect the window itself.

The app is built and runs, but playing a favorite doesn't work yet. Everything else I tested works on your Teufel One M.

## What works

- **Discovery:** SSDP runs on one socket per network interface, and it found the speaker on `wlxc83a35bd96bd`. The
  Fritz!Box MediaServer and the setup device were rejected, and the malformed bare-IP announcement was dropped.
- **Volume, mute, stop, state:** these use plain UPnP calls on the room renderer. I confirmed `GetVolume` returns 35.
- **Favorites list:** the MediaServer lists them from `0/Favorites/MyFavorites`, `RecentlyPlayed` and `MostPlayed`.
- **UI:** the Svelte window has a speaker picker, a Stop button, a volume slider with mute, a favorites grid, a
  now-playing bar, settings for choosing the network interface, and manual IP entry. Typecheck, lint, 23 tests and the
  build all pass. The tests include a mock UPnP server and fixtures captured from your speaker.
- **Packaging:** electron-builder is configured and CI is written. I have not run either.

## Playing a favorite

- **Stream URL rejected:** the favorite's `<res>` is a TuneIn `.m3u` playlist URL. The speaker accepted it but reported
  "GStreamer … missing a plug-in" and stayed idle.
- **`dlna-playsingle

://`rejected:** with no metadata the speaker said "Stream doesn't contain enough data". With metadata,`Play` was refused
with UPnP error 701.

- **Zone route not found:** `ConfigService` has no zone actions and `:47365/getZones` isn't served. With one room there
  is no virtual zone renderer, so I found no way to play through a zone.
- **Where it stands:** the app tries the `res` URL and shows the speaker's own error message. The attempts are tabulated
  in `003-discovery-findings.md`.

## Decision for you

My command that fetched the TuneIn URL from this machine (to see if it resolves to a direct stream) was denied, because
it contacted an external service with your speaker's serial. I didn't retry it or work around it.

**Option (a)** is for the app to resolve the TuneIn playlist itself and hand the real stream URL to the renderer. That
means the app contacts TuneIn directly. It's the quickest way to get playback working, and I'd need your OK to test it.

**Option (b)** is to find how the official app creates a zone, either by sniffing its traffic or by trying a second
room. It's slower but stays inside the speaker's own protocol. I'd need either a capture or another speaker for this.

Which should I do?

## Other notes

- State is polled every 2 seconds. I did not implement GENA event subscriptions.
- The speaker briefly played audio during testing and was stopped afterwards; its volume is unchanged at 35.
- `npm install` didn't download Electron's binary on its own, so I ran `node node_modules/electron/install.js`. A fresh
  `npm install` may need the same step.

Configured authentication: JetBrains
