import type { ConnectionConfig, ExtensionToWebviewMessage } from 'shared';
import { ConnectionStore } from 'src/db/ConnectionStore';
import * as vscode from 'vscode';
import { MessageBus } from './bridge/MessageBus';
import { ConnectionManager } from './db/ConnectionManager';
import { MainPanel } from './panels/MainPanel';
import { SchemaTreeProvider } from './providers/SchemaTreeProvider';
import { QuerySessionManager } from './query/QuerySessionManager';
import { resolveExecutableSql } from './query/statement';

type QueryStateMessage = Extract<
  ExtensionToWebviewMessage,
  { type: 'QUERY_RUNNING' | 'QUERY_RESULT' | 'QUERY_ERROR' }
>;

const bus = new MessageBus();
const connectionManager = new ConnectionManager();
const querySessionManager = new QuerySessionManager();
let connectionStore: ConnectionStore;
let latestQueryState: QueryStateMessage | undefined;

interface ConnectionCommandArgument {
  connection?: {
    id?: unknown;
  };
}

export function activate(context: vscode.ExtensionContext) {
  console.log('db-client extension activated');

  connectionStore = new ConnectionStore(context.secrets);
  const schemaTreeProvider = new SchemaTreeProvider(
    connectionStore,
    connectionManager
  );
  const connectionsTreeView = vscode.window.createTreeView(
    'db-client.connections',
    { treeDataProvider: schemaTreeProvider }
  );

  const helloWorldCommand = vscode.commands.registerCommand(
    'db-client.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello from db-client!');
    }
  );
  const openPanelCommand = vscode.commands.registerCommand(
    'db-client.openPanel',
    () => MainPanel.create(context, bus)
  );
  const newQueryCommand = vscode.commands.registerCommand(
    'db-client.newQuery',
    (argument?: unknown) => openNewQuery(argument)
  );
  const executeQueryCommand = vscode.commands.registerCommand(
    'db-client.executeQuery',
    () => executeActiveQuery(context)
  );

  context.subscriptions.push(
    helloWorldCommand,
    openPanelCommand,
    newQueryCommand,
    executeQueryCommand,
    vscode.workspace.onDidCloseTextDocument((document) => {
      querySessionManager.unbind(document.uri);
    }),
    connectionsTreeView
  );

  bus
    .on('GET_CONNECTIONS', async () => {
      const connections = await connectionStore.getAll();
      bus.send({ type: 'CONNECTIONS_LIST', payload: { connections } });
    })
    .on('WEBVIEW_READY', () => {
      if (latestQueryState) {
        bus.send(latestQueryState);
      }
    })
    .on('SAVE_CONNECTION', async (config) => {
      await connectionStore.save(config);
      schemaTreeProvider.refresh();
      bus.send({
        type: 'CONNECTION_SAVED',
        payload: { connectionId: config.id },
      });
    })
    .on('DELETE_CONNECTION', async ({ connectionId }) => {
      await connectionStore.delete(connectionId);
      await connectionManager.disconnect(connectionId);
      schemaTreeProvider.refresh();
      bus.send({ type: 'CONNECTION_DELETED', payload: { connectionId } });
    })
    .on('CONNECT', async (config) => {
      try {
        bus.send({
          type: 'CONNECTION_TESTING',
          payload: { connectionId: config.id },
        });
        await connectionManager.connect(config);
        schemaTreeProvider.refresh();
        bus.send({
          type: 'CONNECTION_SUCCESS',
          payload: { connectionId: config.id },
        });
      } catch (err: unknown) {
        bus.send({
          type: 'CONNECTION_ERROR',
          payload: { message: getErrorMessage(err) },
        });
      }
    })
    .on('DISCONNECT', async ({ connectionId }) => {
      await connectionManager.disconnect(connectionId);
      schemaTreeProvider.refresh();
    });
}

export function deactivate() {
  connectionManager.disconnectAll();
}

async function openNewQuery(argument?: unknown): Promise<void> {
  const connection = await resolveConnection(argument);

  if (!connection) {
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: `-- Connection: ${connection.name}\n\n`,
  });

  querySessionManager.bind(document.uri, connection.id);
  await vscode.window.showTextDocument(document);
}

async function executeActiveQuery(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    await vscode.window.showWarningMessage(
      'Open a SQL editor before running a query.'
    );
    return;
  }

  if (editor.document.languageId !== 'sql') {
    await vscode.window.showWarningMessage(
      'The active editor must be a SQL document.'
    );
    return;
  }

  const sql = getSelectedOrCurrentStatement(editor);

  if (!sql) {
    await vscode.window.showWarningMessage(
      'No SQL statement found at the cursor.'
    );
    return;
  }

  const connection = await resolveConnection(
    querySessionManager.get(editor.document.uri)
  );

  if (!connection) {
    return;
  }

  querySessionManager.bind(editor.document.uri, connection.id);
  await MainPanel.create(context, bus);
  sendQueryState({
    type: 'QUERY_RUNNING',
    payload: { connectionId: connection.id },
  });

  try {
    if (!connectionManager.isConnected(connection.id)) {
      await connectionManager.connect(connection);
    }

    const result = await connectionManager.query(connection.id, sql);
    sendQueryState({ type: 'QUERY_RESULT', payload: result });
  } catch (error: unknown) {
    sendQueryState({
      type: 'QUERY_ERROR',
      payload: { message: getErrorMessage(error), queryId: '' },
    });
  }
}

function getSelectedOrCurrentStatement(
  editor: vscode.TextEditor
): string | undefined {
  return resolveExecutableSql(
    editor.document.getText(),
    editor.document.offsetAt(editor.selection.active),
    editor.document.getText(editor.selection)
  );
}

async function resolveConnection(
  argument?: unknown
): Promise<ConnectionConfig | undefined> {
  const connections = await connectionStore.getAll();
  const connectionId = readConnectionId(argument);

  if (connectionId) {
    const connection = connections.find(({ id }) => id === connectionId);

    if (connection) {
      return connection;
    }

    await vscode.window.showErrorMessage(
      `No saved connection found for id: ${connectionId}`
    );
    return undefined;
  }

  if (connections.length === 0) {
    await vscode.window.showWarningMessage(
      'Create a saved connection before opening a query.'
    );
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    connections.map((connection) => ({
      label: connection.name,
      description: `${connection.host}:${connection.port}/${connection.database}`,
      connection,
    })),
    { placeHolder: 'Choose a connection for this query' }
  );

  return picked?.connection;
}

function readConnectionId(argument?: unknown): string | undefined {
  if (typeof argument === 'string') {
    return argument;
  }

  if (!isConnectionCommandArgument(argument)) {
    return undefined;
  }

  const connectionId = argument.connection?.id;
  return typeof connectionId === 'string' ? connectionId : undefined;
}

function isConnectionCommandArgument(
  argument: unknown
): argument is ConnectionCommandArgument {
  return (
    typeof argument === 'object' &&
    argument !== null &&
    'connection' in argument
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendQueryState(message: QueryStateMessage): void {
  latestQueryState = message;
  bus.send(message);
}
