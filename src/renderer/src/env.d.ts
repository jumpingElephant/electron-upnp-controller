/// <reference types="vite/client" />
/// <reference types="svelte" />
import type { RaumfeldApi } from '@shared/api';

declare global {
  interface Window {
    raumfeld: RaumfeldApi;
  }
}
