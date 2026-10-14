import { emptyRecord } from './records';
import type { Database } from 'sql.js';
import { enforceCustomSchemaLimits, exportDatabase, getTableData, introspectSchema, prepareQueryDdl, type TableData } from './db';
import type { TableMeta } from './schemas';
import type { QueryRun } from './sqlRuntime';
import { TraceError } from './traceEngine';
import { snapshotAfterCommit } from './sqlRecovery';

/** Apply one supported CREATE atomically, including validation of the new schema. */
export function runCreateStatement(db: Database, input: string, previous: TableMeta[], persistent: boolean): QueryRun {
  let statement: ReturnType<typeof prepareQueryDdl>;
  try {
    statement = prepareQueryDdl(input);
  } catch (error) {
    throw new TraceError(error instanceof Error ? error.message : String(error));
  }
  db.run('SAVEPOINT qt_create');
  let schema: TableMeta[];
  let fkEdges: ReturnType<typeof introspectSchema>['fkEdges'];
  const tableData: Record<string, TableData> = emptyRecord();
  try {
    db.run(statement.sql);
    if (statement.type === 'table' && !previous.some((table) => table.name.toLowerCase() === statement.table.toLowerCase())) {
      for (const initializer of statement.initializers ?? []) db.run(initializer);
    }
    ({ schema, fkEdges } = introspectSchema(db));
    // Apply the browser's capacity bounds to new structures in every session.
    enforceCustomSchemaLimits(db, schema);
    for (const table of schema) tableData[table.name] = getTableData(db, table.name);
    db.run('RELEASE qt_create');
  } catch (error) {
    db.run('ROLLBACK TO qt_create; RELEASE qt_create');
    throw new TraceError(`CREATE failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const table = schema.find((item) => item.name.toLowerCase() === statement.table.toLowerCase());
  const added = schema.filter((item) => !previous.some((old) => old.name.toLowerCase() === item.name.toLowerCase())).map((item) => item.name);
  const persistence = persistent ? ' The structure is saved with your custom schema.' : ' The structure lasts for this session; selecting the original schema restores it.';
  return {
    trace: [{
      stage: 'create',
      label: `CREATE ${statement.type.toUpperCase()} ${statement.object}`,
      narration: (statement.type === 'table'
        ? added.length ? `Created ${statement.object}. Its columns and relationships are ready for INSERT and SELECT queries.` : `${statement.object} already exists; IF NOT EXISTS kept its current structure and rows.`
        : `The index ${statement.object} is available on ${statement.table}. Its uniqueness rules, if any, are checked on future writes.`) + persistence,
      activeTables: table ? [table.name] : [],
      activeColumns: [], activeEdges: [], litRows: {}, dimmedRows: {},
      partialResult: { columns: ['object', 'type'], rows: [[statement.object, statement.type]] },
      queryRange: { start: 0, end: input.length },
    }],
    notes: [],
    mutation: { schema, fkEdges, tableData, changedTables: added, databaseBytes: persistent ? snapshotAfterCommit(() => exportDatabase(db)) : undefined },
  };
}
