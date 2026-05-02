<script lang="ts">
  import type { QueryResult } from 'shared';
  import ResultsGrid from './ResultsGrid.svelte';

  const {
    loading = false,
    result = null,
    errorMessage = null,
    onOpenConnections,
  } = $props<{
    loading?: boolean;
    result?: QueryResult | null;
    errorMessage?: string | null;
    onOpenConnections: () => void;
  }>();
</script>

<section class="query-view" aria-labelledby="query-view-title">
  <header class="header">
    <div>
      <h1 id="query-view-title">Query</h1>
      <p>Write SQL in native editor tabs and run it with Cmd/Ctrl+Enter.</p>
    </div>
    <button type="button" onclick={onOpenConnections}>Connections</button>
  </header>

  <section class="native-editor-note" aria-labelledby="native-editor-title">
    <h2 id="native-editor-title">Native SQL editor</h2>
    <p>
      Open a query from a saved connection in the sidebar. Results from the
      active SQL editor appear here.
    </p>
  </section>

  <ResultsGrid {loading} {result} {errorMessage} />
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
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    color: var(--vscode-foreground);
    font-size: 22px;
    font-weight: 600;
    line-height: 1.25;
  }

  h2 {
    color: var(--vscode-foreground);
    font-size: 15px;
    font-weight: 600;
  }

  p {
    color: var(--vscode-descriptionForeground);
  }

  .native-editor-note {
    display: grid;
    gap: 8px;
    padding: 16px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editorWidget-background);
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

  button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  button:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 2px;
  }

  @media (max-width: 560px) {
    .query-view {
      padding: 16px;
    }

    .header {
      display: grid;
    }
  }
</style>
