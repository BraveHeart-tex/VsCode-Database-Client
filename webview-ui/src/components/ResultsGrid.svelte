<script lang="ts">
import type { Cell, Header, TableOptionsResolved } from '@tanstack/table-core';
import {
  createColumnHelper,
  createTable,
  getCoreRowModel,
} from '@tanstack/table-core';
import { createVirtualizer } from '@tanstack/svelte-virtual';
import type { Column, QueryResult, Row } from 'shared';
import { untrack } from 'svelte';
import { get } from 'svelte/store';

const {
  loading = false,
  result = null,
  errorMessage = null,
} = $props<{
  loading?: boolean;
  result?: QueryResult | null;
  errorMessage?: string | null;
}>();

const columnHelper = createColumnHelper<Row>();

let scrollElement = $state<HTMLDivElement | null>(null);
const currentRows = $derived(result?.rows ?? []);
const currentColumns = $derived(result?.columns ?? []);
const currentRowCount = $derived(result?.rowCount ?? 0);
const currentDuration = $derived(result?.duration ?? 0);
const hasRunQuery = $derived(
  loading || result !== null || errorMessage !== null
);

const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
  count: 0,
  getScrollElement: () => scrollElement,
  estimateSize: () => 32,
  overscan: 8,
});

const table = $derived(
  createTable(createTableOptions(currentRows, currentColumns))
);

const tableRows = $derived(table.getRowModel().rows);
const virtualRows = $derived($virtualizer.getVirtualItems());
const totalSize = $derived($virtualizer.getTotalSize());

$effect(() => {
  const count = currentRows.length;

  untrack(() => {
    get(virtualizer).setOptions({
      count,
      getScrollElement: () => scrollElement,
      estimateSize: () => 32,
      overscan: 8,
    });
  });
});

function createTableOptions(
  data: Row[],
  resultColumns: Column[]
): TableOptionsResolved<Row> {
  return {
    data,
    columns: resultColumns.map((column) =>
      columnHelper.accessor((row) => row[column.name], {
        id: column.name,
        header: () => column,
        cell: (info) => formatCellValue(info.getValue()),
      })
    ),
    getCoreRowModel: getCoreRowModel(),
    onStateChange: () => {},
    renderFallbackValue: null,
    state: {
      columnPinning: {
        left: [],
        right: [],
      },
    },
  };
}

function formatCellValue(value: unknown) {
  if (value === null) {
    return 'NULL';
  }

  if (value === undefined) {
    return '';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function headerColumn(header: Header<Row, unknown>) {
  return (
    currentColumns.find((column: Column) => column.name === header.id) ?? {
      name: header.id,
      dataType: 'unknown',
    }
  );
}

function renderCell(cell: Cell<Row, unknown>) {
  return formatCellValue(cell.getValue());
}
</script>

<section class="results-grid" aria-labelledby="results-grid-title">
  <header class="toolbar">
    <h2 id="results-grid-title">Results</h2>

    {#if hasRunQuery && !loading && !errorMessage}
      <span>{currentRowCount} rows in {currentDuration} ms</span>
    {/if}
  </header>

  {#if loading}
    <div class="state" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      Running query...
    </div>
  {:else if errorMessage}
    <div class="state error" role="alert">{errorMessage}</div>
  {:else if !hasRunQuery}
    <div class="state">Run a query to see results.</div>
  {:else if currentRows.length === 0}
    <div class="state">Query returned no rows.</div>
  {:else}
    <div class="table-wrap" bind:this={scrollElement}>
      <div
        class="table"
        style:width={`${Math.max(currentColumns.length, 1) * 180}px`}
      >
        <div class="thead">
          {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
            <div class="tr">
              {#each headerGroup.headers as header (header.id)}
                {@const column = headerColumn(header)}

                <div class="th">
                  <strong>{column.name}</strong>
                  <span>{column.dataType}</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <div class="tbody" style:height={`${totalSize}px`}>
          {#each virtualRows as virtualRow (virtualRow.key)}
            {@const row = tableRows[virtualRow.index]}

            {#if row}
              <div
                class="tr virtual-row"
                style:height="32px"
                style:transform={`translateY(${virtualRow.start}px)`}
              >
                {#each row.getVisibleCells() as cell (cell.id)}
                  <div class="td">
                    {renderCell(cell)}
                  </div>
                {/each}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    </div>

    <footer>{currentRowCount} rows in {currentDuration} ms</footer>
  {/if}
</section>

<style>
  .results-grid {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 280px;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border);
  }

  .toolbar,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 32px;
    padding: 6px 10px;
    box-sizing: border-box;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 12px;
  }

  h2 {
    margin: 0;
    color: var(--vscode-foreground);
    font-size: 13px;
    font-weight: 600;
  }

  .table-wrap {
    min-height: 0;
    overflow: auto;
    background: var(--vscode-editor-background);
  }

  .table {
    min-width: 100%;
  }

  .thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .tbody {
    position: relative;
  }

  .tr {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    min-width: 100%;
  }

  .virtual-row {
    position: absolute;
    inset-inline: 0;
    top: 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .th,
  .td {
    min-width: 0;
    padding: 6px 8px;
    box-sizing: border-box;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid var(--vscode-panel-border);
    font-size: 12px;
    line-height: 20px;
  }

  .th {
    display: grid;
    gap: 1px;
    min-height: 42px;
    align-content: center;
    color: var(--vscode-foreground);
  }

  .th span {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
    font-weight: 400;
  }

  .td {
    font-family: var(--vscode-editor-font-family);
  }

  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--vscode-panel-border);
    border-bottom: 0;
  }

  .state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 180px;
    padding: 24px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    text-align: center;
  }

  .state.error {
    color: var(--vscode-errorForeground);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--vscode-progressBar-background);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
