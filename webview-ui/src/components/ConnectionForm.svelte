<script lang="ts">
import type { ConnectionConfig, ExtensionToWebviewMessage } from 'shared';
import { getContext, onMount } from 'svelte';
import { BRIDGE_CONTEXT_KEY, type WebviewBridge } from '../lib/bridge';

type Feedback = {
  kind: 'success' | 'error';
  message: string;
} | null;
type Payload<T extends ExtensionToWebviewMessage['type']> = Extract<
  ExtensionToWebviewMessage,
  { type: T }
>['payload'];

const bridgeClient = getContext<WebviewBridge>(BRIDGE_CONTEXT_KEY);

let form = $state({
  name: '',
  host: '',
  port: 5432,
  database: '',
  username: '',
  password: '',
  ssl: false,
});
let connections = $state<ConnectionConfig[]>([]);
let testingConnectionId = $state<string | null>(null);
let feedback = $state<Feedback>(null);

const isTesting = $derived(testingConnectionId !== null);

onMount(() => {
  const offList = bridgeClient.on(
    'CONNECTIONS_LIST',
    ({ connections: next }: Payload<'CONNECTIONS_LIST'>) => {
      connections = next;
    }
  );
  const offTesting = bridgeClient.on(
    'CONNECTION_TESTING',
    ({ connectionId }: Payload<'CONNECTION_TESTING'>) => {
      testingConnectionId = connectionId;
      feedback = null;
    }
  );
  const offSuccess = bridgeClient.on(
    'CONNECTION_SUCCESS',
    ({ connectionId }: Payload<'CONNECTION_SUCCESS'>) => {
      testingConnectionId = null;
      feedback = {
        kind: 'success',
        message: `Connected to ${getConnectionLabel(connectionId)}.`,
      };
      bridgeClient.send({ type: 'GET_CONNECTIONS', payload: {} });
    }
  );
  const offSaved = bridgeClient.on('CONNECTION_SAVED', () => {
    bridgeClient.send({ type: 'GET_CONNECTIONS', payload: {} });
  });
  const offError = bridgeClient.on(
    'CONNECTION_ERROR',
    ({ message }: Payload<'CONNECTION_ERROR'>) => {
      testingConnectionId = null;
      feedback = { kind: 'error', message };
    }
  );
  const offDeleted = bridgeClient.on(
    'CONNECTION_DELETED',
    ({ connectionId }: Payload<'CONNECTION_DELETED'>) => {
      connections = connections.filter(
        (connection) => connection.id !== connectionId
      );
      if (testingConnectionId === connectionId) {
        testingConnectionId = null;
      }
      feedback = { kind: 'success', message: 'Connection deleted.' };
    }
  );

  bridgeClient.send({ type: 'GET_CONNECTIONS', payload: {} });

  return () => {
    offList();
    offTesting();
    offSuccess();
    offSaved();
    offError();
    offDeleted();
  };
});

function submitConnection() {
  const config = createConnectionConfig();

  feedback = null;
  bridgeClient.send({ type: 'SAVE_CONNECTION', payload: config });
  bridgeClient.send({ type: 'CONNECT', payload: config });
}

function connect(connection: ConnectionConfig) {
  feedback = null;
  bridgeClient.send({
    type: 'CONNECT',
    payload: toConnectionConfig(connection),
  });
}

function deleteConnection(connectionId: string) {
  feedback = null;
  bridgeClient.send({ type: 'DELETE_CONNECTION', payload: { connectionId } });
}

function createConnectionConfig(): ConnectionConfig {
  return {
    id: crypto.randomUUID(),
    name: form.name.trim(),
    host: form.host.trim(),
    port: Number(form.port),
    database: form.database.trim(),
    username: form.username.trim(),
    password: form.password,
    ssl: form.ssl,
  };
}

function toConnectionConfig(connection: ConnectionConfig): ConnectionConfig {
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: Number(connection.port),
    database: connection.database,
    username: connection.username,
    password: connection.password,
    ssl: connection.ssl,
  };
}

function getConnectionLabel(connectionId: string) {
  const connection = connections.find(({ id }) => id === connectionId);
  return connection?.name || form.name || connectionId;
}
</script>

<section class="connection-form" aria-labelledby="connection-form-title">
  <header class="header">
    <div>
      <h1 id="connection-form-title">Connections</h1>
      <p>Save and connect to PostgreSQL databases.</p>
    </div>

    {#if isTesting}
      <span class="status" aria-live="polite">Testing connection...</span>
    {/if}
  </header>

  <form class="form" onsubmit={(event) => {
    event.preventDefault();
    submitConnection();
  }}>
    <label>
      <span>Name</span>
      <input bind:value={form.name} name="name" required autocomplete="off" />
    </label>

    <div class="field-row">
      <label>
        <span>Host</span>
        <input bind:value={form.host} name="host" required autocomplete="url" />
      </label>

      <label class="port-field">
        <span>Port</span>
        <input
          bind:value={form.port}
          name="port"
          type="number"
          min="1"
          max="65535"
          required
        />
      </label>
    </div>

    <label>
      <span>Database</span>
      <input bind:value={form.database} name="database" required autocomplete="off" />
    </label>

    <div class="field-row">
      <label>
        <span>Username</span>
        <input bind:value={form.username} name="username" required autocomplete="username" />
      </label>

      <label>
        <span>Password</span>
        <input
          bind:value={form.password}
          name="password"
          type="password"
          autocomplete="current-password"
        />
      </label>
    </div>

    <label class="toggle">
      <input bind:checked={form.ssl} name="ssl" type="checkbox" />
      <span>Use SSL</span>
    </label>

    {#if feedback}
      <p class:success={feedback.kind === 'success'} class:error={feedback.kind === 'error'}>
        {feedback.message}
      </p>
    {/if}

    <button type="submit" disabled={isTesting}>
      {isTesting ? 'Testing...' : 'Save and connect'}
    </button>
  </form>

  <section class="saved" aria-labelledby="saved-connections-title">
    <h2 id="saved-connections-title">Saved connections</h2>

    {#if connections.length > 0}
      <ul>
        {#each connections as connection (connection.id)}
          <li>
            <div>
              <strong>{connection.name}</strong>
              <span>{connection.username}@{connection.host}:{connection.port}/{connection.database}</span>
            </div>
            <div class="actions">
              <button
                type="button"
                class="secondary"
                disabled={isTesting}
                onclick={() => connect(connection)}
              >
                {testingConnectionId === connection.id ? 'Testing...' : 'Connect'}
              </button>
              <button
                type="button"
                class="danger"
                disabled={isTesting}
                onclick={() => deleteConnection(connection.id)}
              >
                Delete
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">No saved connections yet.</p>
    {/if}
  </section>
</section>

<style>
  .connection-form {
    display: grid;
    gap: 24px;
    width: min(100%, 760px);
    padding: 24px;
    box-sizing: border-box;
    color: var(--vscode-foreground);
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
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

  .header p,
  .empty,
  li span {
    color: var(--vscode-descriptionForeground);
  }

  .status {
    flex: 0 0 auto;
    color: var(--vscode-progressBar-background);
    font-size: 12px;
    line-height: 1.5;
  }

  .form {
    display: grid;
    gap: 14px;
  }

  label {
    display: grid;
    gap: 6px;
    color: var(--vscode-foreground);
    font-size: 12px;
    font-weight: 600;
  }

  input {
    width: 100%;
    min-height: 30px;
    padding: 5px 8px;
    box-sizing: border-box;
    border: 1px solid var(--vscode-input-border);
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    font: inherit;
    font-size: 13px;
    outline: none;
  }

  input:focus {
    border-color: var(--vscode-focusBorder);
  }

  .field-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px;
    gap: 12px;
  }

  .port-field input {
    font-variant-numeric: tabular-nums;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
  }

  .toggle input {
    width: auto;
    min-height: auto;
  }

  .success,
  .error {
    padding: 8px 10px;
    border-left: 3px solid;
    font-size: 13px;
  }

  .success {
    border-color: var(--vscode-testing-iconPassed);
    color: var(--vscode-testing-iconPassed);
    background: var(--vscode-editorWidget-background);
  }

  .error {
    border-color: var(--vscode-errorForeground);
    color: var(--vscode-errorForeground);
    background: var(--vscode-inputValidation-errorBackground);
  }

  button {
    min-height: 32px;
    padding: 6px 12px;
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

  button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }

  .secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }

  .secondary:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .danger {
    color: var(--vscode-errorForeground);
    background: var(--vscode-editorWidget-background);
    border-color: var(--vscode-inputValidation-errorBorder);
  }

  .danger:hover:not(:disabled) {
    background: var(--vscode-inputValidation-errorBackground);
  }

  .saved {
    display: grid;
    gap: 12px;
    padding-top: 8px;
  }

  ul {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--vscode-panel-border);
  }

  li div:first-child {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  strong,
  li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--vscode-foreground);
    font-size: 13px;
  }

  li span {
    font-size: 12px;
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  @media (max-width: 560px) {
    .connection-form {
      padding: 16px;
    }

    .header,
    li {
      grid-template-columns: 1fr;
    }

    .header {
      display: grid;
    }

    .field-row {
      grid-template-columns: 1fr;
    }

    .actions {
      justify-content: flex-start;
    }
  }
</style>
