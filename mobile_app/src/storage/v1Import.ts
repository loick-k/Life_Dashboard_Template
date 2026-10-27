import type { QueryConnection } from './catalogs';
import { convertV1, type V1Plan } from './v1Convert.ts';
import { canonical, type V1Crypto } from './v1Format.ts';
import { Preferences } from './preferences.ts';

export class V1ImportConflict extends Error {}

export interface V1ImportReport {
  fingerprint: string; sourceCounts: V1Plan['sourceCounts']; warnings: Record<string, number>; excludedSettings: number;
  insertedRecords: number; archivedSourceRows: number; unchangedUnits: number; dryRun: boolean;
}

/** Same validation/SQL for preview and commit. No silent merge of an already imported day. */
export async function importV1(database: QueryConnection, raw: string, crypto: V1Crypto, options: { dryRun: boolean; expectedFingerprint?: string }): Promise<V1ImportReport> {
  const plan = await convertV1(raw, crypto);
  if (options.expectedFingerprint && options.expectedFingerprint !== plan.fingerprint) throw new Error('Le fichier a changé depuis la prévisualisation.');
  await database.execAsync('BEGIN IMMEDIATE');
  try {
    const unchanged = new Set<string>();
    let archived = 0, inserted = 0;
    for (const item of plan.archive) {
      const previous = await database.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM v1_import_archive WHERE source_id = ? AND source_table = ? AND source_row_key = ?', plan.sourceId, item.table, item.key);
      if (previous) {
        if (previous.payload_json !== item.payload) throw new V1ImportConflict(`Conflit avec un import précédent (${item.table}) : aucune mise à jour automatique n’est appliquée.`);
        unchanged.add(`${item.table}:${item.key}`);
      }
    }
    await database.runAsync('INSERT INTO v1_import_runs (source_id, payload_sha256, imported_at) VALUES (?, ?, ?) ON CONFLICT(source_id) DO NOTHING', plan.sourceId, plan.fingerprint, new Date().toISOString());
    for (const record of plan.records) {
      if (unchanged.has(record.unit)) continue;
      const columns = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${record.table})`);
      if (Object.keys(record.values).some(key => !columns.some(column => column.name === key))) throw new Error('Colonne cible incompatible.');
      if (record.table === 'daily_entries') {
        if (await database.getFirstAsync('SELECT 1 FROM daily_entries WHERE entry_date = ?', record.values.entry_date!)) throw new V1ImportConflict('Une journée V2 est déjà présente : import annulé sans écrasement.');
      }
      if (record.table === 'settings') {
        const existing = await database.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', record.values.key!);
        if (existing) {
          const oldState = JSON.parse(existing.value), next = JSON.parse(String(record.values.value));
          const same = oldState.version === 1 && (String(record.values.key).startsWith('preference.v1:')
            ? canonical(oldState.value) === canonical(next.value) : oldState.step === next.step);
          if (!same) throw new V1ImportConflict('Un réglage V2 existe avec une valeur différente : import annulé.');
          continue;
        }
      }
      const names = columns.map(column => column.name).filter(key => Object.hasOwn(record.values, key));
      await database.runAsync(`INSERT INTO ${record.table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, ...names.map(key => record.values[key]!));
      const primary = record.table === 'settings' ? 'key' : record.table === 'daily_entries' ? 'entry_id' : record.table === 'friends' ? 'friend_id'
        : record.table === 'goals' ? 'goal_id' : record.table === 'sport_sessions' ? 'session_id' : record.table === 'social_logs' ? 'social_log_id' : 'goal_log_id';
      const verified = await database.getFirstAsync<Record<string, unknown>>(`SELECT * FROM ${record.table} WHERE ${primary} = ?`, record.values[primary]!);
      if (!verified || names.some(key => verified[key] !== record.values[key])) throw new Error('Valeurs importées non conformes.');
      inserted++;
    }
    for (const item of plan.archive) if (!unchanged.has(`${item.table}:${item.key}`)) {
      await database.runAsync('INSERT INTO v1_import_archive VALUES (?, ?, ?, ?)', plan.sourceId, item.table, item.key, item.payload);
      if (item.table !== '__day') archived++;
    }
    const goals = await database.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM goals WHERE active = 1');
    if (Number(goals?.n) > 3) throw new V1ImportConflict('Plus de trois objectifs actifs : arbitrage nécessaire avant import.');
    const prior = await database.getAllAsync<{ source_table: string; source_row_key: string }>('SELECT source_table, source_row_key FROM v1_import_archive WHERE source_id = ?', plan.sourceId);
    const incoming = new Set(plan.archive.map(item => canonical([item.table, item.key])));
    const retained = prior.filter(item => item.source_table !== '__day' && !incoming.has(canonical([item.source_table, item.source_row_key]))).length;
    if (retained) plan.warnings.earlier_source_rows_retained = retained;
    await new Preferences(database).readAll();
    if (await database.getFirstAsync('PRAGMA foreign_key_check')) throw new Error('Relation V1 manquante.');
    const integrity = await database.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    if (integrity?.integrity_check !== 'ok') throw new Error('Vérification SQLite échouée.');
    if (archived) await database.runAsync('UPDATE v1_import_runs SET payload_sha256 = ?, imported_at = ? WHERE source_id = ?', plan.fingerprint, new Date().toISOString(), plan.sourceId);
    await database.execAsync(options.dryRun ? 'ROLLBACK' : 'COMMIT');
    return { fingerprint: plan.fingerprint, sourceCounts: plan.sourceCounts, warnings: plan.warnings, excludedSettings: plan.excludedSettings,
      insertedRecords: inserted, archivedSourceRows: archived, unchangedUnits: unchanged.size, dryRun: options.dryRun };
  } catch (error) { await database.execAsync('ROLLBACK'); throw error; }
}
