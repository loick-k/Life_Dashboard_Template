import React, { useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DailyEntries, dailyRules, type DailyField } from '../storage/dailyEntries';
import { DailyDraft } from '../storage/dailyDraft';
import { parisDate, shiftDate } from '../domain/dates';
import { parseInput, type InputKind } from '../domain/input';

type Field = { key: DailyField; label: string; kind: InputKind };
const field = (key: DailyField, label: string, kind: InputKind = 'number'): Field => ({ key, label, kind });
const sections = [
  { title: 'Poids', fields: [field('weight_kg', 'Poids (kg)')] },
  { title: 'Masse graisseuse', fields: [field('body_fat_pct', 'Masse graisseuse (%)')] },
  { title: 'Tour de ventre', fields: [field('belly_cm', 'Tour de ventre (cm)')] },
  { title: 'Temps de travail', fields: [field('work_start_time', 'Heure de début', 'time'), field('work_morning_end_time', 'Fin de matinée', 'time'), field('work_afternoon_start_time', 'Début d’après-midi', 'time'), field('work_end_time', 'Fin de journée', 'time'), field('work_third_start_time', 'Créneau 3 · début', 'time'), field('work_third_end_time', 'Créneau 3 · fin', 'time')] },
];

/** Vertical development slice, not the final daily journey. Synthetic data only. */
export function DailyForm({ database }: { database: SQLiteDatabase }) {
  const [date, setDate] = useState(parisDate);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<DailyDraft>();
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [, repaint] = useState(0);
  const refresh = () => repaint(value => value + 1);
  useEffect(() => {
    let active = true;
    setDraft(undefined); setRaw({}); setInvalid(new Set());
    const repo = new DailyEntries(database, Crypto.randomUUID);
    repo.getOrCreate(date).then(row => { if (active) setDraft(new DailyDraft(repo, row)); }, () => { if (active) setError('Impossible de charger cette journée.'); });
    return () => { active = false; };
  }, [database, date]);
  const navigate = async (action: () => void) => {
    if (!draft) return;
    if (invalid.size) { setError('Termine la valeur en cours ou utilise Effacer pour une suppression volontaire.'); return; }
    try { await draft.flush(); setError(''); action(); } catch { setError('Sauvegarde non confirmée. Reste sur cette page et réessaie.'); }
    refresh();
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void navigate(() => {
        if (step > 0) setStep(step - 1);
        else Alert.alert('Quitter', 'Les écritures sont confirmées.', [{ text: 'Rester' }, { text: 'Quitter', onPress: () => BackHandler.exitApp() }]);
      });
      return true;
    });
    return () => subscription.remove();
  });
  const save = (key: DailyField, value: string | number | null) => {
    if (!draft) return;
    draft.edit({ [key]: value }); refresh();
    void draft.flush().then(refresh, () => { setError('Échec de sauvegarde. Le brouillon reste en mémoire sur cette page.'); refresh(); });
  };
  const edit = (item: Field, value: string) => {
    setRaw(previous => ({ ...previous, [item.key]: value }));
    const parsed = parseInput(value, item.kind);
    const valid = parsed !== undefined && dailyRules[item.key](parsed);
    setInvalid(previous => { const next = new Set(previous); if (valid) next.delete(item.key); else next.add(item.key); return next; });
    if (valid) save(item.key, parsed!);
  };
  const section = sections[step]!;
  const snapshot = draft?.snapshot;
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.notice}>Essai technique · données fictives uniquement</Text>
    <View style={styles.row}>{[['Aujourd’hui', parisDate()], ['Hier', shiftDate(parisDate(), -1)]].map(([label, target]) => <Pressable accessibilityRole="button" key={label} style={styles.secondary} onPress={() => void navigate(() => setDate(target!))}><Text>{label}</Text></Pressable>)}</View>
    <Text>{date}</Text><Text style={styles.title}>Mon point quotidien</Text>
    <Text style={styles.heading}>{section.title}</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {draft?.status === 'failed' && <Pressable style={styles.secondary} onPress={() => { void draft.retry().then(() => { setError(''); refresh(); }, refresh); }}><Text>Réessayer la sauvegarde</Text></Pressable>}
    {!draft ? <Text>Chargement local…</Text> : <>
      {step === 3 && <View style={styles.row}>{['Télétravail', 'Day off', 'Bureau', 'Déplacement'].map(mode => <Pressable accessibilityRole="button" accessibilityState={{ selected: snapshot?.work_mode === mode }} key={mode} style={[styles.secondary, snapshot?.work_mode === mode && styles.selected]} onPress={() => save('work_mode', mode)}><Text>{mode}</Text></Pressable>)}</View>}
      {section.fields.map(item => <View key={item.key} style={styles.field}>
        <Text style={styles.label}>{item.label}</Text>
        <TextInput accessibilityLabel={item.label} value={raw[item.key] ?? String(snapshot?.[item.key] ?? '')}
          onChangeText={value => edit(item, value)} style={[styles.input, invalid.has(item.key) && styles.invalid]}
          keyboardType={item.kind === 'number' ? 'decimal-pad' : 'default'}
          placeholder={item.kind === 'time' ? 'HH:MM' : 'Non renseigné'} />
        <Pressable accessibilityLabel={`Effacer ${item.label}`} onPress={() => Alert.alert('Effacer cette valeur ?', item.label, [{ text: 'Annuler' }, { text: 'Effacer', style: 'destructive', onPress: () => {
          setRaw(previous => ({ ...previous, [item.key]: '' })); setInvalid(previous => { const next = new Set(previous); next.delete(item.key); return next; }); save(item.key, null);
        } }])}><Text style={styles.clear}>Effacer</Text></Pressable>
      </View>)}
      {step === 3 && <Text style={styles.total}>Temps travaillé : {snapshot?.work_duration_minutes ?? 'n.c.'} min</Text>}
      {draft.status === 'saving' && <Text accessibilityLiveRegion="polite">Enregistrement en cours…</Text>}
      <View style={styles.row}>
        <Pressable disabled={step === 0} style={styles.secondary} onPress={() => void navigate(() => setStep(step - 1))}><Text>← Retour</Text></Pressable>
        <Pressable disabled={step === 3} style={styles.primary} onPress={() => void navigate(() => setStep(step + 1))}><Text style={styles.white}>Continuer →</Text></Pressable>
      </View>
    </>}
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
