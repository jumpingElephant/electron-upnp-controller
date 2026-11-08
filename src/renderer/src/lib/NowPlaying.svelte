<script lang="ts">
  import type { PlaybackState } from '@shared/types';

  let { playback }: { playback: PlaybackState | null } = $props();

  const labels: Record<string, string> = {
    PLAYING: 'Playing',
    PAUSED_PLAYBACK: 'Paused',
    STOPPED: 'Stopped',
    TRANSITIONING: 'Loading…',
    NO_MEDIA_PRESENT: 'Idle',
  };
</script>

<footer>
  {#if playback?.error}
    <span class="error">Speaker not responding: {playback.error}</span>
  {:else if playback}
    {#if playback.albumArt}<img src={playback.albumArt} alt="" referrerpolicy="no-referrer" />{/if}
    <div class="meta">
      <strong>{playback.title ?? '—'}</strong>
      <span class="muted"
        >{labels[playback.transport] ?? playback.transport}{playback.artist
          ? ` · ${playback.artist}`
          : ''}</span
      >
    </div>
  {:else}
    <span class="muted">Connecting…</span>
  {/if}
</footer>

<style>
  footer {
    margin-top: auto;
    display: flex;
    gap: 10px;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px;
  }
  img {
    width: 40px;
    height: 40px;
    border-radius: 6px;
    object-fit: cover;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
