<script lang="ts">
  import type { PlaybackState } from '@shared/types';

  let { playback, onerror }: { playback: PlaybackState | null; onerror: (m: string) => void } =
    $props();

  let local = $state(0);
  let dragging = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = Date.now();

  // Follow the device unless the user is interacting.
  $effect(() => {
    if (playback?.volume != null && !dragging && Date.now() - lastSent > 1500)
      local = playback.volume;
  });

  async function send(v: number) {
    lastSent = Date.now();
    const r = await window.raumfeld.setVolume(v);
    if (!r.ok) onerror(r.error);
  }

  // ~100ms trailing throttle so a drag doesn't flood the speaker with SOAP calls.
  function onInput(e: Event) {
    local = Number((e.currentTarget as HTMLInputElement).value);
    dragging = true;
    lastSent = Date.now();
    clearTimeout(timer);
    timer = setTimeout(() => void send(local), 100);
  }

  function onChange() {
    clearTimeout(timer);
    dragging = false;
    void send(local);
  }

  async function toggleMute() {
    const r = await window.raumfeld.setMute(!playback?.mute);
    if (!r.ok) onerror(r.error);
  }
</script>

<div class="row">
  <button class={playback?.mute ? "muted" : "mute"} onclick={toggleMute} aria-pressed={playback?.mute === true} title="{playback?.mute ? 'muted' : 'Mute'}">
    {playback?.mute ? '🔇' : '🔊'}
  </button>
  <input
    type="range"
    min="0"
    max="100"
    step="1"
    value={local}
    oninput={onInput}
    onchange={onChange}
    aria-label="Volume"
    disabled={playback?.volume == null}
  />
  <span class="val">{local}</span>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  input {
    flex: 1;
    accent-color: var(--accent);
  }
  .val {
    width: 2.5em;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mute[aria-pressed='true'] {
    border-color: var(--danger);
  }
  .muted {
    background-color: var(--danger);
    opacity: 0.75;
  }
</style>
