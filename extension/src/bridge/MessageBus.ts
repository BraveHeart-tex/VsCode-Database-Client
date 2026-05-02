import * as vscode from 'vscode'
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from 'shared'

type MessageHandler<T extends WebviewToExtensionMessage['type']> = (
  payload: Extract<WebviewToExtensionMessage, { type: T }>['payload']
) => void | Promise<void>

export class MessageBus {
  private handlers = new Map<string, MessageHandler<any>>()
  private panel: vscode.WebviewPanel | null = null

  attach(panel: vscode.WebviewPanel) {
    this.panel = panel
    panel.webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
      const handler = this.handlers.get(msg.type)
      if (handler) {
        handler((msg as any).payload)
      } else {
        console.warn(`[MessageBus] No handler for message type: ${msg.type}`)
      }
    })
  }

  on<T extends WebviewToExtensionMessage['type']>(
    type: T,
    handler: MessageHandler<T>
  ) {
    this.handlers.set(type, handler)
    return this
  }

  send(message: ExtensionToWebviewMessage) {
    if (!this.panel) {
      console.warn('[MessageBus] Cannot send — no panel attached')
      return
    }
    this.panel.webview.postMessage(message)
  }

  detach() {
    this.panel = null
  }
}
