import type {
  DocumentConnectionNotification,
  SchemaClearNotification,
  SchemaUpdateNotification,
} from 'shared';
import {
  type CompletionParams,
  createConnection,
  type InitializeParams,
  type InitializeResult,
  NotificationType,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { onCompletion } from './completion';
import { bindDocument, clear, update } from './schemaCache';

// Creates the LSP connection over stdio — the extension host
// spawns this process and communicates via stdin/stdout
const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);
const schemaUpdateNotification = new NotificationType<SchemaUpdateNotification>(
  'dbClient/schemaUpdate'
);
const schemaClearNotification = new NotificationType<SchemaClearNotification>(
  'dbClient/schemaClear'
);
const documentConnectionNotification =
  new NotificationType<DocumentConnectionNotification>(
    'dbClient/documentConnection'
  );

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  console.error('[lsp] initialized'); // use stderr — stdout is the LSP wire

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['.', ' ', '\n'],
      },
    },
  };
});

connection.onInitialized(() => {
  console.error('[lsp] ready');
});

connection.onNotification(schemaUpdateNotification, (payload) => {
  update(payload.connectionId, payload.metadata);
});

connection.onNotification(schemaClearNotification, (payload) => {
  clear(payload.connectionId);
});

connection.onNotification(documentConnectionNotification, (payload) => {
  bindDocument(payload.documentUri, payload.connectionId);
});

connection.onCompletion((params: CompletionParams) => {
  return onCompletion(documents, params);
});

// Wire document sync
documents.listen(connection);
connection.listen();
