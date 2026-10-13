import 'dotenv/config';
import { getPool } from '../server/db.js';

const pool = await getPool();

// Find duplicates
const dupes = await pool.request().query(`
  SELECT holidaydate, category, companyCodes, categoryIds, COUNT(*) as cnt
  FROM dbo.HR_Holidays
  GROUP BY holidaydate, category, companyCodes, categoryIds
  HAVING COUNT(*) > 1
`);
console.log('Duplicates found:', JSON.stringify(dupes.recordset, null, 2));

// Clean up: keep only one per group, delete the rest
if (dupes.recordset.length > 0) {
  for (const d of dupes.recordset) {
    const ids = await pool.request().query(`
      SELECT id FROM dbo.HR_Holidays
      WHERE holidaydate = @dt AND category = @cat
        AND ISNULL(companyCodes, '[]') = @cc
        AND ISNULL(categoryIds, '[]') = @cid
      ORDER BY id
    `, { dt: d.holidaydate, cat: d.category, cc: d.companyCodes || '[]', cid: d.categoryIds || '[]' });
    
    console.log(`Found ${ids.recordset.length} rows for ${d.holidaydate}/${d.category}, keeping first, deleting ${ids.recordset.length - 1}`);
    
    for (let i = 1; i < ids.recordset.length; i++) {
      await pool.request().input('id', sql.Int, ids.recordset[i].id)
        .query('DELETE FROM dbo.HR_Holidays WHERE id = @id');
      console.log(`  Deleted id ${ids.recordset[i].id}`);
    }
  }
}

// Verify
const counts = await pool.request().query(`
  SELECT COUNT(*) as total FROM dbo.HR_Holidays
`);
console.log('Total holidays after cleanup:', counts.recordset[0].total);

await pool.close();