import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { OnboardingProgress, onboardingSteps, type OnboardingState } from '../storage/onboarding';
import { Preferences } from '../storage/preferences';
import { preferenceDefinitions } from '../domain/preferences';
import { PreferencesForm } from './PreferencesForm';
import { BackupScreen } from './BackupScreen';
import { V1ImportScreen } from './V1ImportScreen';
import { ProtectionScreen } from './ProtectionScreen';
import { keyProtection } from '../storage/nativeProtection';

const titles = ['Bienvenue', 'Tes données', 'Tes préférences', 'Protection du téléphone', 'Sauvegarde', 'Services facultatifs', 'Vérifier et commencer'];
const choices = { empty: 'Démarrage à vide', existing: 'Données de cet appareil conservées', 'import-v1': 'Import V1', 'restore-v2': 'Sauvegarde V2 restaurée' };

/** Development route: operations not yet implemented remain explicit and cannot fake success. */
export function OnboardingScreen({ database, onDone }: { database: QueryConnection; onDone(): void }) {
  const repository = useMemo(() => new OnboardingProgress(database), [database]);
  const [state, setState] = useState<OnboardingState>();
  const [hasData, setHasData] = useState(false);
  const [route, setRoute] = useState<'steps' | 'restore' | 'backup' | 'import' | 'protection'>('steps');
  const [summary, setSummary] = useState<{ settings: string[]; backup: string | null; protected: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.all([repository.read(), database.getFirstAsync<{ n: number }>(
      'SELECT (SELECT count(*) FROM daily_entries) + (SELECT count(*) FROM friends) + (SELECT count(*) FROM goals) AS n')]).then(([progress, count]) => {
      if (active) { setState(progress); setHasData((count?.n ?? 0) > 0); }
    }, () => { if (active) setError('Configuration illisible. Les données sont conservées.'); });
    return () => { active = false; };
  }, [repository, database, attempt]);
  useEffect(() => {
    if (state?.step !== 'review') return;
    let active = true;
    setSummary(undefined);
    Promise.all([new Preferences(database).readAll(), database.getFirstAsync<{ created_at: string }>(
      "SELECT created_at FROM backup_history WHERE status = 'verified' ORDER BY created_at DESC LIMIT 1"), keyProtection.mode()]).then(([settings, backup, mode]) => {
      if (active) setSummary({ settings: preferenceDefinitions.map(item => `${item.label} : ${settings[item.key].value ?? 'Non renseigné'}`), backup: backup?.created_at ?? null, protected: mode !== 'device' });
    }, () => { if (active) setError('Impossible de relire les choix. Réessaie avant de terminer.'); });
    return () => { active = false; };
  }, [database, state?.step, attempt]);

  async function act(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await action(); }
    catch { setError('Opération non confirmée. Réessaie ou recharge la configuration.'); }
    finally { working.current = false; setBusy(false); }
  }
  const index = state ? onboardingSteps.indexOf(state.step) : 0;
  const move = (offset: number) => act(async () => {
    if (!state || !onboardingSteps[index + offset]) return;
    setState(await repository.move(state.revision, onboardingSteps[index + offset]!));
  });
  const choose = (choice: 'empty' | 'existing') => void act(async () => {
    // Query again immediately before choosing; this never clears existing data.
    const count = await database.getFirstAsync<{ n: number }>('SELECT (SELECT count(*) FROM daily_entries) + (SELECT count(*) FROM friends) + (SELECT count(*) FROM goals) AS n');
    if (choice === 'empty' && count?.n) { setHasData(true); setError('Des données existent déjà. Choisis de les conserver ou de restaurer un fichier.'); return; }
    setState(await repository.chooseData(state!.revision, choice));
  });
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (working.current) return true;
      // Nested editors own Back: they must flush or finish an in-flight restore first.
      if (route !== 'steps' || state?.step === 'preferences') return false;
      if (index > 0 && !state?.completed) void move(-1);
      else return false;
      return true;
    });
    return () => listener.remove();
  });

  if (route === 'restore') return <BackupScreen database={database} restoreOnly onDone={() => setRoute('steps')} onRestored={async () => {
    const current = await repository.read();
    const chosen = await repository.chooseData(current.revision, 'restore-v2');
    setState(await repository.move(chosen.revision, 'preferences')); setHasData(true); setRoute('steps');
  }} />;
  if (route === 'backup') return <BackupScreen database={database} onDone={() => setRoute('steps')} />;
  if (route === 'protection') return <ProtectionScreen onDone={() => setRoute('steps')} />;
  if (route === 'import') return <V1ImportScreen database={database} onDone={() => setRoute('steps')} onImported={async () => {
    const current = await repository.read();
    const chosen = await repository.chooseData(current.revision, 'import-v1');
    setState(await repository.move(chosen.revision, 'preferences')); setHasData(true); setRoute('steps');
  }} />;
  if (state?.step === 'preferences' && !state.completed) return <View style={{ flex: 1 }}>
    {!!error && <Text accessibilityRole="alert" style={[styles.error, { padding: 16 }]}>{error}</Text>}
    <PreferencesForm database={database} doneLabel="Continuer →" onDone={() => move(1)} onBack={() => move(-1)} />
  </View>;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>🌱 Life Dashboard</Text>
    <Text style={styles.notice}>Version d’essai · utilise des données fictives pendant les vérifications Android.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!state ? <>
      <Text>Chargement de la configuration…</Text>
      {!!error && <Pressable style={styles.secondary} onPress={() => { setError(''); setAttempt(n => n + 1); }}><Text>Réessayer</Text></Pressable>}
    </> : state.completed ? <>
      <Text>La configuration est terminée. Tes choix restent accessibles dans Réglages.</Text>
      <Pressable accessibilityRole="button" style={styles.primary} onPress={onDone}><Text style={styles.white}>Ouvrir mon point quotidien</Text></Pressable>
    </> : <>
      <Text accessibilityLiveRegion="polite">Première utilisation · {index + 1}/{onboardingSteps.length}</Text>
      <View style={styles.progress}><View style={[styles.fill, { width: `${(index + 1) / onboardingSteps.length * 100}%` }]} /></View>
      <Text style={styles.heading}>{titles[index]}</Text>
      {state.step === 'welcome' && <>
        <Text style={styles.text}>Ton suivi quotidien et tes bilans sont enregistrés sur ce téléphone. Tu peux les utiliser sans connexion Internet ni compte Google.</Text>
        <Text style={styles.text}>Une sauvegarde chiffrée et son code de récupération te permettront de retrouver ton historique si tu changes de téléphone.</Text>
      </>}
      {state.step === 'data' && <>
        <Text style={styles.text}>Choisis les données de départ. Cette étape ne supprime aucune donnée automatiquement.</Text>
        <Pressable accessibilityRole="button" disabled={busy || hasData} style={[styles.secondary, hasData && styles.disabled]} onPress={() => choose('empty')}><Text>Démarrer à vide{hasData ? ' · données déjà présentes' : ''}</Text></Pressable>
        {hasData && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => choose('existing')}><Text>Conserver les données de cet appareil</Text></Pressable>}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => setRoute('restore')}><Text>Restaurer une sauvegarde V2</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => setRoute('import')}><Text>Importer un export V1</Text></Pressable>
        <Text>Choix enregistré : {state.dataChoice ? choices[state.dataChoice] : 'À choisir'}</Text>
      </>}
      {state.step === 'protection' && <>
        <Text style={styles.text}>La base locale est chiffrée et sa clé est conservée dans le stockage sécurisé Android. Active un code ou une biométrie pour déverrouiller ton téléphone.</Text>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setRoute('protection')}><Text>Configurer la protection biométrique</Text></Pressable>
        <Text style={styles.text}>Facultative et propre à cet appareil. Crée d’abord une sauvegarde chiffrée si tu as déjà des données.</Text>
      </>}
      {state.step === 'backup' && <>
        <Text style={styles.text}>Crée une première sauvegarde et conserve son code dans ton gestionnaire de mots de passe. Garde une copie du fichier hors de ce téléphone.</Text>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => setRoute('backup')}><Text>Créer ma sauvegarde chiffrée</Text></Pressable>
        <Text style={styles.text}>Tu peux la configurer plus tard dans Réglages. Tant qu’aucune sauvegarde n’existe, perdre le téléphone peut faire perdre cet historique.</Text>
      </>}
      {state.step === 'integrations' && <>
        <Text style={styles.text}>Todoist et l’analyse nutritionnelle utilisent Internet et restent facultatifs. Les connexions sont désactivées dans cette version d’essai ; leurs écrans de configuration sont en préparation.</Text>
        <Text>Le suivi local fonctionne sans secret ni service externe.</Text>
      </>}
      {state.step === 'review' && <>
        <Text>Données : {state.dataChoice ? choices[state.dataChoice] : 'À choisir'}</Text>
        <Text>Protection : chiffrement local{summary?.protected ? ' et biométrie de l’application' : ' et verrouillage du téléphone'}.</Text>
        <Text>Services externes : désactivés.</Text>
        {summary ? <>
          <Text>Sauvegarde vérifiée : {summary.backup ? new Date(summary.backup).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : 'Aucune sur cet appareil'}</Text>
          {summary.settings.map(line => <Text key={line} style={styles.text}>{line}</Text>)}
        </> : <Text>Relecture des réglages…</Text>}
      </>}
      <View style={styles.actions}>
        {index > 0 && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => move(-1)}><Text>← Retour</Text></Pressable>}
        {['backup', 'integrations'].includes(state.step) && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => move(1)}><Text>Passer pour le moment</Text></Pressable>}
        <Pressable accessibilityRole="button" disabled={busy || (state.step === 'data' && !state.dataChoice) || (state.step === 'review' && !summary)}
          style={styles.primary} onPress={() => state.step === 'review' ? void act(async () => { setState(await repository.finish(state.revision)); onDone(); }) : move(1)}><Text style={styles.white}>{state.step === 'review' ? 'Ouvrir mon tableau de bord' : 'Continuer →'}</Text></Pressable>
      </View>
      {!!error && <Pressable style={styles.secondary} disabled={busy} onPress={() => { setError(''); setAttempt(n => n + 1); }}><Text>Recharger la configuration enregistrée</Text></Pressable>}
    </>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 20, paddingTop: 48, paddingBottom: 40, gap: 16, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', color: '#31333f' }, heading: { fontSize: 23, fontWeight: '600', color: '#31333f' },
  text: { color: '#626570', fontSize: 16, lineHeight: 24 }, notice: { color: '#895000', lineHeight: 22 }, error: { color: '#b42318' },
  progress: { height: 8, backgroundColor: '#e6e8ed', borderRadius: 4 }, fill: { height: 8, backgroundColor: '#ff4b4b', borderRadius: 4 },
  actions: { gap: 12 }, primary: { minHeight: 48, backgroundColor: '#ff4b4b', padding: 14, borderRadius: 10, alignItems: 'center' },
  secondary: { minHeight: 48, borderWidth: 1, borderColor: '#d5d6dc', padding: 14, borderRadius: 10, justifyContent: 'center' },
  white: { color: '#fff', fontSize: 16, fontWeight: '600' }, disabled: { opacity: 0.5 },
});
