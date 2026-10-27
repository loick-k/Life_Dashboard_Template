import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { File } from 'expo-file-system';
import type { QueryConnection } from '../storage/catalogs';
import { importV1, V1ImportConflict, type V1ImportReport } from '../storage/v1Import';
import { nativeBackupCrypto } from '../storage/nativeBackupCrypto';

const warningLabels: Record<string, string> = {
  rounded_minutes: 'Durées arrondies à la minute (valeurs originales archivées)',
  timestamp_export_fallback: 'Horodatages techniques absents/sans fuseau : date de l’export utilisée, source archivée',
  legacy_waist_archived: 'Anciennes mesures de taille distinctes conservées en archive',
  work_duration_disagreement_archived: 'Durées de travail conservées selon la valeur V1, malgré une différence avec les horaires',
  progress_inferred: 'Progressions déduites des champs renseignés', legacy_sport_session_created: 'Séances créées depuis les anciens totaux sportifs',
  todo_categories_archived: 'Anciennes catégories de tâches archivées', todo_items_archived: 'Anciennes tâches archivées',
  api_usage_logs_archived: 'Journaux de consommation API archivés', schema_migrations_archived: 'Journal V1 conservé en archive',
  sport_summary_archived: 'Anciens totaux sportifs différents des séances : détails utilisés, totaux archivés',
  social_context_defaulted: 'Contexte social absent : valeur standard utilisée, source archivée',
  legacy_default_flags: 'État actif absent : valeur standard V1 utilisée, source archivée',
  earlier_source_rows_retained: 'Anciennes lignes absentes du nouvel export conservées depuis le précédent import',
};
export function V1ImportScreen({ database, onDone, onImported, beforeImport }: { database: QueryConnection; onDone(): void; onImported?(): Promise<void>; beforeImport?(): Promise<void> }) {
  const raw = useRef('');
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<V1ImportReport>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const done = () => { if (!working.current) { raw.current = ''; onDone(); } };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { done(); return true; });
    return () => subscription.remove();
  });
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (issue) { setError(issue instanceof V1ImportConflict ? issue.message : 'Import refusé : fichier incompatible ou données invalides. Aucune donnée existante n’a été écrasée.'); }
    finally { working.current = false; setBusy(false); }
  }
  const select = () => void run(async () => {
    if (beforeImport) await beforeImport();
    setReport(undefined); raw.current = '';
    const picked = await File.pickFileAsync({ mimeTypes: ['application/json', '*/*'] });
    if (picked.canceled || !picked.result) return;
    if (picked.result.size < 1 || picked.result.size > 8 * 1024 * 1024) throw new Error('Export trop volumineux.');
    const content = await picked.result.text();
    const preview = await importV1(database, content, nativeBackupCrypto, { dryRun: true });
    raw.current = content; setReport(preview);
  });
  const apply = () => void run(async () => {
    if (!report?.dryRun || !raw.current) return;
    const confirmed = await new Promise<boolean>(resolve => Alert.alert('Importer les données V1 ?',
      'Les nouvelles journées et leurs relations seront ajoutées. Les données déjà importées resteront inchangées. Les historiques signalés seront conservés dans une archive locale incluse dans les sauvegardes V2.',
      [{ text: 'Annuler', style: 'cancel', onPress: () => resolve(false) }, { text: 'Importer', onPress: () => resolve(true) }], { cancelable: false }));
    if (!confirmed) return;
    if (beforeImport) await beforeImport();
    const result = await importV1(database, raw.current, nativeBackupCrypto, { dryRun: false, expectedFingerprint: report.fingerprint });
    setReport(result); raw.current = ''; setMessage('Import vérifié et enregistré. Crée maintenant une sauvegarde V2 chiffrée.');
    if (onImported) try { await onImported(); } catch { setError('Les données ont bien été importées. Recharge la configuration initiale pour continuer.'); }
  });
  return <ScrollView contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>Importer depuis la V1</Text>
    <Text style={styles.text}>Sélectionne le fichier .ldv1.json préparé depuis un instantané V1 avec l’outil du projet. Ce fichier contient des données personnelles en clair : conserve-le dans un emplacement privé.</Text>
    <Text style={styles.text}>Une simulation vérifie les valeurs, les relations et les collisions avant confirmation. Une journée V2 existante ou une ligne V1 modifiée depuis un précédent import bloque l’opération. Aucun accès à Neon n’est nécessaire.</Text>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={select}><Text>Choisir et vérifier un export V1</Text></Pressable>
    {busy && <Text accessibilityLiveRegion="polite">Vérification en cours…</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>{error}</Text>}
    {!!message && <Text accessibilityLiveRegion="polite">{message}</Text>}
    {report && <>
      <Text style={styles.heading}>{report.dryRun ? 'Simulation réussie' : 'Import enregistré'}</Text>
      {Object.entries(report.sourceCounts).map(([table, count]) => <Text key={table}>{table} : {count} ligne(s) source</Text>)}
      <Text>{report.insertedRecords} ligne(s) applicatives à ajouter / ajoutées.</Text>
      <Text>{report.archivedSourceRows} ligne(s) source à archiver / archivées ; {report.unchangedUnits} éléments source déjà connus.</Text>
      <Text>Réglages non reconnus exclus : {report.excludedSettings}.</Text>
      {Object.entries(report.warnings).map(([key, count]) => <Text key={key} style={styles.text}>{warningLabels[key] ?? key} : {count}</Text>)}
      <Text style={styles.text}>Les archives conservent les valeurs originales. Les anciennes tâches et journaux techniques n’alimentent pas les écrans métier V2 à ce stade.</Text>
      {report.dryRun && <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={apply}><Text style={{ color: '#fff' }}>Confirmer l’import</Text></Pressable>}
    </>}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={done}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 48, paddingBottom: 40, gap: 14, backgroundColor: '#fff', flexGrow: 1 },
  title: { color: '#31333f', fontSize: 27, fontWeight: '700' }, heading: { color: '#31333f', fontSize: 20, fontWeight: '600' },
  text: { color: '#626570', lineHeight: 23 }, secondary: { minHeight: 48, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d5d6dc', justifyContent: 'center' },
  primary: { minHeight: 48, backgroundColor: '#ff4b4b', borderRadius: 10, padding: 14, alignItems: 'center' },
});
