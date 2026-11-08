import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import type { InterfaceInfo } from '../../shared/types';
import { interfaceFor } from './interfaces';

const MCAST = '239.255.255.250';
const PORT = 1900;

export interface SsdpMessage {
  kind: 'response' | 'alive' | 'byebye';
  location?: string;
  usn?: string;
  /** NT (notify) or ST (search response). */
  type?: string;
  maxAge?: number;
  /** Source IP of the datagram. */
  from: string;
  /** Interface the datagram arrived on (best match by subnet). */
  iface?: InterfaceInfo;
}

export function parseSsdp(raw: string, from: string): Omit<SsdpMessage, 'iface'> | null {
  const lines = raw.split(/\r?\n/);
  const first = (lines.shift() ?? '').trim().toUpperCase();
  let kind: SsdpMessage['kind'];
  const headers: Record<string, string> = {};
  for (const l of lines) {
    const i = l.indexOf(':');
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  if (first.startsWith('HTTP/1.1 200')) kind = 'response';
  else if (first.startsWith('NOTIFY')) {
    const nts = (headers['nts'] ?? '').toLowerCase();
    if (nts === 'ssdp:alive') kind = 'alive';
    else if (nts === 'ssdp:byebye') kind = 'byebye';
    else return null;
  } else return null; // includes M-SEARCH from other control points
  const ma = /max-age\s*=\s*(\d+)/i.exec(headers['cache-control'] ?? '');
  return {
    kind,
    location: headers['location'],
    usn: headers['usn'],
    type: headers['nt'] ?? headers['st'],
    maxAge: ma ? Number(ma[1]) : undefined,
    from,
  };
}

export function buildMSearch(st: string, mx = 2): Buffer {
  return Buffer.from(
    'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${MCAST}:${PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      `MX: ${mx}\r\n` +
      `ST: ${st}\r\n` +
      'USER-AGENT: raumfeld-controller/0.1 UPnP/1.1\r\n\r\n',
  );
}

export const SEARCH_TARGETS = [
  'ssdp:all',
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:device:MediaServer:1',
  'urn:schemas-raumfeld-com:device:ConfigDevice:1',
];

interface Sock {
  iface: InterfaceInfo;
  sock: dgram.Socket;
}

/**
 * SSDP with one search socket per interface plus one shared NOTIFY listener on :1900.
 * Emits 'message' (SsdpMessage) and 'error' (non-fatal, informational).
 */
export class Ssdp extends EventEmitter {
  private searchSocks: Sock[] = [];
  private listener?: dgram.Socket;
  private ifaces: InterfaceInfo[] = [];

  async start(ifaces: InterfaceInfo[]): Promise<void> {
    this.stop();
    this.ifaces = ifaces;
    await Promise.all(ifaces.map((i) => this.openSearchSocket(i)));
    await this.openListener(ifaces);
  }

  stop(): void {
    for (const s of this.searchSocks) this.safeClose(s.sock);
    this.searchSocks = [];
    if (this.listener) this.safeClose(this.listener);
    this.listener = undefined;
  }

  /** Multicast M-SEARCH on every interface. */
  search(): void {
    for (const { sock, iface } of this.searchSocks) {
      for (const st of SEARCH_TARGETS) {
        sock.send(buildMSearch(st), PORT, MCAST, (err) => {
          if (err) this.emit('error', new Error(`M-SEARCH on ${iface.name}: ${err.message}`));
        });
      }
    }
  }

  /** Unicast M-SEARCH to a specific host (manual IP fallback). */
  searchUnicast(host: string): void {
    const iface = interfaceFor(host, this.ifaces);
    const target = this.searchSocks.find((s) => s.iface === iface) ?? this.searchSocks[0];
    if (!target) return;
    for (const st of SEARCH_TARGETS) target.sock.send(buildMSearch(st), PORT, host);
  }

  private safeClose(s: dgram.Socket) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }

  private handle(buf: Buffer, from: string) {
    const m = parseSsdp(buf.toString('utf8'), from);
    if (!m) return;
    this.emit('message', { ...m, iface: interfaceFor(from, this.ifaces) } satisfies SsdpMessage);
  }

  private openSearchSocket(iface: InterfaceInfo): Promise<void> {
    return new Promise((resolve) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (e) => {
        this.emit('error', new Error(`SSDP socket on ${iface.name}: ${e.message}`));
        this.safeClose(sock);
        resolve();
      });
      sock.on('message', (buf, rinfo) => this.handle(buf, rinfo.address));
      sock.bind(0, iface.address, () => {
        try {
          sock.setMulticastInterface(iface.address);
          sock.setMulticastTTL(4);
          this.searchSocks.push({ iface, sock });
        } catch (e) {
          this.emit('error', e as Error);
        }
        resolve();
      });
    });
  }

  private openListener(ifaces: InterfaceInfo[]): Promise<void> {
    return new Promise((resolve) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', (e) => {
        // Port 1900 may be taken exclusively (e.g. another UPnP stack); search still works.
        this.emit('error', new Error(`SSDP NOTIFY listener unavailable: ${e.message}`));
        this.safeClose(sock);
        resolve();
      });
      sock.on('message', (buf, rinfo) => this.handle(buf, rinfo.address));
      sock.bind(PORT, '0.0.0.0', () => {
        for (const i of ifaces) {
          try {
            sock.addMembership(MCAST, i.address);
          } catch (e) {
            this.emit('error', new Error(`join multicast on ${i.name}: ${(e as Error).message}`));
          }
        }
        this.listener = sock;
        resolve();
      });
    });
  }
}
