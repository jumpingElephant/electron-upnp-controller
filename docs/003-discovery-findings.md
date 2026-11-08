# Discovery & control findings (Teufel One M, fw protocolVersion 12345)

Observed on the real device; fixtures live in `test/fixtures/`.

- One speaker announces **three root devices + a setup device**, each on its own **ephemeral port**
  (always follow SSDP `LOCATION`; never hardcode ports): MediaRenderer ("Speaker One Room"),
  ConfigDevice, MediaServer ("Raumfeld MediaServer"), RaumfeldDevice (setup – ignored).
- Manufacturer is **"Lautsprecher Teufel GmbH"**. Identification = Teufel/Raumfeld marker in the _fetched description_
  (`raumfeld:` elements, `schemas-raumfeld-com` type, or manufacturer
  /teufel|raumfeld/i). A MediaServer/Renderer type alone is never enough (FRITZ!Box is one too).
- Announcements are duplicated and one was malformed (`Location: 192.168.178.32`, no scheme) → dropped.
  Descriptions are fetched once per distinct LOCATION; negatives are cached.
- Serial numbers do not unify devices; group by host IP.
- `ConnectionManager` SCPD is `cm.xml` (no leading slash) → resolve against the description URL.
- **ConfigService has no zone actions** (only GetPublicKey / Get/SetPreferences / GetRevision /
  GetDevice). `:47365/getZones` is not served. With one room there is no virtual zone renderer (`0/Zones` is empty;
  `0/Renderers` lists the room renderer).
- **Volume/mute/transport state**: plain `RenderingControl` / `AVTransport` on the room renderer work (`GetVolume` → 35,
  `GetTransportInfo` ok).
- **Favorites** live in `0/Favorites/{MyFavorites,RecentlyPlayed,MostPlayed,...}` of the MediaServer.
  `BrowseDirectChildren` items have **no `<res>`**, only `raumfeld:ebrowse`; `BrowseMetadata` on the
  item returns a `<res protocolInfo="http-get:*:audio/x-mpegurl:*">` TuneIn playlist URL.

## Playing a favorite (solved)

Favorites cannot be played on the bare room renderer (`Speaker One Room`, `/AVTransport/ctrl`): it
has no queue and no TuneIn decoder (errors: GStreamer plug-in missing / "not enough data" / 701).
The official app and the hardware buttons play through the **zone's virtual renderer**
(`modelDescription` "Virtual Media Player", control URL `/TransportService/Control`, listed under the
MediaServer's `0/Zones`). It appeared once the speaker had been started with its own button.

On that renderer, send the object reference (not a stream URL):

```
SetAVTransportURI  CurrentURI = dlna-playsingle://uuid%3A<mediaserver-udn>
                                 ?sid=urn%3Aupnp-org%3AserviceId%3AContentDirectory
                                 &iid=<url-encoded object id, e.g. 0%2FFavorites%2FMyFavorites%2F10>
                   CurrentURIMetaData = ""            (the item's DIDL also works)
Play               Speed = 1
```

Verified on hardware: `TRANSITIONING` -> `PLAYING`, track title from `GetPositionInfo.TrackMetaData`.
Note the `uuid%3A` (encoded colon) – plain `uuid:` is not what the device itself uses. The device
rewrites `GetMediaInfo` to `dlna-playcontainer://…&cid=0%2FZones%2Fuuid%253A<zone>&md=0&fii=0` (the zone
queue "Track List"); its `GetPositionInfo.TrackMetaData` holds the real item. Favorite ids are
`0/Favorites/MyFavorites/<n>` (the title is not part of the id). Container favorites use the
`dlna-playcontainer://…&cid=<id>&md=0` form (implemented, not yet verified on hardware).

### No zone (Bluetooth client connected)

While a Bluetooth client is connected the speaker has **no zone renderer**: it is not announced, the
old port is dead, and `0/Zones` keeps listing a stale queue. The room renderer then cannot resolve
`dlna-play*` URIs (`Play` -> 701, status "Stream doesn't contain enough data"), and `Stop` /
`LeaveStandby` do not bring the zone back. No UPnP action creates a zone (ConfigService, SetupService
and RaumfeldGenerator have none). A hardware preset button press does: a **new** zone renderer (new
UDN and port each time) appears within a second, receives the same `dlna-playsingle://…iid=<favorite>`
URI, and the room starts playing - the zone is created by the speaker/host itself, not by a client.

Workaround used by the app (`resolveDirectStream`): `BrowseMetadata` the favorite, GET its TuneIn
`res` URL (`Tune.ashx`, answers with the plain stream URL, e.g. `https://streamer.radio.co/…/listen`),
and send that as `SetAVTransportURI` (+ item DIDL) and `Play` to the **room renderer**. Needs internet
on the PC; works for radio items only (containers still need a zone).
