import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller } from '../src/main/raumfeld/controller';
import { Discovery } from '../src/main/raumfeld/discovery';
import { fixture } from './helpers';

/** Mock Raumfeld host: serves the captured descriptions and fakes SOAP endpoints. */
let server: http.Server;
let base: string;
const calls: { action: string; body: string }[] = [];
let volume = 35;

const env = (body: string) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`;

const DIDL =
  '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0/Favorites/MyFavorites/1" parentID="0/Favorites/MyFavorites" restricted="1"><dc:title>Test Radio</dc:title><upnp:class>object.item.audioItem.audioBroadcast.radio</upnp:class><res protocolInfo="http-get:*:audio/mpeg:*">http://stream.example/1.mp3</res></item></DIDL-Lite>';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') {
        const file = {
          '/renderer.xml': 'renderer.xml',
          '/ms.xml': 'media-server.xml',
          '/zone.xml': 'zone-renderer.xml',
          '/fritz.xml': 'fritz-media-server.xml',
        }[req.url ?? ''];
        if (!file) return void res.writeHead(404).end();
        return void res.writeHead(200, { 'Content-Type': 'text/xml' }).end(fixture(file));
      }
      const action = /#(\w+)"?$/.exec(String(req.headers['soapaction']))?.[1] ?? '';
      calls.push({ action, body });
      let out = '';
      if (action === 'SetVolume') volume = Number(/<DesiredVolume>(\d+)/.exec(body)?.[1]);
      if (action === 'GetVolume') out = `<CurrentVolume>${volume}</CurrentVolume>`;
      if (action === 'GetMute') out = '<CurrentMute>0</CurrentMute>';
      if (action === 'GetTransportInfo')
        out =
          '<CurrentTransportState>PLAYING</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus>';
      if (action === 'GetMediaInfo') out = `<CurrentURIMetaData>${esc(DIDL)}</CurrentURIMetaData>`;
      if (action === 'Browse')
        out = `<Result>${esc(DIDL)}</Result><NumberReturned>1</NumberReturned>`;
      if (action === 'Explode') {
        return void res
          .writeHead(500)
          .end(
            env(
              '<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>701</errorCode><errorDescription>nope</errorDescription></UPnPError></detail></s:Fault>',
            ),
          );
      }
      res
        .writeHead(200, { 'Content-Type': 'text/xml' })
        .end(env(`<u:${action}Response xmlns:u="urn:x">${out}</u:${action}Response>`));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('controller against mock host', () => {
  it('discovers, rejects foreign devices, controls volume, plays a favorite', async () => {
    const d = new Discovery();
    d.on('log', () => {});
    // descriptions list absolute-path control URLs, resolved against the description URL
    expect((await d.addManual(`${base}/fritz.xml`)).ok).toBe(false); // FRITZ!Box-like: rejected
    expect((await d.addManual(`${base}/renderer.xml`)).ok).toBe(true);
    expect((await d.addManual(`${base}/ms.xml`)).ok).toBe(true);

    const [t] = d.targets();
    expect(t.name).toBe('Speaker One Room');

    // No zone (e.g. Bluetooth client connected): the favorite's plain stream URL is played on the room.
    await new Controller(d).playFavorite(t.udn, '0/Favorites/MyFavorites/1');
    const direct = calls.find((x) => x.action === 'SetAVTransportURI')!;
    expect(direct.body).toContain('http://stream.example/1.mp3');
    expect(direct.body).not.toContain('dlna-playsingle');
    calls.length = 0;
    expect((await d.addManual(`${base}/zone.xml`)).ok).toBe(true);
    // Once a zone exists it replaces the bare room renderer in the target list.
    expect(d.targets().map((x) => x.name)).toEqual(['One Room']);
    expect(d.mediaServerFor(t.udn)?.friendlyName).toBe('Raumfeld MediaServer');

    const c = new Controller(d);
    await c.setVolume(t.udn, 140); // clamped
    expect(volume).toBe(100);
    await c.setVolume(t.udn, 42);
    const st = await c.getState(t.udn);
    expect(st).toMatchObject({
      transport: 'PLAYING',
      volume: 42,
      mute: false,
      title: 'Test Radio',
    });

    const favs = await c.listFavorites(t.udn, '0/Favorites/MyFavorites');
    expect(favs[0]).toMatchObject({ id: '0/Favorites/MyFavorites/1', title: 'Test Radio' });

    await c.playFavorite(t.udn, favs[0].id);
    const names = calls.map((x) => x.action);
    expect(names.indexOf('SetAVTransportURI')).toBeLessThan(names.indexOf('Play'));
    const set = calls.find((x) => x.action === 'SetAVTransportURI')!;
    expect(set.body).toContain('dlna-playsingle://uuid%3Aeebcbd75-d71f-4bf2-9f60-178eea1d636a');
    expect(set.body).toContain('iid=0%2FFavorites%2FMyFavorites%2F1');

    await c.stop(t.udn);
    expect(calls.at(-1)?.action).toBe('Stop');
  }, 15000);
});
