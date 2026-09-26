import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { parsePreference, preferenceDefinitions, validatePreference, type PreferenceKey, type PreferenceValue } from '../domain/preferences';
import { Preferences, type PreferenceState } from '../storage/preferences';
import { WriteQueue } from '../storage/writeQueue';
import type { SqlConnection } from '../storage/migrations';

type Draft = WriteQueue<PreferenceState, { value: PreferenceValue }>;
export function PreferencesForm({ database, onDone }: { database: SqlConnection; onDone(): void }) {
  const repository = useMemo(() => new Preferences(database), [database]);
  const drafts = useRef<Partial<Record<PreferenceKey, Draft>>>({});
  const invalid = useRef(new Set<PreferenceKey>());
  const leaving = useRef(false);
  const [ready, setReady] = useState(false);
  const [raw, setRaw] = useState<Partial<Record<PreferenceKey, string>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    repository.readAll().then(values => {
      if (!active) return;
      for (const { key } of preferenceDefinitions) drafts.current[key] = new WriteQueue(values[key],
        patch => ({ value: validatePreference(key, patch.value) }),
        (row, patch) => repository.set(key, row.revision, patch.value));
      setReady(true);
    }, () => { if (active) setError('Lecture des réglages impossible. Aucun réglage remplacé.'); });
    return () => { active = false; };
  }, [repository]);

  async function done() {
    if (leaving.current) return;
    if (invalid.current.size) { setError('Complétez les champs signalés, ou rétablissez leur valeur enregistrée.'); return; }
    leaving.current = true; setBusy(true);
    try {
      await Promise.all(Object.values(drafts.current).map(draft => draft.flush()));
      onDone();
    } catch { setError('Sauvegarde non confirmée. Vos saisies restent affichées ; réessayez avant de quitter.'); }
    finally { leaving.current = false; setBusy(false); }
  }
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { void done(); return true; });
    return () => listener.remove();
  });

  function save(key: PreferenceKey, value: PreferenceValue) {
    const draft = drafts.current[key];
    if (!draft || leaving.current) return;
    invalid.current.delete(key); setError('');
    draft.edit({ value }); refresh(n => n + 1);
    void draft.flush().catch(() => setError('Sauvegarde non confirmée. Aucun écrasement forcé.')).finally(() => refresh(n => n + 1));
  }
  function edit(key: PreferenceKey, text: string) {
    setRaw(current => ({ ...current, [key]: text }));
    try { save(key, parsePreference(key, text)); }
    catch { invalid.current.add(key); refresh(n => n + 1); }
  }
  function clear(key: PreferenceKey) {
    Alert.alert('Effacer ce réglage facultatif ?', 'Les autres réglages et vos mesures sont conservés.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Effacer', style: 'destructive', onPress: () => { if (!leaving.current) { setRaw(current => ({ ...current, [key]: '' })); save(key, null); } } },
    ]);
  }
  async function retry(key: PreferenceKey) {
    if (leaving.current || drafts.current[key]?.status !== 'failed') return;
    const operation = drafts.current[key]!.retry(); refresh(n => n + 1);
    try { await operation; setError(''); }
    catch { setError('Échec persistant ou modification concurrente. La saisie reste conservée ; aucun écrasement forcé.'); }
    refresh(n => n + 1);
  }
  function reload(key: PreferenceKey) {
    Alert.alert('Recharger ce réglage ?', 'Seul le brouillon non enregistré de ce champ sera abandonné. La valeur réellement enregistrée sera relue.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Recharger', style: 'destructive', onPress: () => {
        if (leaving.current || drafts.current[key]?.status !== 'failed') return;
        leaving.current = true; setBusy(true);
        void repository.read(key).then(state => {
          drafts.current[key] = new WriteQueue(state, patch => ({ value: validatePreference(key, patch.value) }),
            (row, patch) => repository.set(key, row.revision, patch.value));
          invalid.current.delete(key);
          setRaw(current => ({ ...current, [key]: String(state.value ?? '') })); setError('');
        }, () => setError('Relecture impossible. Le brouillon a été conservé.'))
          .finally(() => { leaving.current = false; setBusy(false); });
      } },
    ]);
  }
  return <ScrollView style={styles.page} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.title}>Réglages</Text>
    <Text style={styles.help}>Enregistrement local automatique. Unités : kg, cm, km et heures. Les secrets des intégrations ne sont pas stockés ici.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {!ready && !error && <Text>Chargement…</Text>}
    {ready && preferenceDefinitions.map(definition => {
      const { key, label, kind } = definition;
      const draft = drafts.current[key]!;
      return <View style={styles.card} key={key}>
        <Text style={styles.label}>{label}</Text>
        <TextInput accessibilityLabel={label} style={styles.input} editable={!busy}
          keyboardType={kind === 'number' ? 'decimal-pad' : 'default'} autoCorrect={false}
          value={raw[key] ?? String(draft.snapshot.value ?? '')} onChangeText={text => edit(key, text)} />
        {invalid.current.has(key) ? <>
          <Text style={styles.error}>Saisie incomplète ou hors limites — non enregistrée.</Text>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => {
            invalid.current.delete(key); setRaw(current => ({ ...current, [key]: String(draft.snapshot.value ?? '') }));
          }}><Text>Rétablir la dernière saisie valide</Text></Pressable>
        </> : <Text accessibilityLiveRegion="polite" style={styles.help}>{draft.status === 'saving' ? 'Enregistrement…' : draft.status === 'failed' ? 'Non enregistré' : draft.snapshot.revision === 0 ? 'Valeur par défaut' : 'Enregistré sur cet appareil'}</Text>}
        {draft.status === 'failed' && <>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void retry(key)}><Text>Réessayer la sauvegarde</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => reload(key)}><Text>Recharger la valeur enregistrée</Text></Pressable>
        </>}
        {'optional' in definition && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => clear(key)}><Text>Effacer ce réglage</Text></Pressable>}
      </View>;
    })}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void done()}><Text style={styles.buttonText}>Retour</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' }, content: { padding: 20, paddingTop: 48, paddingBottom: 40, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#31333f' }, help: { color: '#626570', lineHeight: 22 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#d5d6dc', gap: 8 },
  label: { color: '#31333f', fontSize: 16 }, input: { padding: 12, minHeight: 48, borderRadius: 8, backgroundColor: '#f0f2f6', color: '#31333f' },
  error: { color: '#b42318' }, secondary: { minHeight: 48, justifyContent: 'center' },
  button: { minHeight: 48, backgroundColor: '#ff4b4b', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
