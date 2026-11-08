import { EventEmitter } from 'node:events';
import type { DevicesSnapshot, InterfaceInfo, RaumfeldDevice, Target } from '@shared/types.ts';
import { parseDescription, shortServiceName, validLocation } from '../upnp/description';
import { listCandidateInterfaces, sameInterfaceSet } from '../upnp/interfaces';
import { Ssdp, type SsdpMessage } from '../upnp/ssdp';
import { classify } from './classify';

const RESCAN_MS = 60_000;
const IFACE_POLL_MS = 10_000;
const SEARCH_WINDOW_MS = 6_000;
const STALE_MS = 10 * 60_000;
/** Unplugged speakers send no byebye, so known devices are probed actively. */
const HEALTH_MS = 5_000;
const HEALTH_TIMEOUT_MS = 2_500;
const HEALTH_MAX_FAILURES = 2;
/** After losing a device, search fast (a rebooted speaker may come back on a new IP/port). */
const RECONNECT_SEARCH_MS = 4_000;
const RECONNECT_WINDOW_MS = 3 * 60_000;

function udnFromUsn(usn?: string): string | undefined {
  const m = /^uuid:([^:]+)/i.exec(usn ?? '');
  return m?.[1];
}

/**
 * Finds Raumfeld devices: SSDP (per interface) -> fetch each distinct LOCATION once ->
 * classify by description. Emits 'changed' whenever the device list changes.
 */
export class Discovery extends EventEmitter {
  private ssdp = new Ssdp();
  private devices = new Map<string, RaumfeldDevice & { lastSeen: number }>(); // by UDN
  /** LOCATION -> UDN (positive) or null (negative: not ours / failed). */
  private locations = new Map<string, string | null>();
  private inflight = new Set<string>();
  private ifaces: InterfaceInfo[] = [];
  private wanted = 'auto';
  private searching = false;
  private timers: NodeJS.Timeout[] = [];
  private searchEnd?: NodeJS.Timeout;
  private started = false;
  private failures = new Map<string, number>(); // UDN -> consecutive failed health probes
  private checking = false;
  private reconnectUntil = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor() {
    super();
    this.ssdp.on('message', (m: SsdpMessage) => void this.onMessage(m));
    this.ssdp.on('error', (e: Error) => this.emit('log', e.message));
  }

  async start(networkInterface = 'auto'): Promise<void> {
    this.wanted = networkInterface;
    this.started = true;
    await this.restartSockets();
    this.timers.push(setInterval(() => this.rescan(), RESCAN_MS));
    this.timers.push(setInterval(() => void this.checkInterfaces(), IFACE_POLL_MS));
    this.timers.push(setInterval(() => void this.checkHealth(), HEALTH_MS));
  }

  stop(): void {
    this.started = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    clearInterval(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ssdp.stop();
  }

  async setNetworkInterface(name: string): Promise<void> {
    this.wanted = name;
    await this.restartSockets();
  }

  private pickInterfaces(): InterfaceInfo[] {
    const all = listCandidateInterfaces();
    return this.wanted === 'auto' ? all : all.filter((i) => i.name === this.wanted);
  }

  private async restartSockets() {
    this.ifaces = this.pickInterfaces();
    await this.ssdp.start(this.ifaces);
    this.rescan();
  }

  private async checkInterfaces() {
    if (!this.started) return;
    const now = this.pickInterfaces();
    if (!sameInterfaceSet(now, this.ifaces)) await this.restartSockets();
  }

  rescan(): void {
    this.searching = true;
    this.emitChanged();
    this.ssdp.search();
    // second burst helps with lossy wifi multicast
    setTimeout(() => this.started && this.ssdp.search(), 1000);
    clearTimeout(this.searchEnd);
    this.searchEnd = setTimeout(() => {
      this.searching = false;
      this.prune();
      this.emitChanged();
    }, SEARCH_WINDOW_MS);
  }

  /** Manual fallback: an IP (unicast M-SEARCH) or a full description URL. */
  async addManual(input: string): Promise<{ ok: boolean; error?: string }> {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, error: 'Empty address' };
    const before = this.devices.size;
    if (/^https?:\/\//i.test(trimmed)) {
      const url = validLocation(trimmed);
      if (!url) return { ok: false, error: 'Not a valid URL' };
      await this.fetchLocation(url.toString(), undefined);
    } else {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed))
        return { ok: false, error: 'Enter an IPv4 address or a description URL' };
      this.ssdp.searchUnicast(trimmed);
      this.ssdp.searchUnicast(trimmed);
      await new Promise((r) => setTimeout(r, 3500));
    }
    const found = [...this.devices.values()].some((d) => d.role === 'renderer');
    if (this.devices.size > before || found) return { ok: true };
    return {
      ok: false,
      error:
        'No Raumfeld device answered. Check the address, or paste the full device description URL (http://ip:port/uuid.xml).',
    };
  }

  private async onMessage(m: SsdpMessage) {
    const udn = udnFromUsn(m.usn);
    if (m.kind === 'byebye') {
      if (udn && this.devices.has(udn)) {
        this.forget(udn);
        this.emitChanged();
      }
      return;
    }
    const url = validLocation(m.location);
    if (!url) return; // malformed (e.g. bare IP) -> drop
    const loc = url.toString();
    if (this.locations.has(loc)) {
      const known = this.locations.get(loc);
      const dev = known ? this.devices.get(known) : undefined;
      if (dev) dev.lastSeen = Date.now();
      return;
    }
    await this.fetchLocation(loc, m.iface?.name);
  }

  private async fetchLocation(loc: string, ifaceName: string | undefined) {
    if (this.inflight.has(loc)) return;
    this.inflight.add(loc);
    try {
      const res = await fetch(loc, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const desc = parseDescription(await res.text(), loc);
      const role = desc ? classify(desc) : null;
      if (!desc || !role) {
        this.locations.set(loc, null);
        return;
      }
      const host = new URL(loc).hostname;
      const services: RaumfeldDevice['services'] = {};
      for (const s of desc.services) {
        services[shortServiceName(s.serviceType)] = {
          serviceType: s.serviceType,
          controlUrl: s.controlUrl,
          eventSubUrl: s.eventSubUrl,
          scpdUrl: s.scpdUrl,
        };
      }
      const old = this.devices.get(desc.udn);
      if (old) this.locations.set(old.location, null); // superseded (port changed after reboot)
      this.locations.set(loc, desc.udn);
      this.failures.delete(desc.udn);
      this.devices.set(desc.udn, {
        udn: desc.udn,
        role,
        friendlyName: desc.friendlyName,
        modelName: desc.modelName,
        virtual: /virtual/i.test(desc.modelDescription),
        host,
        location: loc,
        iface: ifaceName ?? old?.iface ?? '',
        services,
        lastSeen: Date.now(),
      });
      this.emitChanged();
    } catch {
      // Don't cache failures forever: allow a retry on the next announcement.
    } finally {
      this.inflight.delete(loc);
    }
  }

  private prune() {
    const cutoff = Date.now() - STALE_MS;
    for (const [udn, d] of this.devices) {
      if (d.lastSeen < cutoff) this.forget(udn);
    }
  }

  /**
   * Drop a device AND every cached LOCATION that pointed at it. Keeping the location would make a
   * later announcement from the same URL look "already known" and be ignored forever.
   */
  private forget(udn: string): void {
    this.devices.delete(udn);
    this.failures.delete(udn);
    for (const [loc, u] of this.locations) if (u === udn) this.locations.delete(loc);
  }

  /**
   * Probe every known device's description URL. Devices failing twice in a row are dropped (the
   * selection then moves on, see ipc.ts) and a fast search starts to catch them coming back,
   * possibly under a new IP/port. Safe to call at any time (e.g. after a failed SOAP call).
   */
  async checkHealth(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const probes = [...this.devices.values()].map(async (d) => {
        try {
          const res = await fetch(d.location, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
          await res.arrayBuffer();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.failures.delete(d.udn);
          d.lastSeen = Date.now();
          return false;
        } catch {
          const n = (this.failures.get(d.udn) ?? 0) + 1;
          this.failures.set(d.udn, n);
          if (n < HEALTH_MAX_FAILURES) return false;
          this.emit('log', `Lost ${d.friendlyName} (${d.host}); searching for it again`);
          this.forget(d.udn);
          return true;
        }
      });
      const dropped = (await Promise.all(probes)).some(Boolean);
      if (dropped) {
        this.startReconnectSearch();
        this.emitChanged();
      }
    } finally {
      this.checking = false;
    }
  }

  private startReconnectSearch(): void {
    this.reconnectUntil = Date.now() + RECONNECT_WINDOW_MS;
    if (this.reconnectTimer || !this.started) return;
    this.ssdp.search();
    this.reconnectTimer = setInterval(() => {
      if (!this.started || Date.now() > this.reconnectUntil) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = undefined;
        return;
      }
      this.ssdp.search();
    }, RECONNECT_SEARCH_MS);
  }

  getDevice(udn: string): RaumfeldDevice | undefined {
    return this.devices.get(udn);
  }

  /** The MediaServer on the same host as the given device (falls back to any). */
  mediaServerFor(udn: string): RaumfeldDevice | undefined {
    const host = this.devices.get(udn)?.host;
    const servers = [...this.devices.values()].filter((d) => d.role === 'mediaserver');
    return servers.find((s) => s.host === host) ?? servers[0];
  }

  /**
   * The zone (virtual renderer) that plays for the given renderer: itself if it is one, else the
   * only zone on the same host. A single-room system has exactly one zone, once the host has made it.
   */
  zoneFor(udn: string): RaumfeldDevice | undefined {
    const dev = this.devices.get(udn);
    if (!dev) return undefined;
    if (dev.virtual) return dev;
    const zones = this.zonesOn(dev.host);
    return zones.length === 1 ? zones[0] : undefined;
  }

  /** Number of zones on the same host as the device (0 = none, e.g. during Bluetooth use). */
  zoneCount(udn: string): number {
    const dev = this.devices.get(udn);
    return dev ? this.zonesOn(dev.host).length : 0;
  }

  private zonesOn(host: string): RaumfeldDevice[] {
    return [...this.devices.values()].filter(
      (d) => d.role === 'renderer' && d.virtual && d.host === host,
    );
  }

  targets(): Target[] {
    return (
      [...this.devices.values()]
        .filter((d) => d.role === 'renderer')
        // Where a host has zones, hide its bare room renderers: they cannot play favorites and
        // report no media; the zone renderer is the one that reflects what is actually playing.
        .filter((d) => d.virtual || this.zonesOn(d.host).length === 0)
        .map((d) => ({
          udn: d.udn,
          name: d.friendlyName,
          modelName: d.modelName,
          host: d.host,
          iface: d.iface,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  snapshot(selected: string | null): DevicesSnapshot {
    return {
      targets: this.targets(),
      hasMediaServer: [...this.devices.values()].some((d) => d.role === 'mediaserver'),
      searching: this.searching,
      interfacesTried: this.ifaces,
      selected,
    };
  }

  private emitChanged() {
    this.emit('changed');
  }
}
