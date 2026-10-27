import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { preferenceDefinitions, validatePreference, type PreferenceKey, type PreferenceValue } from '../domain/preferences';
import { Preferences, type PreferenceState } from '../storage/preferences';
import { WriteQueue } from '../storage/writeQueue';
import type { SqlConnection } from '../storage/migrations';
import type { EditorHandle } from './editorHandle';
import { settleWrites } from '../storage/settleWrites';
import { palette } from './palette';
import { preferenceBuffers } from '../storage/preferenceBuffers';
import type { BufferedEditor } from '../storage/bufferedEditor';
import { PreferenceConflictReview, type PreferenceReview } from './PreferenceConflictReview';

type Draft = WriteQueue<PreferenceState, { value: PreferenceValue }>;
const criteriaHelp: Partial<Record<PreferenceKey, string>> = {
  sleep_min_hours: 'Cible du score sommeil : minimum à minimum + 2 h. 0 désactive ce critère ; les mesures restent visibles.',
  phone_max_hours: 'Maximum utilisé par le score portable. 0 signifie un maximum strict de zéro, pas une valeur par défaut.',
  sport_weekly_goal_hours: 'Objectif utilisé par l’évaluation hebdomadaire. 0 désactive ce critère, pas le suivi des séances.',
  social_weekly_goal_days: 'Nombre de jours distincts avec interaction dans l’évaluation. 0 désactive cet objectif.',
  work_weekly_target_hours: 'Objectif hebdomadaire pour bilan et score ; 0 désactive le score travail. Le compteur journalier reste basé sur 7 h 42.',
  work_days_per_week: 'Référence du nombre de jours renseignés dans Travail · suivi. Sans effet sur le compteur cumulé de 7 h 42 par journée travaillée.',
  tobacco_stop_date: 'Date de départ du suivi sans tabac. Une date future ne produit pas encore de score.',
};
export const PreferencesForm = forwardRef<EditorHandle, { database: SqlConnection; active?: boolean; preserveOnNavigate?: boolean; onDone(): void | Promise<void>; onBackup?(): void | Promise<void>; onImport?(): void | Promise<void>; onProtection?(): void | Promise<void>; onFriends?(): void | Promise<void>; onGoals?(): void | Promise<void>; onBack?(): void | Promise<void>; doneLabel?: string }>(function PreferencesForm({ database, active = true, preserveOnNavigate = false, onDone, onBackup, onImport, onProtection, onFriends, onGoals, onBack, doneLabel = 'Retour' }, ref) {
  const repository = useMemo(() => new Preferences(database), [database]);
  const drafts = useRef<Partial<Record<PreferenceKey, Draft>>>({});
  const journals = useRef<Partial<Record<PreferenceKey, BufferedEditor<'value'>>>>({});
  const loading = useRef<Promise<void>>(Promise.resolve()), operation = useRef<Promise<void> | null>(null);
  const review = useRef<PreferenceReview | undefined>(undefined);
  const invalid = useRef(new Set<PreferenceKey>());
  const leaving = useRef(false);
  const [ready, setReady] = useState(false);
  const [raw, setRaw] = useState<Partial<Record<PreferenceKey, string>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [, refresh] = useState(0);
  const makeDraft = (key: PreferenceKey, row: PreferenceState) => new WriteQueue<PreferenceState, { value: PreferenceValue }>(row,
    patch => ({ value: validatePreference(key, patch.value) }), (current, patch) => repository.set(key, current.revision, patch.value));
  useEffect(() => {
    let active = true;
    setError('');
    loading.current = (async () => {
      try {
        const values = await repository.readAll();
        const results = await Promise.allSettled(preferenceDefinitions.map(async ({ key }) => {
          const journal = preferenceBuffers(database, key, Crypto.randomUUID, issue => {
            if (issue === 'storage') setError('Conservation du brouillon de réglage non confirmée. Garde cet écran ouvert et réessaie.');
            if (issue === 'business') setError('Sauvegarde non confirmée. Le brouillon du réglage est conservé ; compare les valeurs.');
            refresh(n => n + 1);
          });
          const records = await journal.read({ value: values[key].value }); return { key, journal, record: records.value };
        }));
        if (results.some(result => result.status === 'rejected')) throw new Error('Brouillons illisibles');
        if (!active) return;
        const nextRaw: Partial<Record<PreferenceKey, string>> = {}; invalid.current.clear();
        for (const result of results) if (result.status === 'fulfilled') {
          const { key, journal, record } = result.value; journals.current[key] = journal; drafts.current[key] = makeDraft(key, values[key]);
          if (record && 'value' in record.raw) nextRaw[key] = record.raw.value;
          if (journal.invalid.size) invalid.current.add(key);
        }
        setRaw(nextRaw); setReady(true);
      } catch { if (active) setError('Lecture des réglages impossible. Aucun réglage ni brouillon remplacé.'); }
    })();
    return () => { active = false; };
  }, [repository, loadAttempt]);
  const settle = async () => {
    await loading.current; if (operation.current) await operation.current;
    await settleWrites(Object.values(journals.current).map(journal => journal.settle()));
    await settleWrites(Object.values(drafts.current).map(draft => draft.flush()));
    await settleWrites(Object.values(journals.current).map(journal => journal.settle()));
  };
  useImperativeHandle(ref, () => ({
    settle,
    hasUnconfirmed: () => invalid.current.size > 0 || !!operation.current || !!review.current || Object.values(journals.current).some(journal => journal.hasUnconfirmed()) || Object.values(drafts.current).some(draft => draft.status !== 'saved'),
    beforeReplace: async () => {
      if (leaving.current || invalid.current.size) throw new Error('Réglages à terminer');
      await settle();
      if (invalid.current.size || review.current || Object.values(journals.current).some(journal => journal.hasUnconfirmed())) throw new Error('Réglages à terminer');
    },
  }));

  async function done(action = onDone) {
    if (leaving.current) return;
    if (!preserveOnNavigate && invalid.current.size) { setError('Complétez les champs signalés, ou rétablissez leur valeur enregistrée.'); return; }
    leaving.current = true; setBusy(true);
    try {
      try { await settle(); } catch (error) { if (!preserveOnNavigate) throw error; }
      if (!preserveOnNavigate && (invalid.current.size || review.current || Object.values(journals.current).some(journal => journal.hasUnconfirmed()))) throw new Error('Brouillon à terminer');
      await action();
    } catch { setError('Sauvegarde non confirmée. Vos saisies restent affichées ; réessayez avant de quitter.'); }
    finally { leaving.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { void done(onBack ?? onDone); return true; });
    return () => listener.remove();
  });

  const locked = (key: PreferenceKey) => leaving.current || !active || !!review.current || !!journals.current[key]?.needsComparison();
  function saveRaw(key: PreferenceKey, text: string, clear = false) {
    const draft = drafts.current[key], journal = journals.current[key];
    if (!draft || !journal || locked(key)) return;
    try {
      void journal.submit({ value: { raw: { value: text }, clear } }, async patch => { draft.edit({ value: validatePreference(key, patch.value) }); refresh(n => n + 1); await draft.flush(); return draft.snapshot; });
      if (journal.invalid.size) invalid.current.add(key); else invalid.current.delete(key);
      setError(''); refresh(n => n + 1);
    } catch { invalid.current.add(key); setError('Saisie de réglage incompatible. Les valeurs enregistrées sont conservées.'); }
  }
  function edit(key: PreferenceKey, text: string) {
    if (locked(key)) return;
    setRaw(current => ({ ...current, [key]: text }));
    saveRaw(key, text);
  }
  function clear(key: PreferenceKey) {
    Alert.alert('Effacer ce réglage facultatif ?', 'Les autres réglages et vos mesures sont conservés.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Effacer', style: 'destructive', onPress: () => { if (!locked(key)) { setRaw(current => ({ ...current, [key]: '' })); saveRaw(key, '', true); } } },
    ]);
  }
  async function retry(key: PreferenceKey) {
    if (locked(key) || drafts.current[key]?.status !== 'failed') return;
    const operation = drafts.current[key]!.retry(); refresh(n => n + 1);
    try { await operation; setError(''); await journals.current[key]?.resolved(drafts.current[key]!.snapshot, []); }
    catch { setError('Échec persistant ou modification concurrente. La saisie reste conservée ; aucun écrasement forcé.'); }
    refresh(n => n + 1);
  }
  function run(action: () => Promise<void>) {
    if (leaving.current) return;
    leaving.current = true; setBusy(true);
    operation.current = Promise.resolve().then(action).catch(() => setError('Opération non confirmée ou réglage modifié depuis la comparaison. Le brouillon reste conservé ; relis les valeurs.'))
      .finally(() => { operation.current = null; leaving.current = false; setBusy(false); refresh(n => n + 1); });
  }
  function compare(key: PreferenceKey) {
    run(async () => {
      await journals.current[key]?.settle();
      const recovered = journals.current[key]?.recovered;
      const pending = recovered && Object.hasOwn(recovered, 'value') ? recovered.value : drafts.current[key]?.pendingPatch.value;
      if (pending === undefined) throw new Error('Aucun brouillon valide');
      review.current = { key, latest: await repository.read(key), pending }; setError('');
    });
  }
  function applyReview() {
    const current = review.current; if (!current?.choice) return;
    run(async () => {
      const state = current.choice === 'draft' ? await repository.set(current.key, current.latest.revision, current.pending) : await repository.read(current.key);
      if (current.choice === 'database' && state.revision !== current.latest.revision) throw new Error('Réglage encore modifié');
      drafts.current[current.key] = makeDraft(current.key, state); invalid.current.delete(current.key);
      setRaw(raw => ({ ...raw, [current.key]: String(state.value ?? '') })); review.current = undefined; setError('Choix enregistré pour ce seul réglage.');
      await journals.current[current.key]?.resolved(state, current.choice === 'database' ? ['value'] : []);
    });
  }
  function reload(key: PreferenceKey) {
    Alert.alert('Recharger ce réglage ?', 'Seul le brouillon non enregistré de ce champ sera abandonné. La valeur réellement enregistrée sera relue.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Recharger', style: 'destructive', onPress: () => {
        if (leaving.current || review.current) return;
        run(async () => {
          await journals.current[key]?.settle();
          const state = await repository.read(key);
          drafts.current[key] = makeDraft(key, state);
          invalid.current.delete(key);
          setRaw(current => ({ ...current, [key]: String(state.value ?? '') })); setError('');
          await journals.current[key]?.resolved(state, ['value']);
        });
      } },
    ]);
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>Réglages</Text>
    <Text style={styles.help}>Enregistrement local automatique. Unités : kg, cm, km et heures. Les secrets des intégrations ne sont pas stockés ici.</Text>
    {onFriends && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void done(onFriends)}><Text>Gérer les personnes suivies</Text></Pressable>}
    {onGoals && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void done(onGoals)}><Text>Gérer mes objectifs</Text></Pressable>}
    {onBackup && <Pressable accessibilityRole="button" disabled={busy || (!ready && !preserveOnNavigate)} style={styles.secondary} onPress={() => void done(onBackup)}><Text>Sauvegarde et récupération</Text></Pressable>}
    {onImport && <Pressable accessibilityRole="button" disabled={busy || !ready} style={styles.secondary} onPress={() => void done(onImport)}><Text>Importer un export V1</Text></Pressable>}
    {onProtection && <Pressable accessibilityRole="button" disabled={busy || !ready} style={styles.secondary} onPress={() => void done(onProtection)}><Text>Protection biométrique</Text></Pressable>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!ready && !!error && <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setLoadAttempt(value => value + 1)}><Text>Réessayer le chargement des réglages</Text></Pressable>}
    {!ready && !error && <Text>Chargement…</Text>}
    {ready && preferenceDefinitions.map(definition => {
      const { key, label, kind } = definition;
      const draft = drafts.current[key]!;
      const journal = journals.current[key];
      return <View style={styles.card} key={key}>
        <Text style={styles.label}>{label}</Text>
        {journal?.restored && <Text style={styles.help}>Brouillon retrouvé sur cet appareil ; les valeurs non confirmées ne sont pas appliquées automatiquement.</Text>}
        <TextInput accessibilityLabel={label} style={styles.input} editable={!busy && !locked(key)}
          keyboardType={kind === 'number' ? 'decimal-pad' : 'default'} autoCorrect={false}
          value={raw[key] ?? String(draft.snapshot.value ?? '')} onChangeText={text => edit(key, text)} />
        {criteriaHelp[key] && <Text style={styles.help}>{criteriaHelp[key]}</Text>}
        {invalid.current.has(key) ? <>
          <Text style={styles.error}>Saisie incomplète ou hors limites — non enregistrée.</Text>
          <Pressable accessibilityRole="button" disabled={busy || locked(key)} style={styles.secondary} onPress={() => {
            const value = draft.snapshot.value; setRaw(current => ({ ...current, [key]: String(value ?? '') })); saveRaw(key, String(value ?? ''), value === null);
          }}><Text>Rétablir la dernière saisie valide</Text></Pressable>
        </> : <Text accessibilityLiveRegion="polite" style={styles.help}>{journal?.storageFailed() ? 'Conservation du brouillon non confirmée' : journal?.needsComparison() ? 'Brouillon retrouvé à comparer' : draft.status === 'saving' || journal?.isWorking() ? 'Enregistrement…' : draft.status === 'failed' ? 'Non enregistré' : draft.snapshot.revision === 0 ? 'Valeur par défaut' : 'Enregistré sur cet appareil'}</Text>}
        {journal?.storageFailed() && <Pressable accessibilityRole="button" disabled={busy || !!review.current} style={styles.secondary} onPress={() => { void journal.retry().then(() => { if (!journal.storageFailed() && draft.status === 'saved') setError(''); refresh(n => n + 1); }); }}><Text>Réessayer la conservation de {label}</Text></Pressable>}
        {draft.status === 'failed' && <>
          <Pressable accessibilityRole="button" disabled={busy || locked(key)} style={styles.secondary} onPress={() => void retry(key)}><Text>Réessayer la sauvegarde</Text></Pressable>
        </>}
        {(draft.status === 'failed' || journal?.needsComparison()) && <>
          <Pressable accessibilityRole="button" disabled={busy || !!review.current} style={styles.secondary} onPress={() => compare(key)}><Text>Comparer {label}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy || !!review.current} style={styles.secondary} onPress={() => reload(key)}><Text>Recharger la valeur enregistrée</Text></Pressable>
        </>}
        {review.current?.key === key && <PreferenceConflictReview review={review.current} label={label} busy={busy} onChoice={choice => { if (!leaving.current && review.current) { review.current = { ...review.current, choice }; refresh(n => n + 1); } }} onApply={applyReview} onReload={() => compare(key)} onClose={() => { if (!leaving.current) { review.current = undefined; refresh(n => n + 1); } }} />}
        {'optional' in definition && <Pressable accessibilityRole="button" disabled={busy || locked(key)} style={styles.secondary} onPress={() => clear(key)}><Text>Effacer ce réglage</Text></Pressable>}
      </View>;
    })}
    {onBack && <Pressable accessibilityRole="button" disabled={busy || !ready} style={styles.secondary} onPress={() => void done(onBack)}><Text>← Retour</Text></Pressable>}
    <Pressable accessibilityRole="button" disabled={busy || (!!onBack && !ready)} style={styles.button} onPress={() => void done()}><Text style={styles.buttonText}>{doneLabel}</Text></Pressable>
  </ScrollView>;
});
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' }, content: { padding: 20, paddingTop: 48, paddingBottom: 40, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#31333f' }, help: { color: '#626570', lineHeight: 22 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#d5d6dc', gap: 8 },
  label: { color: '#31333f', fontSize: 16 }, input: { padding: 12, minHeight: 48, borderRadius: 8, backgroundColor: '#f0f2f6', color: '#31333f' },
  error: { color: '#b42318' }, secondary: { minHeight: 48, justifyContent: 'center' },
  button: { minHeight: 48, backgroundColor: palette.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
