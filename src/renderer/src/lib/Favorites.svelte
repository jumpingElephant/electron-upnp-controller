<script lang="ts">
  import type { Favorite, FavoriteSource } from '@shared/types';

  let { target, onerror }: { target: string; onerror: (m: string) => void } = $props();

  let sources = $state<FavoriteSource[]>([]);
  let source = $state('0/Favorites/MyFavorites');
  let items = $state<Favorite[]>([]);
  let loading = $state(false);
  let error = $state('');
  let playing = $state<string | null>(null);

  $effect(() => {
    void window.raumfeld.favoriteSources().then((s) => (sources = s));
  });

  $effect(() => {
    // reload when target or source changes
    void load(target, source);
  });

  async function load(_t: string, src: string) {
    loading = true;
    error = '';
    const r = await window.raumfeld.listFavorites(src);
    loading = false;
    if (r.ok) items = r.value;
    else {
      items = [];
      error = r.error;
    }
  }

  async function play(f: Favorite) {
    playing = f.id;
    const r = await window.raumfeld.playFavorite(f.id);
    playing = null;
    if (!r.ok) onerror(r.error);
  }
</script>

<section>
  <div class="head">
    <h2>Favorites</h2>
    <select bind:value={source} aria-label="Favorites list">
      {#each sources as s (s.id)}<option value={s.id}>{s.title}</option>{/each}
    </select>
  </div>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else if items.length === 0}
    <p class="muted">Nothing here yet. Add favorites in the Teufel Raumfeld app.</p>
  {:else}
    <div class="grid">
      {#each items as f (f.id)}
        <button class="tile" class:busy={playing === f.id} onclick={() => play(f)} title={f.title}>
          {#if f.albumArt}<img
              src={f.albumArt}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />{:else}<div class="ph">♪</div>{/if}
          <span>{f.title}</span>
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .head h2 {
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    text-align: left;
  }
  .tile.busy {
    opacity: 0.5;
  }
  img,
  .ph {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 6px;
    background: var(--border);
  }
  .ph {
    display: grid;
    place-items: center;
    font-size: 28px;
    color: var(--muted);
  }
  span {
    font-size: 12px;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
