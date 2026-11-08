// noinspection XmlUnusedNamespaceDeclaration

import { firstStreamUrl } from '../src/main/raumfeld/favorites';
import { describe, expect, it } from 'vitest';
import { buildEnvelope, parseResponse, SoapFault } from '../src/main/upnp/soap';
import { parseDescription, validLocation, shortServiceName } from '../src/main/upnp/description';
import { buildItemMetadata, parseDidl } from '../src/main/upnp/didl';
import { buildMSearch, parseSsdp } from '../src/main/upnp/ssdp';
import { interfaceFor, listCandidateInterfaces } from '../src/main/upnp/interfaces';
import { classify } from '../src/main/raumfeld/classify';
import { fixture } from './helpers';

const LOC = 'http://192.168.178.32:50869/c436e837.xml';

describe('classification of captured descriptions', () => {
  const role = (file: string, loc = LOC) => {
    const d = parseDescription(fixture(file), loc);
    return d ? classify(d) : null;
  };
  it('renderer -> renderer', () => expect(role('renderer.xml')).toBe('renderer'));
  it('Teufel MediaServer -> mediaserver', () =>
    expect(role('media-server.xml')).toBe('mediaserver'));
  it('ConfigDevice -> config', () => expect(role('config-device.xml')).toBe('config'));
  it('RaumfeldDevice -> ignored', () => expect(role('raumfeld-device.xml')).toBeNull());
  it('FRITZ!Box MediaServer -> rejected', () =>
    expect(
      role('fritz-media-server.xml', 'http://192.168.178.1:49000/MediaServerDevDesc.xml'),
    ).toBeNull());
  it('handles XML with and without declaration', () => {
    const body = fixture('media-server.xml').replace(/^<\?xml[^>]*\?>\s*/, '');
    expect(parseDescription(body, LOC)?.udn).toBe('eebcbd75-d71f-4bf2-9f60-178eea1d636a');
  });
  it('resolves service URLs, incl. relative without leading slash', () => {
    const d = parseDescription(fixture('media-server.xml'), LOC)!;
    const cm = d.services.find((s) => shortServiceName(s.serviceType) === 'ConnectionManager')!;
    expect(cm.scpdUrl).toBe('http://192.168.178.32:50869/cm.xml');
    const cd = d.services.find((s) => shortServiceName(s.serviceType) === 'ContentDirectory')!;
    expect(cd.controlUrl).toBe('http://192.168.178.32:50869/cd/Control');
  });
  it('garbage -> null', () => expect(parseDescription('<html lang="en"/>', LOC)).toBeNull());
});

describe('ssdp', () => {
  const blocks = fixture('ssdp-capture.txt').split(/\n\n/);
  it('parses a search response', () => {
    const m = parseSsdp(blocks[0], '192.168.178.32')!;
    expect(m.kind).toBe('response');
    expect(m.maxAge).toBe(1800);
    expect(validLocation(m.location)?.port).toBe('52475');
  });
  it('drops the bare-IP LOCATION', () => {
    const m = parseSsdp(blocks[1], '192.168.178.32')!;
    expect(m.kind).toBe('alive');
    expect(validLocation(m.location)).toBeNull();
  });
  it('parses byebye', () => expect(parseSsdp(blocks[2], 'x')?.kind).toBe('byebye'));
  it('ignores foreign M-SEARCH', () =>
    expect(parseSsdp('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', 'x')).toBeNull());
  it('builds a valid M-SEARCH', () => {
    const s = buildMSearch('ssdp:all').toString();
    expect(s).toMatch(/^M-SEARCH \* HTTP\/1\.1\r\n/);
    expect(s).toContain('MAN: "ssdp:discover"');
    expect(s.endsWith('\r\n\r\n')).toBe(true);
  });
});

describe('soap', () => {
  it('builds an escaped envelope', () => {
    const e = buildEnvelope('urn:x:service:AVTransport:1', 'SetAVTransportURI', {
      CurrentURI: 'a&b<c>',
    });
    expect(e).toContain('<u:SetAVTransportURI xmlns:u="urn:x:service:AVTransport:1">');
    expect(e).toContain('<CurrentURI>a&amp;b&lt;c&gt;</CurrentURI>');
  });
  it('parses a response', () => {
    const r = parseResponse(
      'GetVolume',
      '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetVolumeResponse xmlns:u="urn:x"><CurrentVolume>35</CurrentVolume></u:GetVolumeResponse></s:Body></s:Envelope>',
    );
    expect(r).toEqual({ CurrentVolume: '35' });
  });
  it('parses an empty response', () => {
    const r = parseResponse(
      'Stop',
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:StopResponse xmlns:u="urn:x"></u:StopResponse></s:Body></s:Envelope>',
    );
    expect(r).toEqual({});
  });
  it('throws SoapFault with UPnP error code', () => {
    const fault =
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>701</errorCode><errorDescription>Action Play is currently not allowed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>';
    expect(() => parseResponse('Play', fault)).toThrow(SoapFault);
    try {
      parseResponse('Play', fault);
    } catch (e) {
      expect((e as SoapFault).code).toBe('701');
    }
  });
});

describe('didl', () => {
  const browseResult =
    '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:raumfeld="urn:schemas-raumfeld-com:meta-data/raumfeld" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">' +
    '<item parentID="0/Favorites/MyFavorites" id="0/Favorites/MyFavorites/10" restricted="1"><dc:title>Electro Swing &amp; Co</dc:title><upnp:class>object.item.audioItem.audioBroadcast.radio</upnp:class><upnp:albumArtURI dlna:profileID="JPEG_TN">https://x/y.jpg</upnp:albumArtURI><res protocolInfo="http-get:*:audio/x-mpegurl:*">http://t/Tune.ashx?a=1&amp;b=2</res></item>' +
    '<container parentID="0" id="0/Favorites" restricted="1"><dc:title>Fav</dc:title><upnp:class>object.container</upnp:class></container></DIDL-Lite>';
  it('parses items and containers incl. attribute-bearing nodes', () => {
    const objs = parseDidl(browseResult);
    const item = objs.find((o) => o.kind === 'item')!;
    expect(item.title).toBe('Electro Swing & Co');
    expect(item.albumArt).toBe('https://x/y.jpg');
    expect(item.res?.uri).toBe('http://t/Tune.ashx?a=1&b=2');
    expect(objs.find((o) => o.kind === 'container')?.id).toBe('0/Favorites');
  });
  it('empty / garbage DIDL -> []', () => {
    expect(parseDidl('')).toEqual([]);
    expect(parseDidl('<DIDL-Lite xmlns="x"/>')).toEqual([]);
  });
  it('round-trips metadata', () => {
    const item = parseDidl(browseResult).find((o) => o.kind === 'item')!;
    const again = parseDidl(buildItemMetadata(item))[0];
    expect(again.title).toBe(item.title);
    expect(again.res?.uri).toBe(item.res?.uri);
    expect(again.id).toBe(item.id);
  });
});

describe('interfaces', () => {
  const mk = (address: string, internal = false) =>
    [{ address, netmask: '255.255.255.0', family: 'IPv4', internal, mac: '', cidr: null }] as never;
  const ifs = listCandidateInterfaces({
    lo: mk('127.0.0.1', true),
    docker0: mk('172.17.0.1'),
    'br-abc': mk('172.18.0.1'),
    virbr0: mk('192.168.122.1'),
    wlan0: mk('192.168.178.31'),
    eth0: mk('10.0.0.5'),
  });
  it('skips loopback/virtual interfaces', () =>
    expect(ifs.map((i) => i.name)).toEqual(['wlan0', 'eth0']));
  it('matches an IP to its interface by subnet', () => {
    expect(interfaceFor('192.168.178.32', ifs)?.name).toBe('wlan0');
    expect(interfaceFor('8.8.8.8', ifs)).toBeUndefined();
  });
});

describe('firstStreamUrl', () => {
  it('reads plain TuneIn answers, m3u and pls bodies', () => {
    expect(firstStreamUrl('https://s.example/listen\n')).toBe('https://s.example/listen');
    expect(firstStreamUrl('#EXTM3U\n#EXTINF:-1,x\nhttp://a/b.mp3\nhttp://c/d')).toBe(
      'http://a/b.mp3',
    );
    expect(firstStreamUrl('[playlist]\nFile1=http://a/b\nTitle1=x')).toBe('http://a/b');
    expect(firstStreamUrl('nothing here')).toBeUndefined();
  });
});
