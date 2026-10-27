import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { File } from 'expo-file-system';
import type { QueryConnection } from '../storage/catalogs';
import { nativeBackupEnvironment, readBackupFile } from '../storage/nativeBackups';
import { createBackup, restoreBackup } from '../storage/backupService';
import { recoveryKey } from '../storage/backupFormat';
import migrations from '../storage/generated/migrations.json';

export function BackupScreen({ database, onDone, restoreOnly = false, onRestored, beforeRestore }: { database: QueryConnection; onDone(): void; restoreOnly?: boolean; onRestored?(): Promise<void>; beforeRestore?(): Promise<void> }) {
  const [key, setKey] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [last, setLast] = useState<string>();
  async function loadLast() {
    const row = await database.getFirstAsync<{ created_at: string }>("SELECT created_at FROM backup_history WHERE status = 'verified' ORDER BY created_at DESC LIMIT 1");
    setLast(row?.created_at);
  }
  useEffect(() => { if (!restoreOnly) void loadLast().catch(() => setError('Historique des sauvegardes indisponible.')); }, [database, restoreOnly]);
  const done = () => { if (!working.current) { setKey(''); setConfirmation(''); onDone(); } };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { done(); return true; });
    return () => subscription.remove();
  });
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch { setError('Opération non confirmée : vérifie le fichier, le code et l’accès au dossier. Les données existantes sont conservées en cas d’échec de restauration.'); }
    finally { working.current = false; setBusy(false); }
  }
  const generate = () => void run(async () => {
    setKey(await nativeBackupEnvironment.crypto.randomKey()); setConfirmation(''); setShowKey(true);
    setMessage('Conserve ce code dans ton gestionnaire de mots de passe, séparément du fichier de sauvegarde. Recopie-le ci-dessous avant de sauvegarder.');
  });
  const backup = () => void run(async () => {
    if (recoveryKey(key) !== recoveryKey(confirmation)) { setError('Le code recopié ne correspond pas.'); return; }
    const result = await createBackup(database, migrations, key, nativeBackupEnvironment);
    if (!result) { setMessage('Sauvegarde annulée.'); return; }
    setMessage('Fichier chiffré enregistré, relu et restauration de contrôle réussie. Conserve une copie hors de ce téléphone.');
    setKey(''); setConfirmation(''); setShowKey(false); await loadLast();
  });
  const restore = () => void run(async () => {
    recoveryKey(key);
    const selected = await File.pickFileAsync({ mimeTypes: ['application/octet-stream', 'application/json', '*/*'] });
    if (selected.canceled || !selected.result) { setMessage('Restauration annulée.'); return; }
    const encrypted = await readBackupFile(selected.result);
    const confirmed = await new Promise<boolean>(resolve => Alert.alert('Remplacer les données de cette application ?',
      'Les journées, séances, relations, objectifs et préférences seront remplacés par ceux de ce fichier. Pense à sauvegarder les données actuelles avant de continuer.',
      [{ text: 'Annuler', style: 'cancel', onPress: () => resolve(false) }, { text: 'Restaurer', style: 'destructive', onPress: () => resolve(true) }], { cancelable: false }));
    if (!confirmed) { setMessage('Restauration annulée.'); return; }
    if (beforeRestore) {
      try { await beforeRestore(); }
      catch { setError('Restauration bloquée : un brouillon quotidien ou un réglage n’est pas confirmé. Reviens à la saisie pour le terminer ou résoudre le conflit. Aucun fichier ni brouillon effacé.'); return; }
    }
    const result = await restoreBackup(database, migrations, encrypted, key, nativeBackupEnvironment);
    setMessage(`Restauration vérifiée : ${result.rows} lignes. Les écrans reliront les données restaurées à leur ouverture.`);
    setKey(''); setConfirmation(''); setShowKey(false);
    if (onRestored) {
      try { await onRestored(); }
      catch { setError('Les données ont bien été restaurées. La configuration initiale doit être rechargée avant de continuer.'); }
    }
  });
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>Sauvegarde et récupération</Text>
    <Text style={styles.text}>Tes données sont stockées sur ce téléphone. Une sauvegarde chiffrée et son code de récupération permettent de les restaurer sur un autre appareil.</Text>
    <Text style={styles.text}>Le code est indispensable et ne peut pas être récupéré par l’application. Garde-le dans ton gestionnaire de mots de passe. Les jetons d’intégration et le verrouillage du téléphone sont exclus de la sauvegarde.</Text>
    {!restoreOnly && <>
      <Text>Dernière sauvegarde vérifiée : {last ? new Date(last).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : 'Aucune'}</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={generate}><Text>Générer un code de récupération</Text></Pressable>
    </>}
    <Text>Code de récupération (64 caractères)</Text>
    <TextInput accessibilityLabel="Code de récupération" editable={!busy} value={key} onChangeText={setKey} secureTextEntry={!showKey} autoCapitalize="none" autoCorrect={false} style={styles.input} />
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => setShowKey(value => !value)}><Text>{showKey ? 'Masquer le code' : 'Afficher le code'}</Text></Pressable>
    {!restoreOnly && <>
      <Text>Recopie le code avant de créer une sauvegarde</Text>
      <TextInput accessibilityLabel="Confirmation du code" editable={!busy} value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.input} />
    </>}
    {busy && <Text accessibilityLiveRegion="polite">Vérification en cours… Garde cet écran ouvert.</Text>}
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text>}
    {!!error && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>{error}</Text>}
    {!restoreOnly && <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={backup}><Text style={{ color: '#fff' }}>Créer une sauvegarde chiffrée</Text></Pressable>}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={restore}><Text>Restaurer un fichier avec son code</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={done}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 20, paddingTop: 48, paddingBottom: 40, backgroundColor: '#fff', gap: 14 },
  title: { fontSize: 26, fontWeight: '700', color: '#31333f' }, text: { color: '#626570', lineHeight: 23 },
  input: { minHeight: 48, borderRadius: 8, padding: 12, backgroundColor: '#f0f2f6', color: '#31333f' },
  primary: { minHeight: 48, padding: 14, borderRadius: 10, backgroundColor: '#ff4b4b', alignItems: 'center' },
  secondary: { minHeight: 48, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d5d6dc', justifyContent: 'center' },
});
