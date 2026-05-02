import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  console.log('db-client extension activated')

  const disposable = vscode.commands.registerCommand('db-client.helloWorld', () => {
    vscode.window.showInformationMessage('Hello from db-client!')
  })

  context.subscriptions.push(disposable)
}

export function deactivate() {}
