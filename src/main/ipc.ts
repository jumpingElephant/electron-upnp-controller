import { ipcMain, type BrowserWindow } from 'electron';
import { CHANNELS } from '../shared/api';
import type { PlaybackState, Result } from '../shared/types';
import { Controller } from './raumfeld/controller';
import { Discovery } from './raumfeld/discovery';
import { FAVORITE_SOURCES } from './raumfeld/favorites';
import { SettingsStore } from './settings';
import { listCandidateInterfaces } from './upnp/interfaces';

const POLL_MS = 2000;

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function registerIpc(win: () => BrowserWindow | null) {
  const settings = new SettingsStore();
  const discovery = new Discovery();
  const controller = new Controller(discovery);
  let selected: string | null = settings.get().lastRenderer;
  /** Zone UDNs change whenever the speaker recreates its zone; the name survives. */
  let selectedName: string | null = null;
  let pollTimer: NodeJS.Timeout | undefined;
  let polling = false;

  const send = (channel: string, payload: unknown) => {
    const w = win();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  const pushDevices = () => {
    // Single device -> auto-select it; drop selection if it vanished.
    const targets = discovery.targets();
    if (!selected || !targets.some((t) => t.udn === selected)) {
      const last = settings.get().lastRenderer;
      const sameName = selectedName ? targets.find((t) => t.name === selectedName) : undefined;
      if (sameName)
        selected = sameName.udn; // same speaker came back (new zone id, new IP/port)
      else if (last && targets.some((t) => t.udn === last)) selected = last;
      else if (targets.length === 1) selected = targets[0].udn;
      else if (selected) selected = null;
    }
    selectedName = targets.find((t) => t.udn === selected)?.name ?? selectedName;
    send(CHANNELS.devicesChanged, discovery.snapshot(selected));
    schedulePoll(true);
  };
  discovery.on('changed', pushDevices);

  const pollOnce = async () => {
    if (polling || !selected) return;
    polling = true;
    let state: PlaybackState;
    try {
      state = await controller.getState(selected);
    } catch (e) {
      state = {
        transport: 'UNKNOWN',
        volume: null,
        mute: null,
        error: e instanceof Error ? e.message : String(e),
      };
      // Unreachable speaker: verify now instead of waiting for the next periodic probe.
      void discovery.checkHealth();
    } finally {
      polling = false;
    }
    send(CHANNELS.stateChanged, state);
  };

  // NOTE: state is polled (GENA event subscriptions are a possible later refinement).
  const schedulePoll = (immediate = false) => {
    if (!pollTimer) pollTimer = setInterval(() => void pollOnce(), POLL_MS);
    if (immediate) void pollOnce();
  };

  const withTarget = <T>(fn: (udn: string) => Promise<T>) =>
    wrap(async () => {
      if (!selected) throw new Error('No speaker selected');
      const r = await fn(selected);
      setTimeout(() => void pollOnce(), 300);
      return r;
    });

  ipcMain.handle(CHANNELS.getDevices, () => discovery.snapshot(selected));
  ipcMain.handle(CHANNELS.rescan, () => discovery.rescan());
  ipcMain.handle(CHANNELS.addManual, async (_e, input: unknown) => {
    if (typeof input !== 'string') return { ok: false, error: 'Invalid input' } as Result;
    const r = await discovery.addManual(input);
    return r.ok
      ? ({ ok: true, value: undefined } as Result)
      : ({ ok: false, error: r.error ?? 'Failed' } as Result);
  });
  ipcMain.handle(CHANNELS.selectTarget, (_e, udn: unknown) => {
    selected = typeof udn === 'string' ? udn : null;
    selectedName = discovery.targets().find((t) => t.udn === selected)?.name ?? null;
    settings.set({ lastRenderer: selected });
    send(CHANNELS.devicesChanged, discovery.snapshot(selected));
    void pollOnce();
  });
  ipcMain.handle(CHANNELS.setVolume, (_e, v: unknown) =>
    withTarget((udn) => controller.setVolume(udn, Number(v))),
  );
  ipcMain.handle(CHANNELS.setMute, (_e, m: unknown) =>
    withTarget((udn) => controller.setMute(udn, Boolean(m))),
  );
  ipcMain.handle(CHANNELS.stop, () => withTarget((udn) => controller.stop(udn)));
  ipcMain.handle(CHANNELS.playFavorite, (_e, id: unknown) =>
    withTarget((udn) => {
      if (typeof id !== 'string') throw new Error('Invalid favorite');
      return controller.playFavorite(udn, id);
    }),
  );
  ipcMain.handle(CHANNELS.listFavorites, (_e, id: unknown) =>
    withTarget((udn) => {
      if (typeof id !== 'string' || !FAVORITE_SOURCES.some((s) => s.id === id))
        throw new Error('Unknown favorites source');
      return controller.listFavorites(udn, id);
    }),
  );
  ipcMain.handle(CHANNELS.favoriteSources, () => FAVORITE_SOURCES);
  ipcMain.handle(CHANNELS.listInterfaces, () => listCandidateInterfaces());
  ipcMain.handle(CHANNELS.getSettings, () => settings.get());
  ipcMain.handle(CHANNELS.setNetworkInterface, async (_e, name: unknown) => {
    const n = typeof name === 'string' ? name : 'auto';
    const s = settings.set({ networkInterface: n });
    await discovery.setNetworkInterface(n);
    return s;
  });

  void discovery.start(settings.get().networkInterface);

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    discovery.stop();
  };
}
