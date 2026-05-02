export type WebviewToExtensionMessage =
  | { type: 'EXECUTE_QUERY'; payload: { sql: string; connectionId: string } }
  | { type: 'CONNECT'; payload: ConnectionConfig }
  | { type: 'DISCONNECT'; payload: { connectionId: string } }
  | { type: 'GET_SCHEMA'; payload: { connectionId: string } }
  | { type: 'CANCEL_QUERY'; payload: { queryId: string } }
  | { type: 'SAVE_CONNECTION'; payload: ConnectionConfig }
  | { type: 'DELETE_CONNECTION'; payload: { connectionId: string } }
  | { type: 'GET_CONNECTIONS'; payload: Record<string, never> };

export type ExtensionToWebviewMessage =
  | { type: 'QUERY_RESULT'; payload: QueryResult }
  | { type: 'QUERY_ERROR'; payload: { message: string; queryId: string } }
  | {
      type: 'QUERY_PAGE';
      payload: { rows: Row[]; queryId: string; done: boolean };
    }
  | {
      type: 'SCHEMA_RESULT';
      payload: { connectionId: string; schema: DbSchema };
    }
  | { type: 'CONNECTION_SUCCESS'; payload: { connectionId: string } }
  | { type: 'CONNECTION_ERROR'; payload: { message: string } }
  | { type: 'CONNECTIONS_LIST'; payload: { connections: ConnectionConfig[] } }
  | { type: 'CONNECTION_SAVED'; payload: { connectionId: string } }
  | { type: 'CONNECTION_DELETED'; payload: { connectionId: string } }
  | { type: 'CONNECTION_TESTING'; payload: { connectionId: string } };

// Shared types
export interface ConnectionConfig {
  id: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  name: string;
}

export type Row = Record<string, unknown>;

export interface QueryResult {
  queryId: string;
  rows: Row[];
  columns: Column[];
  rowCount: number;
  duration: number;
}

export interface Column {
  name: string;
  dataType: string;
}

export interface DbSchema {
  tables: TableSchema[];
}

export interface TableSchema {
  name: string;
  schema: string;
  columns: Column[];
}
