import * as assert from 'node:assert';
import {
  extractCurrentStatement,
  resolveExecutableSql,
} from '../query/statement';

suite('SQL statement extraction', () => {
  test('extracts the statement around the cursor', () => {
    const text = 'select 1;\nselect 2;';
    const statement = extractCurrentStatement(text, text.indexOf('2'));

    assert.strictEqual(statement?.sql, 'select 2');
  });

  test('uses selected SQL before current statement extraction', () => {
    const sql = resolveExecutableSql(
      'select 1;\nselect 2;',
      0,
      '  select selected_value;  '
    );

    assert.strictEqual(sql, 'select selected_value;');
  });

  test('extracts one statement from multiple semicolon-delimited statements', () => {
    const text = 'select first;\nselect second;\nselect third;';
    const statement = extractCurrentStatement(text, text.indexOf('second'));

    assert.strictEqual(statement?.sql, 'select second');
  });

  test('returns undefined for empty statements', () => {
    assert.strictEqual(extractCurrentStatement('', 0), undefined);
    assert.strictEqual(extractCurrentStatement('   ', 1), undefined);
    assert.strictEqual(
      extractCurrentStatement('select 1;\n;\nselect 2', 10),
      undefined
    );
  });
});
