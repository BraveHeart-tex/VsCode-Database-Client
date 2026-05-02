export interface ExtractedStatement {
  sql: string;
  startOffset: number;
  endOffset: number;
}

export function resolveExecutableSql(
  text: string,
  cursorOffset: number,
  selectedText: string
): string | undefined {
  const selectedSql = selectedText.trim();

  if (selectedSql) {
    return selectedSql;
  }

  return extractCurrentStatement(text, cursorOffset)?.sql;
}

export function extractCurrentStatement(
  text: string,
  cursorOffset: number
): ExtractedStatement | undefined {
  const safeOffset = Math.min(Math.max(cursorOffset, 0), text.length);

  // TODO: Replace this with parser-aware scanning so semicolons inside SQL
  // strings and comments do not split statements.
  const previousTerminator = text.lastIndexOf(';', safeOffset - 1);
  const nextTerminator = text.indexOf(';', safeOffset);
  const startOffset = previousTerminator >= 0 ? previousTerminator + 1 : 0;
  const endOffset = nextTerminator >= 0 ? nextTerminator : text.length;
  const sql = text.slice(startOffset, endOffset).trim();

  if (!sql) {
    return undefined;
  }

  return { sql, startOffset, endOffset };
}
