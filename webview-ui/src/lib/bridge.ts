import type {
  WebviewToExtensionMessage,
  ExtensionToWebviewMessage,
} from "shared";

declare function acquireVsCodeApi(): {
  postMessage(msg: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// Acquire once!
// calling it twice throws
const vscode = acquireVsCodeApi();

type MessageHandler<T extends ExtensionToWebviewMessage["type"]> = (
  payload: Extract<ExtensionToWebviewMessage, { type: T }>["payload"],
) => void;

class WebviewBridge {
  private handlers = new Map<string, Set<MessageHandler<any>>>();

  constructor() {
    window.addEventListener("message", (event) => {
      const msg = event.data as ExtensionToWebviewMessage;
      const set = this.handlers.get(msg.type);
      if (set) {
        set.forEach((h) => h((msg as any).payload));
      }
    });
  }

  send(message: WebviewToExtensionMessage) {
    vscode.postMessage(message);
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

export const bridge = new WebviewBridge();
