/**
 * Minimalny runner migracji SQL: stosuje pliki db/migrations/*.sql w kolejności nazw,
 * każdy w osobnej transakcji, i zapisuje je w schema_migrations.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db/migrations');

async function main() {
  const client = await pool.connect();
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const applied = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        console.log(`✔ ${file}`);
        count++;
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migracja ${file} nie powiodła się: ${(err as Error).message}`);
      }
    }
    console.log(count ? `Zastosowano migracji: ${count}` : 'Baza jest aktualna');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
