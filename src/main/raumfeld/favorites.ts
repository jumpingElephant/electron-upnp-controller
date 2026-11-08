import type { Favorite, FavoriteSource, RaumfeldDevice } from '@shared/types.ts';
import { buildItemMetadata, parseDidl, type DidlObject } from '../upnp/didl';
import { callSoap } from '../upnp/soap';

const CD = 'urn:schemas-upnp-org:service:ContentDirectory:1';

/** Container ids observed on a Teufel One M (fw 12345). */
export const FAVORITE_SOURCES: FavoriteSource[] = [
  { id: '0/Favorites/MyFavorites', title: 'Favourites' },
  { id: '0/Favorites/RecentlyPlayed', title: 'Last played' },
  { id: '0/Favorites/MostPlayed', title: 'Most played' },
];

async function browse(
  server: RaumfeldDevice,
  objectId: string,
  flag: 'BrowseDirectChildren' | 'BrowseMetadata',
  count = 100,
): Promise<DidlObject[]> {
  const cd = server.services['ContentDirectory'];
  if (!cd) throw new Error('Media server has no ContentDirectory');
  const r = await callSoap(cd.controlUrl, cd.serviceType || CD, 'Browse', {
    ObjectID: objectId,
    BrowseFlag: flag,
    Filter: '*',
    StartingIndex: 0,
    RequestedCount: count,
    SortCriteria: '',
  });
  return parseDidl(r['Result'] ?? '');
}

export async function listFavorites(
  server: RaumfeldDevice,
  containerId: string,
): Promise<Favorite[]> {
  const objs = await browse(server, containerId, 'BrowseDirectChildren');
  return objs.map((o) => ({ id: o.id, title: o.title, albumArt: o.albumArt, kind: o.kind }));
}

/**
 * Build the Raumfeld "play this ContentDirectory object" URI that the official app and the
 * hardware buttons use. Observed on a Teufel One M (fw 12345):
 *   - items (radio stations, tracks):   dlna-playsingle://uuid%3A<server>?sid=...&iid=<objectId>
 *   - containers (playlists, albums):   dlna-playcontainer://uuid%3A<server>?sid=...&cid=<objectId>&md=0
 * The renderer resolves the object itself via the media server, so no stream URL is needed
 * (favorites have none: TuneIn items only carry a playlist URL the speaker cannot decode).
 * This must be sent to a *zone* (virtual renderer); the bare room renderer answers 701/no-media.
 */
export function playUri(serverUdn: string, kind: 'item' | 'container', objectId: string): string {
  const base = `uuid%3A${serverUdn}?sid=${encodeURIComponent('urn:upnp-org:serviceId:ContentDirectory')}`;
  const id = encodeURIComponent(objectId);
  return kind === 'container'
    ? `dlna-playcontainer://${base}&cid=${id}&md=0`
    : `dlna-playsingle://${base}&iid=${id}`;
}

/** Resolve a favorite to the URI AVTransport needs (checks it exists and whether it is a container). */
export async function resolvePlayable(
  server: RaumfeldDevice,
  id: string,
): Promise<{ uri: string; metadata: string }> {
  const [obj] = await browse(server, id, 'BrowseMetadata', 1);
  if (!obj) throw new Error('Favorite not found');
  // Empty metadata works on the zone renderer; it fills in the real track metadata itself.
  return {
    uri: playUri(server.udn, obj.kind === 'container' ? 'container' : 'item', id),
    metadata: '',
  };
}

/** First stream URL in a playlist body (plain TuneIn answer, .m3u or .pls). */
export function firstStreamUrl(body: string): string | undefined {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim().replace(/^File\d+=/i, '');
    if (/^https?:\/\//i.test(line)) return line;
  }
  return undefined;
}

/**
 * Fallback for when the speaker has no zone (e.g. while a Bluetooth client is connected: the
 * zone's virtual renderer is gone, and the room renderer cannot resolve dlna-play* URIs).
 * Resolves a radio favorite to its real stream URL - TuneIn's `Tune.ashx` answers with the plain
 * stream URL - so it can be handed to the room renderer as an ordinary http stream.
 */
export async function resolveDirectStream(
  server: RaumfeldDevice,
  id: string,
): Promise<{ uri: string; metadata: string }> {
  const [obj] = await browse(server, id, 'BrowseMetadata', 1);
  if (!obj) throw new Error('Favorite not found');
  if (obj.kind === 'container' || !obj.res) {
    throw new Error(
      'This favorite (playlist/album) can only be started through a zone. Start the speaker once with its play button, then retry.',
    );
  }
  let uri = obj.res.uri;
  const isPlaylist =
    /mpegurl|x-scpls/i.test(obj.res.protocolInfo ?? '') ||
    /Tune\.ashx|\.(m3u8?|pls)(\?|$)/i.test(uri);
  if (isPlaylist) {
    let body: string;
    try {
      const r = await fetch(uri, { signal: AbortSignal.timeout(6000) });
      body = await r.text();
    } catch (e) {
      throw new Error(
        `Could not look up the stream for this favorite (is the internet reachable?): ${(e as Error).message}`,
        { cause: e },
      );
    }
    const stream = firstStreamUrl(body);
    if (!stream) throw new Error('The radio directory returned no stream URL for this favorite');
    uri = stream;
  }
  const metadata = buildItemMetadata({
    ...obj,
    res: { uri, protocolInfo: 'http-get:*:audio/mpeg:*' },
  });
  return { uri, metadata };
}
