import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve, basename, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, parseV1Bundle, v1Tables } from '../src/storage/v1Format.ts';

const args = process.argv.slice(2);
const argument = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
try {
  const input = argument('--snapshot'), output = argument('--output'), sourceId = argument('--source-id') ?? 'life-dashboard-v1';
  if (!input || !output || !output.endsWith('.ldv1.json')) throw new Error('Usage : --snapshot DOSSIER --output FICHIER.ldv1.json [--source-id IDENTIFIANT_STABLE]');
  const root = realpathSync(resolve(input)), destination = resolve(output);
  const manifestPath = resolve(root, 'manifest.json');
  if (realpathSync(manifestPath) !== manifestPath || statSync(manifestPath).size > 1024 * 1024) throw new Error('Manifeste invalide.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.format_version !== 1 || !manifest.tables || Object.keys(manifest.tables).some(table => !v1Tables.includes(table))) throw new Error('Manifeste V1 incompatible.');
  const sha256 = async value => createHash('sha256').update(value).digest('hex');
  const tables = {};
  for (const table of v1Tables) {
    const metadata = manifest.tables[table];
    if (!metadata || typeof metadata.present !== 'boolean') throw new Error(`Métadonnées manquantes : ${table}.`);
    let rows = [];
    if (metadata.present) {
      if (metadata.file !== `${table}.json` || basename(metadata.file) !== metadata.file) throw new Error('Nom de fichier invalide.');
      const path = realpathSync(resolve(root, metadata.file));
      if (!path.startsWith(root + sep) || dirname(path) !== root || statSync(path).size > 8 * 1024 * 1024) throw new Error('Fichier hors du dossier ou trop volumineux.');
      rows = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(rows) || rows.length !== metadata.rows) throw new Error(`Nombre de lignes incohérent : ${table}.`);
    } else if (metadata.rows !== 0) throw new Error('Métadonnées incohérentes.');
    // Settings not understood by V2 are filtered by the shared parser below.
    tables[table] = { rows, checksum: await sha256(canonical(rows)) };
  }
  const checked = await parseV1Bundle(JSON.stringify({ format: 'life-dashboard-v1-export', version: 1, sourceId, createdAt: manifest.created_at, tables }), { sha256 });
  for (const table of v1Tables) tables[table] = { rows: checked.tables[table], checksum: await sha256(canonical(checked.tables[table])) };
  const bundle = JSON.stringify({ format: 'life-dashboard-v1-export', version: 1, sourceId, createdAt: checked.createdAt, excludedSettings: checked.excludedSettings, tables });
  if (Buffer.byteLength(bundle) > 8 * 1024 * 1024) throw new Error('Export trop volumineux.');
  writeFileSync(destination, bundle, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log('Fichier V1 préparé et vérifié. Il contient des données personnelles en clair : conserve-le dans un emplacement privé, hors Git.');
  console.log(`Réglages non reconnus exclus : ${checked.excludedSettings}. Aucune valeur personnelle affichée.`);
} catch (error) {
  // Never print raw parser/OS errors that can contain personal source fragments.
  console.error('Préparation refusée. Vérifie le dossier, le manifeste, les nombres de lignes et un chemin de sortie inexistant se terminant par .ldv1.json.');
  process.exitCode = 1;
}
