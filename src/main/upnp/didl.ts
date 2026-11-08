import { asArray, escapeXml, text, xml } from './xml';

export interface DidlObject {
  id: string;
  parentId: string;
  kind: 'item' | 'container';
  title: string;
  upnpClass: string;
  albumArt?: string;
  artist?: string;
  res?: { uri: string; protocolInfo?: string };
}

export function parseDidl(didl: string): DidlObject[] {
  if (!didl) return [];
  let doc: any;
  try {
    doc = xml.parse(didl);
  } catch {
    return [];
  }
  const root = doc?.['DIDL-Lite'];
  if (!root || typeof root !== 'object') return [];
  const out: DidlObject[] = [];
  for (const kind of ['container', 'item'] as const) {
    for (const o of asArray<any>(root[kind])) {
      const res = asArray<any>(o.res)[0];
      const resUri = text(res);
      out.push({
        id: String(o['@_id'] ?? ''),
        parentId: String(o['@_parentID'] ?? ''),
        kind,
        title: String(text(o.title) ?? ''),
        upnpClass: String(text(o.class) ?? ''),
        albumArt: text(asArray<any>(o.albumArtURI)[0]),
        artist: text(asArray<any>(o.artist)[0]) ?? text(asArray<any>(o.creator)[0]),
        res: resUri
          ? {
              uri: resUri,
              protocolInfo: res?.['@_protocolInfo'] ? String(res['@_protocolInfo']) : undefined,
            }
          : undefined,
      });
    }
  }
  return out;
}

/** Minimal DIDL-Lite item to hand to SetAVTransportURI as CurrentURIMetaData. */
export function buildItemMetadata(o: DidlObject): string {
  const res = o.res
    ? `<res protocolInfo="${escapeXml(o.res.protocolInfo ?? 'http-get:*:*:*')}">${escapeXml(o.res.uri)}</res>`
    : '';
  const art = o.albumArt ? `<upnp:albumArtURI>${escapeXml(o.albumArt)}</upnp:albumArtURI>` : '';
  return (
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
    `<item id="${escapeXml(o.id)}" parentID="${escapeXml(o.parentId)}" restricted="1">` +
    `<dc:title>${escapeXml(o.title)}</dc:title>` +
    `<upnp:class>${escapeXml(o.upnpClass || 'object.item')}</upnp:class>` +
    art +
    res +
    '</item></DIDL-Lite>'
  );
}
