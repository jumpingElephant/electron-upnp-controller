<script lang="ts">
  import type { DevicesSnapshot } from '@shared/types';

  let { snap, manualOnly = false }: { snap: DevicesSnapshot; manualOnly?: boolean } = $props();
  let manual = $state('');
  let showManual = $state(false);
  let busy = $state(false);
  let error = $state('');

  async function add() {
    busy = true;
    error = '';
    const r = await window.raumfeld.addManual(manual);
    busy = false;
    if (!r.ok) error = r.error;
    else showManual = false;
  }
</script>

{#if !manualOnly}
  <section>
    <h2>Speaker</h2>
    <select
      value={snap.selected ?? ''}
      onchange={(e) => window.raumfeld.selectTarget(e.currentTarget.value || null)}
      aria-label="Speaker"
    >
      {#if !snap.selected}<option value="">Select…</option>{/if}
      {#each snap.targets as t (t.udn)}
        <option value={t.udn}>{t.name} — {t.modelName}</option>
      {/each}
    </select>
    {#each snap.targets.filter((t) => t.udn === snap.selected) as t (t.udn)}
      <div class="muted small">{t.host}{t.iface ? ` via ${t.iface}` : ''}</div>
    {/each}
  </section>
{/if}

<section>
  {#if !showManual && !manualOnly}
    <button class="link" onclick={() => (showManual = true)}>Enter IP manually</button>
  {:else}
    <form
      onsubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <input
        type="text"
        bind:value={manual}
        placeholder="192.168.178.32 or http://ip:port/uuid.xml"
        aria-label="Device IP or URL"
      />
      <button type="submit" disabled={busy || !manual.trim()}
        >{busy ? 'Looking…' : 'Connect'}</button
      >
    </form>
    {#if error}<div class="error small">{error}</div>{/if}
  {/if}
</section>

<style>
  select {
    width: 100%;
  }
  .small {
    font-size: 12px;
    margin-top: 4px;
  }
  form {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
  }
  .link {
    border: none;
    background: none;
    color: var(--accent);
    padding: 0;
    text-decoration: underline;
  }
</style>
