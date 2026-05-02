<script lang="ts">
  import type { ConnectionConfig, ExtensionToWebviewMessage } from 'shared';
  import { getContext, onMount } from 'svelte';
  import {
    BRIDGE_CONTEXT_KEY,
    type WebviewBridge,
  } from '../lib/bridge';
  import ResultsGrid from './ResultsGrid.svelte';

  type ConnectionsListPayload = Extract<
    ExtensionToWebviewMessage,
    { type: 'CONNECTIONS_LIST' }
  >['payload'];

  const {
    activeConnectionIds,
    onOpenConnections,
  } = $props<{
    activeConnectionIds: string[];
    onOpenConnections: () => void;
  }>();

  const bridge = getContext<WebviewBridge>(BRIDGE_CONTEXT_KEY);

  let sql = $state('');
  let selectedConnectionId = $state('');
  let connections = $state<ConnectionConfig[]>([]);
  let isRunning = $state(false);
  let formError = $state<string | null>(null);

  const canRun = $derived(
    sql.trim().length > 0 && selectedConnectionId.length > 0 && !isRunning
  );

  const activeConnections = $derived(
    connections.filter((connection) => activeConnectionIds.includes(connection.id))
  );

  onMount(() => {
    const offConnections = bridge.on(
      'CONNECTIONS_LIST',
      ({ connections: nextConnections }: ConnectionsListPayload) => {
        connections = nextConnections;
      }
    );
    const offResult = bridge.on('QUERY_RESULT', () => {
      isRunning = false;
    });
    const offError = bridge.on('QUERY_ERROR', () => {
      isRunning = false;
    });

    bridge.send({ type: 'GET_CONNECTIONS', payload: {} });

    return () => {
      offConnections();
      offResult();
      offError();
    };
  });

  $effect(() => {
    if (
      activeConnections.length > 0 &&
      !activeConnections.some(({ id }) => id === selectedConnectionId)
    ) {
      selectedConnectionId = activeConnections[0].id;
    }

    if (activeConnections.length === 0) {
      selectedConnectionId = '';
      isRunning = false;
    }
  });

  function runQuery() {
    const query = sql.trim();

    if (!selectedConnectionId) {
      formError = 'Select a connection before running a query.';
      return;
    }

    if (!query) {
      formError = 'Enter SQL before running a query.';
      return;
    }

    formError = null;
    isRunning = true;
    bridge.send({
      type: 'EXECUTE_QUERY',
      payload: { sql: query, connectionId: selectedConnectionId },
    });
  }

  function handleEditorKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    if (canRun) {
      runQuery();
    }
  }
</script>

<section class="query-view" aria-labelledby="query-view-title">
  <header class="header">
    <div>
      <h1 id="query-view-title">Query</h1>
      <p>Run SQL against a saved connection.</p>
    </div>
  </header>

  {#if activeConnections.length === 0}
    <section class="empty-state" aria-labelledby="no-active-connection-title">
      <h2 id="no-active-connection-title">No active connection</h2>
      <p>Connect to a saved database before opening the query editor.</p>
      <button type="button" onclick={onOpenConnections}>Connections</button>
    </section>
  {:else}
    <div class="query-toolbar">
      <label>
        <span>Connection</span>
        <select bind:value={selectedConnectionId} disabled={isRunning}>
          {#each activeConnections as connection (connection.id)}
            <option value={connection.id}>{connection.name}</option>
          {/each}
        </select>
      </label>

      <button type="button" disabled={!canRun} onclick={runQuery}>
        {isRunning ? 'Running...' : 'Run'}
      </button>
    </div>

    <textarea
      bind:value={sql}
      disabled={isRunning}
      spellcheck="false"
      aria-label="SQL editor"
      placeholder="select * from my_table limit 100;"
      onkeydown={handleEditorKeydown}
    ></textarea>

    {#if formError}
      <p class="error" role="alert">{formError}</p>
    {/if}

    <ResultsGrid loading={isRunning} />
  {/if}
</section>

<style>
  .query-view {
    display: grid;
    gap: 14px;
    width: min(100%, 860px);
    padding: 24px;
    box-sizing: border-box;
    color: var(--vscode-foreground);
  }

  .header {
    padding-bottom: 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  h1,
  p {
    margin: 0;
  }

  h1 {
    color: var(--vscode-foreground);
    font-size: 22px;
    font-weight: 600;
    line-height: 1.25;
  }

  .header p {
    color: var(--vscode-descriptionForeground);
  }

  .query-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 12px;
  }

  .empty-state {
    display: grid;
    gap: 10px;
    justify-items: start;
    padding: 24px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background);
  }

  h2 {
    margin: 0;
    color: var(--vscode-foreground);
    font-size: 15px;
    font-weight: 600;
  }

  .empty-state p {
    color: var(--vscode-descriptionForeground);
  }

  label {
    display: grid;
    gap: 6px;
    color: var(--vscode-foreground);
    font-size: 12px;
    font-weight: 600;
  }

  select,
  textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--vscode-input-border);
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    font: inherit;
    outline: none;
  }

  select {
    min-height: 30px;
    padding: 4px 8px;
    font-size: 13px;
  }

  textarea {
    min-height: 160px;
    padding: 10px;
    resize: vertical;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: 1.5;
  }

  select:focus,
  textarea:focus {
    border-color: var(--vscode-focusBorder);
  }

  button {
    min-height: 30px;
    padding: 5px 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  button:disabled,
  select:disabled,
  textarea:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .error {
    padding: 8px 10px;
    border-left: 3px solid var(--vscode-errorForeground);
    color: var(--vscode-errorForeground);
    background: var(--vscode-inputValidation-errorBackground);
    font-size: 13px;
  }

  @media (max-width: 560px) {
    .query-view {
      padding: 16px;
    }

    .query-toolbar {
      grid-template-columns: 1fr;
    }
  }
</style>
