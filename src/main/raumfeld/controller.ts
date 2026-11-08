import type { PlaybackState, RaumfeldDevice } from '../../shared/types';
import { parseDidl } from '../upnp/didl';
import { callSoap } from '../upnp/soap';
import type { Discovery } from './discovery';
import { listFavorites, resolveDirectStream, resolvePlayable } from './favorites';

const RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
const AVT = 'urn:schemas-upnp-org:service:AVTransport:1';

/** High-level control of one renderer. Resolves the device lazily so port changes are picked up. */
export class Controller {
  constructor(private discovery: Discovery) {}

  private renderer(udn: string): RaumfeldDevice {
    const d = this.discovery.getDevice(udn);
    if (!d || d.role !== 'renderer') throw new Error('Speaker not found (it may be offline)');
    return d;
  }

  private rc(udn: string) {
    const s = this.renderer(udn).services['RenderingControl'];
    if (!s) throw new Error('Speaker has no RenderingControl');
    return s;
  }

  private avt(udn: string) {
    const s = this.renderer(udn).services['AVTransport'];
    if (!s) throw new Error('Speaker has no AVTransport');
    return s;
  }

  async setVolume(udn: string, volume: number): Promise<void> {
    const v = Math.max(0, Math.min(100, Math.round(volume)));
    const s = this.rc(udn);
    await callSoap(s.controlUrl, s.serviceType || RC, 'SetVolume', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredVolume: v,
    });
  }

  async setMute(udn: string, mute: boolean): Promise<void> {
    const s = this.rc(udn);
    await callSoap(s.controlUrl, s.serviceType || RC, 'SetMute', {
      InstanceID: 0,
      Channel: 'Master',
      DesiredMute: mute ? 1 : 0,
    });
  }

  async stop(udn: string): Promise<void> {
    const s = this.avt(udn);
    await callSoap(s.controlUrl, s.serviceType || AVT, 'Stop', { InstanceID: 0 });
  }

  async playFavorite(udn: string, favoriteId: string): Promise<void> {
    const server = this.discovery.mediaServerFor(udn);
    if (!server) throw new Error('No Raumfeld media server found');
    // Preferred: ask a zone (virtual renderer) to play the object, like the app/hardware buttons do.
    const zone = this.discovery.zoneFor(udn);
    if (zone) {
      const { uri, metadata } = await resolvePlayable(server, favoriteId);
      return this.start(zone, uri, metadata);
    }
    if (this.discovery.zoneCount(udn) > 1) {
      throw new Error('Several zones exist; select the zone you want to play on.');
    }
    // No zone (the speaker drops it while a Bluetooth client is connected, and nothing over UPnP
    // can recreate it): play the favorite's plain stream URL on the room renderer instead.
    const { uri, metadata } = await resolveDirectStream(server, favoriteId);
    return this.start(this.renderer(udn), uri, metadata);
  }

  /** SetAVTransportURI + Play on a renderer's AVTransport, then check the speaker didn't give up. */
  private async start(renderer: RaumfeldDevice, uri: string, metadata: string): Promise<void> {
    const s = renderer.services['AVTransport'];
    if (!s) throw new Error('Speaker has no AVTransport');
    const type = s.serviceType || AVT;
    await callSoap(s.controlUrl, type, 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: uri,
      CurrentURIMetaData: metadata,
    });
    await callSoap(s.controlUrl, type, 'Play', { InstanceID: 0, Speed: 1 });
    // Play is accepted before the stream is tried; surface a failure if the speaker gives up.
    await new Promise((r) => setTimeout(r, 2000));
    const t = await callSoap(s.controlUrl, type, 'GetTransportInfo', { InstanceID: 0 });
    const status = t['CurrentTransportStatus'];
    if (status && status !== 'OK') {
      throw new Error(`The speaker could not play this favorite: ${status}`);
    }
  }

  async listFavorites(udn: string, containerId: string) {
    const server = this.discovery.mediaServerFor(udn);
    if (!server) throw new Error('No Raumfeld media server found');
    return listFavorites(server, containerId);
  }

  async getState(udn: string): Promise<PlaybackState> {
    const rc = this.rc(udn);
    const avt = this.avt(udn);
    const [vol, mute, transport, media, pos] = await Promise.allSettled([
      callSoap(rc.controlUrl, rc.serviceType || RC, 'GetVolume', {
        InstanceID: 0,
        Channel: 'Master',
      }),
      callSoap(rc.controlUrl, rc.serviceType || RC, 'GetMute', {
        InstanceID: 0,
        Channel: 'Master',
      }),
      callSoap(avt.controlUrl, avt.serviceType || AVT, 'GetTransportInfo', { InstanceID: 0 }),
      callSoap(avt.controlUrl, avt.serviceType || AVT, 'GetMediaInfo', { InstanceID: 0 }),
      callSoap(avt.controlUrl, avt.serviceType || AVT, 'GetPositionInfo', { InstanceID: 0 }),
    ]);
    if (transport.status === 'rejected' && vol.status === 'rejected') {
      throw transport.reason;
    }
    const state: PlaybackState = {
      transport:
        transport.status === 'fulfilled'
          ? (transport.value['CurrentTransportState'] ?? 'UNKNOWN')
          : 'UNKNOWN',
      status:
        transport.status === 'fulfilled' ? transport.value['CurrentTransportStatus'] : undefined,
      volume: vol.status === 'fulfilled' ? Number(vol.value['CurrentVolume']) : null,
      mute: mute.status === 'fulfilled' ? mute.value['CurrentMute'] === '1' : null,
    };
    // A zone's CurrentURI metadata is just its "Track List" queue; the playing item is in TrackMetaData.
    const metas = [
      pos.status === 'fulfilled' ? pos.value['TrackMetaData'] : undefined,
      media.status === 'fulfilled' ? media.value['CurrentURIMetaData'] : undefined,
    ];
    for (const m of metas) {
      const [item] = parseDidl(m ?? '');
      if (item) {
        state.title = item.title || undefined;
        state.artist = item.artist;
        state.albumArt = item.albumArt;
        break;
      }
    }
    return state;
  }
}
