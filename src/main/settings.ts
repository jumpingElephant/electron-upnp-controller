import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Settings } from '../shared/types';

const DEFAULTS: Settings = { networkInterface: 'auto', lastRenderer: null, manualHosts: [] };

export class SettingsStore {
  private file = join(app.getPath('userData'), 'settings.json');
  private data: Settings = { ...DEFAULTS };

  constructor() {
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(readFileSync(this.file, 'utf8')) };
    } catch {
      /* first run or corrupt file -> defaults */
    }
  }

  get(): Settings {
    return { ...this.data };
  }

  set(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch {
      /* non-fatal */
    }
    return this.get();
  }
}
