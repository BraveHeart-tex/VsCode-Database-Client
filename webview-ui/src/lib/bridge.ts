import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from 'shared';

export const BRIDGE_CONTEXT_KEY = Symbol('bridge');

export interface VsCodeApi {
  postMessage(msg: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  function acquireVsCodeApi(): VsCodeApi;

  var dbClientBridge: WebviewBridge | undefined;
  var dbClientVsCodeApi: VsCodeApi | undefined;
}

type ExtensionMessageType = ExtensionToWebviewMessage['type'];

type MessagePayload<T extends ExtensionMessageType> = Extract<
  ExtensionToWebviewMessage,
  { type: T }
>['payload'];

type MessageHandler<T extends ExtensionMessageType> = (
  payload: MessagePayload<T>
) => void;

type InternalHandler = (payload: unknown) => void;

export class WebviewBridge {
  private handlers = new Map<ExtensionMessageType, Set<InternalHandler>>();

  constructor(private readonly vscode: VsCodeApi) {
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data as ExtensionToWebviewMessage;

      const set = this.handlers.get(msg.type);

      if (!set) {
        return;
      }

      set.forEach((handler) => {
        handler(msg.payload);
      });
    });
  }

  send(message: WebviewToExtensionMessage) {
    this.vscode.postMessage(message);
  }

  on<T extends ExtensionMessageType>(type: T, handler: MessageHandler<T>) {
    const wrappedHandler: InternalHandler = (payload) => {
      handler(payload as MessagePayload<T>);
    };

    let set = this.handlers.get(type);

    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }

    set.add(wrappedHandler);

    return () => {
      set.delete(wrappedHandler);

      if (set.size === 0) {
        this.handlers.delete(type);
      }
    };
  }
}

export function createWebviewBridge(vscode: VsCodeApi) {
  return new WebviewBridge(vscode);
}

export function getWebviewBridge() {
  globalThis.dbClientVsCodeApi ??= acquireVsCodeApi();
  globalThis.dbClientBridge ??= createWebviewBridge(
    globalThis.dbClientVsCodeApi
  );

  return globalThis.dbClientBridge;
}
