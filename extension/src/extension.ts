import { ConnectionStore } from 'src/db/ConnectionStore';
import * as vscode from 'vscode';
import { MessageBus } from './bridge/MessageBus';
import { ConnectionManager } from './db/ConnectionManager';
import { MainPanel } from './panels/MainPanel';
import { SchemaTreeProvider } from './providers/SchemaTreeProvider';

const bus = new MessageBus();
const connectionManager = new ConnectionManager();
let connectionStore: ConnectionStore;

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

  context.subscriptions.push(
    helloWorldCommand,
    openPanelCommand,
    connectionsTreeView
  );

  bus
    .on('GET_CONNECTIONS', async () => {
      const connections = await connectionStore.getAll();
      bus.send({ type: 'CONNECTIONS_LIST', payload: { connections } });
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
      } catch (err: any) {
        bus.send({
          type: 'CONNECTION_ERROR',
          payload: { message: err.message },
        });
      }
    })
    .on('EXECUTE_QUERY', async ({ sql, connectionId }) => {
      try {
        const result = await connectionManager.query(connectionId, sql);
        bus.send({ type: 'QUERY_RESULT', payload: result });
      } catch (err: any) {
        bus.send({
          type: 'QUERY_ERROR',
          payload: { message: err.message, queryId: '' },
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
