import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const source = new URL('../database/migrations/', import.meta.url);
const target = new URL('../src/storage/generated/', import.meta.url);
mkdirSync(target, { recursive: true });
const migrations = readdirSync(source).filter(name => name.endsWith('.sql')).sort().map(name => {
  // Match Python text mode: checksums must not depend on Git CRLF conversion.
  const sql = readFileSync(new URL(name, source), 'utf8').replace(/\r\n/g, '\n');
  return { id: name.replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
writeFileSync(fileURLToPath(new URL('migrations.json', target)), JSON.stringify(migrations, null, 2) + '\n');
