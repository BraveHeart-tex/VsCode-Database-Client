import {
  createConnection,
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

// Creates the LSP connection over stdio — the extension host
// spawns this process and communicates via stdin/stdout
const connection = createConnection(ProposedFeatures.all);

const documents = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams): InitializeResult => {
  console.error('[lsp] initialized'); // use stderr — stdout is the LSP wire

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Phase 3: add completionProvider, hoverProvider here
    },
  };
});

connection.onInitialized(() => {
  console.error('[lsp] ready');
});

// Wire document sync
documents.listen(connection);
connection.listen();
