import 'dotenv/config';
import { getPool, sql } from '../server/db.js';

const pool = await getPool();

// Check indexes
const indexes = await pool.request().query(`
  SELECT name, type_desc, is_unique, filter_definition
  FROM sys.indexes 
  WHERE object_id = OBJECT_ID('dbo.HR_Holidays') AND is_unique = 1
`);
console.log('Unique indexes:', JSON.stringify(indexes.recordset, null, 2));

// Check if the old unique index still exists
const oldIndex = await pool.request().query(`
  SELECT name FROM sys.indexes 
  WHERE object_id = OBJECT_ID('dbo.HR_Holidays') 
  AND is_unique = 1 
  AND name = 'UQ_HRHoliday_DateCategory'
`);
console.log('Old index exists:', oldIndex.recordset.length > 0);

await pool.close();