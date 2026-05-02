import * as vscode from 'vscode';
import { MessageBus } from './bridge/MessageBus';
import { ConnectionManager } from './db/ConnectionManager';

const bus = new MessageBus();
const connectionManager = new ConnectionManager();

export function activate(context: vscode.ExtensionContext) {
  console.log('db-client extension activated');

  const disposable = vscode.commands.registerCommand(
    'db-client.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello from db-client!');
    }
  );

  context.subscriptions.push(disposable);

  bus
    .on('CONNECT', async (config) => {
      try {
        await connectionManager.connect(config);
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
    });
}

export function deactivate() {
  connectionManager.disconnectAll();
}
