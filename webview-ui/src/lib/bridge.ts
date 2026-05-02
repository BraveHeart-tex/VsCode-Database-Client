import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "shared";

export const BRIDGE_CONTEXT_KEY = Symbol("bridge");

export interface VsCodeApi {
  postMessage(msg: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;
}

type MessageHandler<T extends ExtensionToWebviewMessage["type"]> = (
  payload: Extract<ExtensionToWebviewMessage, { type: T }>["payload"],
) => void;

export class WebviewBridge {
  private handlers = new Map<string, Set<MessageHandler<any>>>();

  constructor(private readonly vscode: VsCodeApi) {
    window.addEventListener("message", (event) => {
      const msg = event.data as ExtensionToWebviewMessage;
      const set = this.handlers.get(msg.type);
      if (set) {
        set.forEach((h) => h((msg as any).payload));
      }
    });
  }

  send(message: WebviewToExtensionMessage) {
    this.vscode.postMessage(message);
  }

  on<T extends ExtensionToWebviewMessage["type"]>(
    type: T,
    handler: MessageHandler<T>,
  ) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => this.handlers.get(type)?.delete(handler);
  }
}

export function createWebviewBridge(vscode: VsCodeApi) {
  return new WebviewBridge(vscode);
}
