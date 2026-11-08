import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/api';
import type { RaumfeldApi } from '../shared/api';

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<T>(channel: string, cb: (v: T) => void) {
  const handler = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: RaumfeldApi = {
  getDevices: () => invoke(CHANNELS.getDevices),
  rescan: () => invoke(CHANNELS.rescan),
  addManual: (input) => invoke(CHANNELS.addManual, input),
  selectTarget: (udn) => invoke(CHANNELS.selectTarget, udn),
  setVolume: (v) => invoke(CHANNELS.setVolume, v),
  setMute: (m) => invoke(CHANNELS.setMute, m),
  stop: () => invoke(CHANNELS.stop),
  playFavorite: (id) => invoke(CHANNELS.playFavorite, id),
  listFavorites: (id) => invoke(CHANNELS.listFavorites, id),
  favoriteSources: () => invoke(CHANNELS.favoriteSources),
  listInterfaces: () => invoke(CHANNELS.listInterfaces),
  getSettings: () => invoke(CHANNELS.getSettings),
  setNetworkInterface: (n) => invoke(CHANNELS.setNetworkInterface, n),
  onDevicesChanged: (cb) => subscribe(CHANNELS.devicesChanged, cb),
  onStateChanged: (cb) => subscribe(CHANNELS.stateChanged, cb),
};

contextBridge.exposeInMainWorld('raumfeld', api);
