import type {
  ConnectionConfig,
  DocumentConnectionNotification,
  ExtensionToWebviewMessage,
  SchemaClearNotification,
  SchemaUpdateNotification,
} from 'shared';
import { ConnectionStore } from 'src/db/ConnectionStore';
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { MessageBus } from './bridge/MessageBus';
import { ConnectionManager } from './db/ConnectionManager';
import { MainPanel } from './panels/MainPanel';
import { SchemaTreeProvider } from './providers/SchemaTreeProvider';
import { QuerySessionManager } from './query/QuerySessionManager';
import { resolveExecutableSql } from './query/statement';
import { SchemaMetadataManager } from './schema/SchemaMetadataManager';

type QueryStateMessage = Extract<
  ExtensionToWebviewMessage,
  { type: 'QUERY_RUNNING' | 'QUERY_RESULT' | 'QUERY_ERROR' }
>;

const bus = new MessageBus();
const connectionManager = new ConnectionManager();
const querySessionManager = new QuerySessionManager();
const schemaMetadataManager = new SchemaMetadataManager(connectionManager);
let connectionStore: ConnectionStore;
let latestQueryState: QueryStateMessage | undefined;
let languageClient: LanguageClient | undefined;

interface ConnectionCommandArgument {
  connection?: {
    id?: unknown;
  };
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('db-client extension activated');

  languageClient = createLanguageClient(context);
  context.subscriptions.push(languageClient);
  await languageClient.start();

  connectionStore = new ConnectionStore(context.secrets);
  const schemaTreeProvider = new SchemaTreeProvider(
    connectionStore,
    connectionManager,
    schemaMetadataManager
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
  const refreshSchemaCommand = vscode.commands.registerCommand(
    'db-client.refreshSchema',
    (argument?: unknown) => refreshSchema(argument, schemaTreeProvider)
  );
  context.subscriptions.push(
    schemaMetadataManager.onDidRefresh((metadata) => {
      sendSchemaUpdate(metadata.connectionId, metadata);
    }),
    helloWorldCommand,
    openPanelCommand,
    newQueryCommand,
    executeQueryCommand,
    refreshSchemaCommand,
    vscode.workspace.onDidCloseTextDocument((document) => {
      const connectionId = querySessionManager.get(document.uri);
      querySessionManager.unbind(document.uri);

      if (connectionId) {
        sendDocumentConnection(document.uri, null);
      }
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
      schemaMetadataManager.clear(connectionId);
      sendSchemaClear(connectionId);
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
        await refreshMetadataAfterConnect(config);
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
      schemaMetadataManager.clear(connectionId);
      sendSchemaClear(connectionId);
      schemaTreeProvider.refresh();
    });
}

export function deactivate() {
  void languageClient?.stop();
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

  await vscode.window.showTextDocument(document);
  bindQueryDocument(document.uri, connection.id);
  void ensureSchemaMetadata(connection);
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

  bindQueryDocument(editor.document.uri, connection.id);
  void ensureSchemaMetadata(connection);
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

async function refreshSchema(
  argument: unknown,
  schemaTreeProvider: SchemaTreeProvider
): Promise<void> {
  const connection = await resolveConnection(argument);

  if (!connection) {
    return;
  }

  try {
    if (!connectionManager.isConnected(connection.id)) {
      await connectionManager.connect(connection);
    }

    await schemaMetadataManager.refresh(connection);
    schemaTreeProvider.refresh();
    await vscode.window.showInformationMessage(
      `Schema refreshed for ${connection.name}.`
    );
  } catch (error: unknown) {
    await vscode.window.showErrorMessage(
      `Failed to refresh schema for ${connection.name}: ${getErrorMessage(error)}`
    );
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

async function refreshMetadataAfterConnect(
  connection: ConnectionConfig
): Promise<void> {
  await ensureSchemaMetadata(connection);
}

async function ensureSchemaMetadata(
  connection: ConnectionConfig
): Promise<void> {
  try {
    if (!connectionManager.isConnected(connection.id)) {
      await connectionManager.connect(connection);
    }

    await schemaMetadataManager.refresh(connection);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.warn(
      `[SchemaMetadataManager] Failed to introspect ${connection.id}: ${message}`
    );
    await vscode.window.showWarningMessage(
      `Connected to ${connection.name}, but schema introspection failed: ${message}`
    );
  }
}

function createLanguageClient(
  context: vscode.ExtensionContext
): LanguageClient {
  const serverModule = vscode.Uri.joinPath(
    context.extensionUri,
    'dist',
    'lsp',
    'server.js'
  ).fsPath;
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'untitled', language: 'sql' },
      { language: 'sql' },
    ],
  };

  return new LanguageClient(
    'dbClientSqlLanguageServer',
    'DB Client SQL Language Server',
    serverOptions,
    clientOptions
  );
}

function bindQueryDocument(
  documentUri: vscode.Uri,
  connectionId: string
): void {
  querySessionManager.bind(documentUri, connectionId);
  sendDocumentConnection(documentUri, connectionId);

  const metadata = schemaMetadataManager.get(connectionId);

  if (metadata) {
    sendSchemaUpdate(connectionId, metadata);
  }
}

function sendSchemaUpdate(
  connectionId: string,
  metadata: SchemaUpdateNotification['metadata']
): void {
  languageClient?.sendNotification('dbClient/schemaUpdate', {
    connectionId,
    metadata,
  } satisfies SchemaUpdateNotification);
}

function sendSchemaClear(connectionId: string): void {
  languageClient?.sendNotification('dbClient/schemaClear', {
    connectionId,
  } satisfies SchemaClearNotification);
}

function sendDocumentConnection(
  documentUri: vscode.Uri,
  connectionId: string | null
): void {
  languageClient?.sendNotification('dbClient/documentConnection', {
    documentUri: documentUri.toString(),
    connectionId,
  } satisfies DocumentConnectionNotification);
}
