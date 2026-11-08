<script lang="ts">
  import { onMount } from 'svelte';
  import type { DevicesSnapshot, PlaybackState } from '@shared/types';
  import DeviceSelector from './lib/DeviceSelector.svelte';
  import VolumeControl from './lib/VolumeControl.svelte';
  import Favorites from './lib/Favorites.svelte';
  import NowPlaying from './lib/NowPlaying.svelte';
  import Settings from './lib/Settings.svelte';

  let snap = $state<DevicesSnapshot | null>(null);
  let playback = $state<PlaybackState | null>(null);
  let toast = $state('');
  let toastTimer: ReturnType<typeof setTimeout>;
  let showSettings = $state(false);

  function notify(msg: string) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 4000);
  }

  onMount(() => {
    const offDevices = window.raumfeld.onDevicesChanged((s) => {
      if (snap?.selected !== s.selected) playback = null;
      snap = s;
    });
    const offState = window.raumfeld.onStateChanged((s) => (playback = s));
    void window.raumfeld.getDevices().then((s) => (snap = s));
    return () => {
      offDevices();
      offState();
    };
  });

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    const r = await p;
    if (!r.ok) notify(r.error ?? 'Something went wrong');
  }
</script>

<main>
  <header>
    <h1>Raumfeld</h1>
    <button
      class="icon"
      title="Settings"
      aria-label="Settings"
      onclick={() => (showSettings = !showSettings)}>⚙</button
    >
  </header>

  {#if showSettings}
    <Settings {snap} onclose={() => (showSettings = false)} />
  {/if}

  {#if !snap || (snap.targets.length === 0 && snap.searching)}
    <section class="center">
      <div class="spinner" aria-hidden="true"></div>
      <p>Searching for Raumfeld devices…</p>
    </section>
  {:else if snap.targets.length === 0}
    <section class="center">
      <p><strong>No Raumfeld speaker found.</strong></p>
      <p class="muted">
        Looked on: {snap.interfacesTried.map((i) => `${i.name} (${i.address})`).join(', ') ||
          'no usable network interface'}. Make sure the speaker is on the same network. A firewall
        may block UDP 1900 (SSDP) and the replies on ephemeral UDP ports.
      </p>
      <button onclick={() => window.raumfeld.rescan()}>Search again</button>
    </section>
    <DeviceSelector {snap} manualOnly />
  {:else}
    <DeviceSelector {snap} />
    {#if snap.selected}
      <section class="controls">
        <button
          class="stop"
          onclick={() => run(window.raumfeld.stop())}
          disabled={playback?.transport === 'STOPPED' || playback?.transport === 'NO_MEDIA_PRESENT'}
        >
          ■ Stop
        </button>
        <VolumeControl {playback} onerror={notify} />
      </section>
      <Favorites target={snap.selected} onerror={notify} />
      <NowPlaying {playback} />
    {:else}
      <p class="muted center">Choose a speaker above.</p>
    {/if}
  {/if}

  {#if toast}<div class="toast" role="alert">{toast}</div>{/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    padding: 14px;
    overflow-y: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h1 {
    font-size: 18px;
    margin: 0;
  }
  .icon {
    padding: 2px 9px;
    font-size: 16px;
  }
  .center {
    text-align: center;
    padding: 20px 0;
  }
  .controls {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .stop {
    background: var(--accent);
    color: #fff;
    border: none;
    font-size: 18px;
    padding: 14px;
    border-radius: 12px;
    font-weight: 600;
  }
  .stop:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .toast {
    position: fixed;
    bottom: 14px;
    left: 14px;
    right: 14px;
    background: var(--danger);
    color: #fff;
    padding: 10px 14px;
    border-radius: 10px;
  }
  .spinner {
    width: 32px;
    height: 32px;
    margin: 0 auto 12px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
