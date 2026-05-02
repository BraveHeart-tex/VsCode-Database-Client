import type * as vscode from 'vscode';

export class QuerySessionManager {
  private readonly sessions = new Map<string, string>();

  bind(documentUri: vscode.Uri, connectionId: string): void {
    this.sessions.set(documentUri.toString(), connectionId);
  }

  get(documentUri: vscode.Uri): string | undefined {
    return this.sessions.get(documentUri.toString());
  }

  unbind(documentUri: vscode.Uri): void {
    this.sessions.delete(documentUri.toString());
  }
}
