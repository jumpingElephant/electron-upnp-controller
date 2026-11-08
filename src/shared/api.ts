import type {
  DevicesSnapshot,
  Favorite,
  FavoriteSource,
  InterfaceInfo,
  PlaybackState,
  Result,
  Settings,
} from './types';

/** The narrow API the preload exposes as window.raumfeld. */
export interface RaumfeldApi {
  getDevices(): Promise<DevicesSnapshot>;
  rescan(): Promise<void>;
  addManual(input: string): Promise<Result>;
  selectTarget(udn: string | null): Promise<void>;
  setVolume(volume: number): Promise<Result>;
  setMute(mute: boolean): Promise<Result>;
  stop(): Promise<Result>;
  playFavorite(id: string): Promise<Result>;
  listFavorites(containerId: string): Promise<Result<Favorite[]>>;
  favoriteSources(): Promise<FavoriteSource[]>;
  listInterfaces(): Promise<InterfaceInfo[]>;
  getSettings(): Promise<Settings>;
  setNetworkInterface(name: string): Promise<Settings>;
  onDevicesChanged(cb: (s: DevicesSnapshot) => void): () => void;
  onStateChanged(cb: (s: PlaybackState) => void): () => void;
}

export const CHANNELS = {
  getDevices: 'devices:get',
  rescan: 'devices:rescan',
  addManual: 'devices:add-manual',
  selectTarget: 'target:select',
  setVolume: 'control:set-volume',
  setMute: 'control:set-mute',
  stop: 'control:stop',
  playFavorite: 'control:play-favorite',
  listFavorites: 'favorites:list',
  favoriteSources: 'favorites:sources',
  listInterfaces: 'net:interfaces',
  getSettings: 'settings:get',
  setNetworkInterface: 'settings:set-interface',
  devicesChanged: 'devices-changed',
  stateChanged: 'state-changed',
} as const;
