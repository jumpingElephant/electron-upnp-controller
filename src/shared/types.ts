/** Types shared between main, preload and renderer. Pure data only. */

export interface ServiceInfo {
  serviceType: string;
  controlUrl: string;
  eventSubUrl?: string;
  scpdUrl?: string;
}

export type DeviceRole = 'renderer' | 'mediaserver' | 'config';

export interface RaumfeldDevice {
  udn: string;
  role: DeviceRole;
  friendlyName: string;
  modelName: string;
  /** True for a zone's virtual renderer ("Virtual Media Player"); only zones can play favorites. */
  virtual: boolean;
  host: string;
  location: string;
  /** Name of the network interface this device was seen on. */
  iface: string;
  /** Keyed by short service name (e.g. "RenderingControl"). */
  services: Record<string, ServiceInfo>;
}

/** A thing the user can play on (a room renderer or, later, a virtual zone renderer). */
export interface Target {
  udn: string;
  name: string;
  modelName: string;
  host: string;
  iface: string;
}

export interface InterfaceInfo {
  name: string;
  address: string;
  netmask: string;
}

export interface DevicesSnapshot {
  targets: Target[];
  hasMediaServer: boolean;
  searching: boolean;
  interfacesTried: InterfaceInfo[];
  selected: string | null;
}

export interface PlaybackState {
  transport: string; // PLAYING | PAUSED_PLAYBACK | STOPPED | TRANSITIONING | NO_MEDIA_PRESENT
  status?: string;
  volume: number | null;
  mute: boolean | null;
  title?: string;
  artist?: string;
  albumArt?: string;
  error?: string;
}

export interface Favorite {
  id: string;
  title: string;
  albumArt?: string;
  kind: 'item' | 'container';
}

export interface FavoriteSource {
  id: string;
  title: string;
}

export interface Settings {
  /** "auto" = all candidate interfaces */
  networkInterface: string;
  lastRenderer: string | null;
  manualHosts: string[];
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
