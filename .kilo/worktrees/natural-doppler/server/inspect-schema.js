import 'dotenv/config';
import { getPool } from './db.js';

const required = {
  tblemployee: ['paycode', 'empname', 'presentcardno', 'companycode'],
  tbltimeregister: ['paycode', 'dateoffice', 'shift', 'in1', 'in2', 'out1', 'out2', 'hoursworked', 'status', 'reason'],
  machinerawpunch: ['cardno', 'mc_no', 'officepunch', 'inout', 'ismanual']
};

try {
  const pool = await getPool();
  const [result, indexes, foreignKeys] = await Promise.all([
    pool.request().query(`
    SELECT DB_NAME() AS databaseName, s.name AS schemaName, t.name AS tableName,
      c.name AS columnName, ty.name AS dataType, c.max_length AS maxLength, c.is_nullable AS isNullable
    FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.columns c ON c.object_id = t.object_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE s.name = 'dbo' AND t.name IN ('tblemployee', 'tbltimeregister', 'machinerawpunch')
    ORDER BY t.name, c.column_id`),
    pool.request().query(`
      SELECT OBJECT_SCHEMA_NAME(i.object_id) AS schemaName, OBJECT_NAME(i.object_id) AS tableName,
        i.name AS indexName, i.is_primary_key AS isPrimaryKey, i.is_unique AS isUnique
      FROM sys.indexes i
      WHERE OBJECT_SCHEMA_NAME(i.object_id) = 'dbo'
        AND OBJECT_NAME(i.object_id) IN ('tblemployee', 'tbltimeregister', 'machinerawpunch')
        AND i.name IS NOT NULL ORDER BY tableName, indexName`),
    pool.request().query(`
      SELECT OBJECT_SCHEMA_NAME(parent_object_id) AS parentSchema, OBJECT_NAME(parent_object_id) AS parentTable,
        name AS constraintName, OBJECT_SCHEMA_NAME(referenced_object_id) AS referencedSchema,
        OBJECT_NAME(referenced_object_id) AS referencedTable
      FROM sys.foreign_keys WHERE OBJECT_SCHEMA_NAME(parent_object_id) = 'dbo'
        AND (OBJECT_NAME(parent_object_id) IN ('tblemployee', 'tbltimeregister', 'machinerawpunch')
          OR OBJECT_NAME(referenced_object_id) IN ('tblemployee', 'tbltimeregister', 'machinerawpunch'))`)
  ]);
  const tables = Object.fromEntries(Object.entries(required).map(([table, columns]) => {
    const found = result.recordset.filter(row => row.tableName === table);
    const names = new Set(found.map(row => row.columnName.toLowerCase()));
    return [table, { present: found.length > 0, columns: found, missing: columns.filter(column => !names.has(column)) }];
  }));
  console.log(JSON.stringify({ database: result.recordset[0]?.databaseName || null, tables, indexes: indexes.recordset, foreignKeys: foreignKeys.recordset }, null, 2));
} catch {
  console.error(JSON.stringify({ success: false, message: 'Database connection unavailable.' }));
  process.exitCode = 1;
}
