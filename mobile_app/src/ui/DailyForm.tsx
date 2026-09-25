import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DailyEntries, dailyRules, type DailyField } from '../storage/dailyEntries';
import { DailyDraft } from '../storage/dailyDraft';
import { parisDate, shiftDate } from '../domain/dates';
import { parseInput } from '../domain/input';
import { SportForm, type SportFormHandle } from './SportForm';
import { CHECKIN_SECTIONS as sections, type CheckinField as Field } from '../domain/checkinConfig';
import { CatalogForm, type CatalogFormHandle } from './CatalogForm';
import { CheckinPositions, type CheckinPosition } from '../storage/checkinPosition';
import { readProgress, setCheckinProgress } from '../storage/checkinProgress';

/** Vertical development slice, not the final daily journey. Synthetic data only. */
export function DailyForm({ database }: { database: SQLiteDatabase }) {
  const [date, setDate] = useState(parisDate);
  const [step, setStep] = useState(0);
  const [home, setHome] = useState(true);
  const [draft, setDraft] = useState<DailyDraft>();
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const position = useRef<CheckinPosition | null>(null);
  const navigating = useRef(false);
  const [busy, setBusy] = useState(false);
  const sports = useRef<SportFormHandle>(null);
  const catalog = useRef<CatalogFormHandle>(null);
  const [, repaint] = useState(0);
  const refresh = () => repaint(value => value + 1);
  useEffect(() => {
    let active = true;
    setDraft(undefined); setRaw({}); setInvalid(new Set()); setError(''); setHome(true); position.current = null;
    const repo = new DailyEntries(database, Crypto.randomUUID);
    Promise.all([repo.getOrCreate(date), new CheckinPositions(database).read(date)]).then(([row, cursor]) => {
      if (active) { position.current = cursor; setStep(sections.findIndex(item => item.id === cursor.step)); setDraft(new DailyDraft(repo, row)); }
    }, () => { if (active) setError('Impossible de charger cette journée.'); });
    return () => { active = false; };
  }, [database, date]);
  const navigate = async (action: () => void | Promise<void>) => {
    if (!draft || navigating.current) return;
    if (invalid.size) { setError('Termine la valeur en cours ou utilise Effacer pour une suppression volontaire.'); return; }
    navigating.current = true; setBusy(true);
    try { await draft.flush(); if (sports.current) await sports.current.flush(); if (catalog.current) await catalog.current.flush(); setError(''); await action(); } catch { setError('Saisie invalide, ajout non terminé ou sauvegarde non confirmée. Termine la saisie avant de continuer.'); }
    finally { navigating.current = false; setBusy(false); refresh(); }
  };
  const moveStep = async (target: number) => {
    if (!position.current || !sections[target]) throw new Error('Position indisponible');
    position.current = await new CheckinPositions(database).move(date, position.current.revision, sections[target]!.id);
    setStep(target);
    setHome(false);
  };
  const advance = async (status: 'completed' | 'skipped') => {
    if (!draft) return;
    const updated = await setCheckinProgress(database, draft.snapshot, { step: sections[step]!.id, status });
    setDraft(new DailyDraft(new DailyEntries(database, Crypto.randomUUID), updated));
    await moveStep(step + 1);
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void navigate(async () => {
        if (!home && step > 0) await moveStep(step - 1);
        else if (!home) setHome(true);
        else Alert.alert('Quitter', 'Les écritures sont confirmées.', [{ text: 'Rester' }, { text: 'Quitter', onPress: () => BackHandler.exitApp() }]);
      });
      return true;
    });
    return () => subscription.remove();
  });
  const save = (key: DailyField, value: string | number | null) => {
    if (!draft || navigating.current) return;
    draft.edit({ [key]: value }); refresh();
    void draft.flush().then(refresh, () => { setError('Échec de sauvegarde. Le brouillon reste en mémoire sur cette page.'); refresh(); });
  };
  const edit = (item: Field, value: string) => {
    if (navigating.current) return;
    setRaw(previous => ({ ...previous, [item.key]: value }));
    const parsed = parseInput(value, item.kind);
    const valid = parsed !== undefined && dailyRules[item.key](parsed);
    setInvalid(previous => { const next = new Set(previous); if (valid) next.delete(item.key); else next.add(item.key); return next; });
    if (valid) save(item.key, parsed!);
  };
  const section = sections[step]!;
  const snapshot = draft?.snapshot;
  let progress: ReturnType<typeof readProgress> | undefined;
  try { if (snapshot) progress = readProgress(snapshot); } catch { /* Preserve data; offer no progress mutations below. */ }
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.notice}>Essai technique · données fictives uniquement</Text>
    <View style={styles.row}>{[['Aujourd’hui', parisDate()], ['Hier', shiftDate(parisDate(), -1)]].map(([label, target]) => <Pressable accessibilityRole="button" disabled={busy || !draft} key={label} style={styles.secondary} onPress={() => void navigate(() => { if (target !== date) { setDraft(undefined); setDate(target!); } })}><Text>{label}</Text></Pressable>)}</View>
    <Text>{date}</Text><Text style={styles.title}>Mon point quotidien</Text>
    {!home && <Text>Étape {step + 1} sur {sections.length}</Text>}
    <Text style={styles.heading}>{home ? 'Ta saisie du jour' : section.title}</Text>
    {progress && <Text>Progression · {progress.count}/13 indicateurs traités</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {draft?.status === 'failed' && <Pressable style={styles.secondary} onPress={() => { void draft.retry().then(() => { setError(''); refresh(); }, refresh); }}><Text>Réessayer la sauvegarde</Text></Pressable>}
    {!draft ? <Text>Chargement local…</Text> : !progress ? <Text style={styles.error}>Progression incompatible. Les données sont conservées.</Text> : home ? <View pointerEvents={busy ? 'none' : 'auto'}>
      <Pressable style={styles.primary} onPress={() => void navigate(() => moveStep(progress.finished ? sections.length - 1 : step))}><Text style={styles.white}>{progress.finished ? 'Voir le récapitulatif' : progress.count ? 'Reprendre mon point quotidien' : 'Commencer mon point quotidien'}</Text></Pressable>
      <Text style={styles.heading}>Accès direct</Text>
      <View style={styles.row}>{sections.filter(item => item.id !== 'summary').map(item => <Pressable key={item.id} style={styles.secondary} onPress={() => void navigate(() => moveStep(sections.indexOf(item)))}><Text>{item.title}{progress.completed.includes(item.id) ? ' ✓' : progress.skipped.includes(item.id) ? ' · passé' : ''}</Text></Pressable>)}</View>
    </View> : <View pointerEvents={busy ? 'none' : 'auto'}>
      <Pressable style={styles.secondary} onPress={() => void navigate(() => setHome(true))}><Text>Accueil de la journée</Text></Pressable>
      {section.id === 'sport' && <SportForm key={draft.snapshot.entry_id} ref={sports} database={database} entryId={draft.snapshot.entry_id} />}
      {['social', 'goals'].includes(section.id) && <CatalogForm key={`${draft.snapshot.entry_id}:${section.id}`} ref={catalog} database={database} entryId={draft.snapshot.entry_id} kind={section.id === 'social' ? 'friends' : 'goals'} />}
      {section.id === 'work' && <View style={styles.row}>{['Télétravail', 'Day off', 'Bureau', 'Déplacement'].map(mode => <Pressable accessibilityRole="button" accessibilityState={{ selected: snapshot?.work_mode === mode }} key={mode} style={[styles.secondary, snapshot?.work_mode === mode && styles.selected]} onPress={() => save('work_mode', mode)}><Text>{mode}</Text></Pressable>)}</View>}
      {section.fields.map(item => <View key={item.key} style={styles.field}>
        <Text style={styles.label}>{item.label}</Text>
        <TextInput editable={!busy} accessibilityLabel={item.label} value={raw[item.key] ?? String(snapshot?.[item.key] ?? '')}
          onChangeText={value => edit(item, value)} style={[styles.input, invalid.has(item.key) && styles.invalid]}
          keyboardType={item.kind === 'number' ? 'decimal-pad' : 'default'}
          multiline={item.kind === 'text'}
          placeholder={item.kind === 'time' ? 'HH:MM' : 'Non renseigné'} />
        <Pressable accessibilityLabel={`Effacer ${item.label}`} onPress={() => Alert.alert('Effacer cette valeur ?', item.label, [{ text: 'Annuler' }, { text: 'Effacer', style: 'destructive', onPress: () => {
          setRaw(previous => ({ ...previous, [item.key]: '' })); setInvalid(previous => { const next = new Set(previous); next.delete(item.key); return next; }); save(item.key, null);
        } }])}><Text style={styles.clear}>Effacer</Text></Pressable>
      </View>)}
      {section.id === 'work' && <Text style={styles.total}>Temps travaillé : {snapshot?.work_duration_minutes ?? 'n.c.'} min</Text>}
      {section.id === 'me-time' && <Text style={styles.total}>Temps pour moi total : {section.fields.reduce((sum, item) => sum + Number(snapshot?.[item.key] ?? 0), 0)} min</Text>}
      {section.id === 'nutrition' && <Text style={styles.total}>Kcal : {snapshot?.kcal ?? 'n.c.'} · Sport : {snapshot?.sport_kcal_burned ?? 'n.c.'} · Net : {typeof snapshot?.kcal === 'number' && typeof snapshot?.sport_kcal_burned === 'number' ? snapshot.kcal - snapshot.sport_kcal_burned : 'n.c.'}\nAnalyse externe non encore disponible.</Text>}
      {section.id === 'summary' && sections.filter(item => item.fields.length).map(item => <View style={styles.field} key={item.id}>
        <Text style={styles.label}>{item.title}</Text>{item.fields.map(input => <Text key={input.key}>{input.label} : {snapshot?.[input.key] ?? 'Non renseigné'}</Text>)}
        <Pressable style={styles.secondary} onPress={() => void navigate(() => moveStep(sections.indexOf(item)))}><Text>Modifier</Text></Pressable>
      </View>)}
      {draft.status === 'saving' && <Text accessibilityLiveRegion="polite">Enregistrement en cours…</Text>}
      <View style={styles.row}>
        <Pressable disabled={step === 0 || busy} style={styles.secondary} onPress={() => void navigate(() => moveStep(step - 1))}><Text>← Retour</Text></Pressable>
        {section.id !== 'summary' ? <>
          <Pressable disabled={busy} style={styles.secondary} onPress={() => void navigate(() => advance('skipped'))}><Text>Passer</Text></Pressable>
          <Pressable disabled={busy} style={styles.primary} onPress={() => void navigate(() => advance('completed'))}><Text style={styles.white}>Continuer →</Text></Pressable>
        </> : <Pressable disabled={busy || progress.count !== 13} style={styles.primary} onPress={() => void navigate(async () => {
          const updated = await setCheckinProgress(database, draft.snapshot, { finish: true });
          setDraft(new DailyDraft(new DailyEntries(database, Crypto.randomUUID), updated)); setHome(true);
        })}><Text style={styles.white}>{progress.count === 13 ? 'Terminer mon point quotidien' : 'Traite les étapes restantes depuis l’accueil'}</Text></Pressable>}
      </View>
    </View>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, paddingBottom: 48, backgroundColor: '#fff', flexGrow: 1 },
  notice: { color: '#895000', marginBottom: 16 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#31333f', marginVertical: 8 },
  heading: { fontSize: 23, fontWeight: '600', color: '#31333f', marginVertical: 20 },
  field: { marginBottom: 14 }, label: { fontSize: 16, marginBottom: 8, color: '#31333f' },
  input: { backgroundColor: '#f0f2f6', borderRadius: 10, padding: 14, minHeight: 50, fontSize: 18, color: '#31333f', borderWidth: 1, borderColor: 'transparent' },
  invalid: { borderColor: '#b74a00' }, clear: { color: '#626570', paddingVertical: 12, alignSelf: 'flex-end' },
  secondary: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, padding: 14, minHeight: 48 },
  selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' }, primary: { backgroundColor: '#ff4b4b', padding: 14, borderRadius: 10, minHeight: 48, flexGrow: 1, alignItems: 'center' },
  white: { color: '#fff', fontWeight: '600' }, total: { backgroundColor: '#e8f2fc', padding: 16, borderRadius: 12, fontSize: 18, marginVertical: 12 },
  error: { color: '#b42318', marginVertical: 12, lineHeight: 22 },
});
