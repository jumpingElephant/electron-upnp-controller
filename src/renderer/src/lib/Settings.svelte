<script lang="ts">
  import type { DevicesSnapshot, InterfaceInfo } from '@shared/types';

  let { snap, onclose }: { snap: DevicesSnapshot | null; onclose: () => void } = $props();

  let ifaces = $state<InterfaceInfo[]>([]);
  let current = $state('auto');

  $effect(() => {
    void window.raumfeld.listInterfaces().then((i) => (ifaces = i));
    void window.raumfeld.getSettings().then((s) => (current = s.networkInterface));
  });

  async function change(e: Event) {
    current = (e.currentTarget as HTMLSelectElement).value;
    await window.raumfeld.setNetworkInterface(current);
  }
</script>

<section class="panel">
  <h2>Network</h2>
  <select value={current} onchange={change} aria-label="Network interface">
    <option value="auto">Auto (all interfaces)</option>
    {#each ifaces as i (i.name + i.address)}<option value={i.name}>{i.name} — {i.address}</option
      >{/each}
  </select>
  <p class="muted small">
    Searching on: {snap?.interfacesTried.map((i) => i.name).join(', ') || 'nothing'}. If nothing is
    found, allow UDP 1900 (SSDP) and UDP replies in your firewall.
  </p>
  <button onclick={onclose}>Close</button>
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  select {
    width: 100%;
  }
  .small {
    font-size: 12px;
    margin: 0;
  }
</style>
