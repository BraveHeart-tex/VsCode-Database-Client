<script lang="ts">
  import type { QueryResult } from 'shared';
  import { setContext } from 'svelte';
  import { onMount } from 'svelte';
  import ConnectionForm from './components/ConnectionForm.svelte';
  import QueryView from './components/QueryView.svelte';
  import { BRIDGE_CONTEXT_KEY, getWebviewBridge } from './lib/bridge';

  type View = 'connections' | 'query';

  const bridge = getWebviewBridge();
  setContext(BRIDGE_CONTEXT_KEY, bridge);

  let view = $state<View>('connections');
  let queryResult = $state<QueryResult | null>(null);
  let queryErrorMessage = $state<string | null>(null);
  let isQueryRunning = $state(false);

  const tabs: { id: View; label: string }[] = [
    { id: 'connections', label: 'Connections' },
    { id: 'query', label: 'Query' },
  ];

  onMount(() => {
    const offQueryRunning = bridge.on('QUERY_RUNNING', () => {
      isQueryRunning = true;
      queryErrorMessage = null;
      view = 'query';
    });
    const offQueryResult = bridge.on('QUERY_RESULT', (result) => {
      queryResult = result;
      queryErrorMessage = null;
      isQueryRunning = false;
      view = 'query';
    });
    const offQueryError = bridge.on('QUERY_ERROR', ({ message }) => {
      queryErrorMessage = message;
      isQueryRunning = false;
      view = 'query';
    });

    bridge.send({ type: 'WEBVIEW_READY', payload: {} });

    return () => {
      offQueryRunning();
      offQueryResult();
      offQueryError();
    };
  });
</script>

<main class="app-shell">
  <nav class="tabs" aria-label="Main view">
    {#each tabs as tab}
      <button
        type="button"
        class:active={view === tab.id}
        aria-current={view === tab.id ? 'page' : undefined}
        onclick={() => {
          view = tab.id;
        }}
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  {#if view === 'connections'}
    <ConnectionForm />
  {:else}
    <QueryView
      loading={isQueryRunning}
      result={queryResult}
      errorMessage={queryErrorMessage}
      onOpenConnections={() => {
        view = 'connections';
      }}
    />
  {/if}
</main>

<style>
  .app-shell {
    width: min(100%, 860px);
    color: var(--vscode-foreground);
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 12px 24px 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .tabs button {
    min-height: 32px;
    padding: 6px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--vscode-tab-inactiveForeground);
    background: transparent;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .tabs button:hover {
    color: var(--vscode-tab-activeForeground);
    background: var(--vscode-toolbar-hoverBackground);
  }

  .tabs button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }

  .tabs button.active {
    color: var(--vscode-tab-activeForeground);
    background: var(--vscode-tab-activeBackground);
    border-color: var(--vscode-focusBorder);
  }

  @media (max-width: 560px) {
    .tabs {
      padding-inline: 16px;
    }
  }
</style>
