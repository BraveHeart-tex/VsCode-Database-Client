import * as vscode from 'vscode';
import type { MessageBus } from '../bridge/MessageBus';

const VIEW_TYPE = 'db-client.mainPanel';
const WEBVIEW_DIR = 'webview';

export class MainPanel {
  private static currentPanel: MainPanel | null = null;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private readonly bus: MessageBus
  ) {
    this.panel.onDidDispose(() => this.dispose());
  }

  static async create(context: vscode.ExtensionContext, bus: MessageBus) {
    if (MainPanel.currentPanel) {
      MainPanel.currentPanel.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'DB Client',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', WEBVIEW_DIR),
        ],
      }
    );

    const mainPanel = new MainPanel(panel, context, bus);
    MainPanel.currentPanel = mainPanel;
    panel.webview.html = await mainPanel.getHtml();
    bus.attach(panel);
  }

  private async getHtml() {
    const webviewRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      'dist',
      WEBVIEW_DIR
    );
    const indexUri = vscode.Uri.joinPath(webviewRoot, 'index.html');
    const html = Buffer.from(
      await vscode.workspace.fs.readFile(indexUri)
    ).toString('utf8');
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${this.panel.webview.cspSource} data: https:`,
      `style-src ${this.panel.webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      "font-src 'none'",
    ].join('; ');

    return html
      .replace(
        /<head>/,
        `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`
      )
      .replace(/<(script)\b([^>]*)>/g, `<$1 nonce="${nonce}"$2>`)
      .replace(
        /\b(src|href)="([^"]+)"/g,
        (_match: string, attribute: string, value: string) => {
          if (!isLocalAsset(value)) {
            return `${attribute}="${value}"`;
          }

          const assetPath = value.replace(/^\/+/, '');
          const assetUri = vscode.Uri.joinPath(webviewRoot, assetPath);
          return `${attribute}="${this.panel.webview.asWebviewUri(assetUri)}"`;
        }
      );
  }

  private dispose() {
    if (MainPanel.currentPanel === this) {
      MainPanel.currentPanel = null;
      this.bus.detach();
    }
  }
}

function isLocalAsset(value: string) {
  return !/^(?:[a-z]+:|#|data:)/i.test(value);
}

function getNonce() {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index++) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return nonce;
}
