import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DailyEntries, dailyRules, validateDate, type DailyField } from '../storage/dailyEntries';
import { DailyDraft } from '../storage/dailyDraft';
import { parisDate, shiftDate } from '../domain/dates';
import { parseInput } from '../domain/input';
import { SportForm, type SportFormHandle } from './SportForm';
import { CHECKIN_SECTIONS as sections, type CheckinField as Field } from '../domain/checkinConfig';
import { CatalogForm, type CatalogFormHandle } from './CatalogForm';
import { CheckinPositions, type CheckinPosition } from '../storage/checkinPosition';
import { readProgress, setCheckinProgress } from '../storage/checkinProgress';
import { RelatedSummary } from './RelatedSummary';
import { Preferences } from '../storage/preferences';
import { standardWorkPatch, previousWorkPatch } from '../storage/workShortcuts';
import type { DailyPatch } from '../storage/dailyEntries';
import { WorkBalanceCard } from './WorkBalanceCard';
import { inspectWorkSchedule, type WorkTimes } from '../domain/work';
import { sleepDurationHours, sleepDisagrees } from '../domain/sleep';
import { EnergyCard } from './EnergyCard';
import { formatMinutes } from '../domain/workReport';

/** Vertical development slice, not the final daily journey. Synthetic data only. */
export function DailyForm({ database, initialDate, onSettings, onBilan }: { database: SQLiteDatabase; initialDate?: string; onSettings?(date: string): void; onBilan?(date: string): void }) {
  const [date, setDate] = useState(() => initialDate ?? parisDate());
  const [closeLabel, setCloseLabel] = useState('Écoute de mes proches');
  const [step, setStep] = useState(0);
  const [home, setHome] = useState(true);
  const [chosenDate, setChosenDate] = useState('');
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
    Promise.all([repo.getOrCreate(date), new CheckinPositions(database).read(date), new Preferences(database).read('close_relations_label').catch(() => null)]).then(([row, cursor, label]) => {
      if (active) {
        setCloseLabel(label ? String(label.value) : 'Écoute des proches · libellé indisponible');
        if (!label) setError('Le libellé personnalisé est illisible. Les mesures restent accessibles ; vérifie les Réglages.');
        position.current = cursor; setStep(sections.findIndex(item => item.id === cursor.step)); setDraft(new DailyDraft(repo, row));
      }
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
  const changeDate = (target: string) => {
    validateDate(target);
    if (target > parisDate()) throw new Error('Date future');
    if (target !== date) { setDraft(undefined); setDate(target); }
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
  const fieldLabel = (item: Field) => item.key === 'close_relations_listening_score' ? `${closeLabel} (1 à 10)` : item.label;
  const chooseSleepMode = (mode: 'manual' | 'calculated') => {
    setRaw(previous => { const next = { ...previous }; delete next.sleep_hours; return next; });
    setInvalid(previous => { const next = new Set(previous); next.delete('sleep_hours'); return next; });
    save('sleep_duration_mode', mode);
  };
  const applyShortcut = (source: 'standard' | 'previous') => {
    void navigate(async () => {
      const patch: DailyPatch = source === 'standard' ? await standardWorkPatch(database) : await previousWorkPatch(database, date);
      if (!Object.keys(patch).length) { setError('Aucun horaire renseigné pour la veille.'); return; }
      const preview = Object.entries(patch).map(([key, value]) => `${sections.find(item => item.id === 'work')!.fields.find(item => item.key === key)!.label} : ${value}`).join('\n');
      // Keep the navigation lock while confirmation is visible; the target date cannot change.
      const confirmed = await new Promise<boolean>(resolve => Alert.alert('Appliquer ces horaires ?',
        `${preview}\n\nCes horaires remplaceront les champs correspondants. Les autres créneaux et indicateurs seront conservés.`,
        [{ text: 'Annuler', style: 'cancel', onPress: () => resolve(false) }, { text: 'Appliquer', onPress: () => resolve(true) }],
        { cancelable: false }));
      if (!confirmed || !draft) return;
      draft.edit(patch); refresh();
      setRaw(previous => { const next = { ...previous }; for (const key of Object.keys(patch)) delete next[key]; return next; });
      await draft.flush(); refresh();
    });
  };
  const section = sections[step]!;
  const snapshot = draft?.snapshot;
  let progress: ReturnType<typeof readProgress> | undefined;
  try { if (snapshot) progress = readProgress(snapshot); } catch { /* Preserve data; offer no progress mutations below. */ }
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.notice}>Essai technique · données fictives uniquement</Text>
    <View style={styles.row}>{[['Aujourd’hui', parisDate()], ['Hier', shiftDate(parisDate(), -1)]].map(([label, target]) => <Pressable accessibilityRole="button" disabled={busy || !draft} key={label} style={styles.secondary} onPress={() => void navigate(() => { if (target !== date) { setDraft(undefined); setDate(target!); } })}><Text>{label}</Text></Pressable>)}</View>
    <Text>{date}</Text><Text style={styles.title}>Mon point quotidien</Text>
    {home && <>
      {onBilan && <Pressable accessibilityRole="button" disabled={busy || !draft} style={styles.secondary} onPress={() => void navigate(() => onBilan(date))}><Text>Bilan</Text></Pressable>}
      {onSettings && <Pressable accessibilityRole="button" disabled={busy || !draft} style={styles.secondary} onPress={() => void navigate(() => onSettings(date))}><Text>Réglages</Text></Pressable>}
      <View style={styles.row}>
        <Pressable disabled={busy || !draft} style={styles.secondary} onPress={() => void navigate(() => changeDate(shiftDate(date, -1)))}><Text>← Jour précédent</Text></Pressable>
        <Pressable disabled={busy || !draft || date >= parisDate()} style={styles.secondary} onPress={() => void navigate(() => changeDate(shiftDate(date, 1)))}><Text>Jour suivant →</Text></Pressable>
      </View>
      <Text style={styles.label}>Ouvrir une date de l’historique (AAAA-MM-JJ)</Text>
      <TextInput accessibilityLabel="Date de l’historique" editable={!busy} style={styles.input} value={chosenDate} onChangeText={setChosenDate} placeholder="2026-09-25" autoCapitalize="none" maxLength={10} />
      <Pressable disabled={busy || !draft} style={styles.secondary} onPress={() => {
        try { validateDate(chosenDate); if (chosenDate > parisDate()) throw new Error('future'); }
        catch { setError('Indique une date existante au format AAAA-MM-JJ, au plus tard aujourd’hui.'); return; }
        void navigate(() => changeDate(chosenDate));
      }}><Text>Ouvrir cette journée</Text></Pressable>
    </>}
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
      {section.id === 'work' && <WorkBalanceCard database={database} date={date} revision={draft.snapshot.revision} saved={draft.status === 'saved'} />}
      {section.id === 'sport' && <SportForm key={draft.snapshot.entry_id} ref={sports} database={database} entryId={draft.snapshot.entry_id} />}
      {['social', 'goals'].includes(section.id) && <CatalogForm key={`${draft.snapshot.entry_id}:${section.id}`} ref={catalog} database={database} entryId={draft.snapshot.entry_id} kind={section.id === 'social' ? 'friends' : 'goals'} />}
      {section.id === 'work' && <View style={styles.row}>{['Télétravail', 'Day off', 'Bureau', 'Déplacement'].map(mode => <Pressable accessibilityRole="button" accessibilityState={{ selected: snapshot?.work_mode === mode }} key={mode} style={[styles.secondary, snapshot?.work_mode === mode && styles.selected]} onPress={() => save('work_mode', mode)}><Text>{mode}</Text></Pressable>)}</View>}
      {section.id === 'work' && <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => applyShortcut('previous')}><Text>Horaires d’hier</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => applyShortcut('standard')}><Text>Horaires standards</Text></Pressable>
      </View>}
      {section.id === 'sleep' && <>
        <Text>Durée {snapshot?.sleep_duration_mode === 'calculated' ? 'calculée depuis les horaires' : snapshot?.sleep_duration_mode === 'imported' ? 'historique importée' : 'saisie manuellement'} · {typeof snapshot?.sleep_hours === 'number' ? formatMinutes(Math.round(snapshot.sleep_hours * 60)) : 'n.c.'}</Text>
        {sleepDisagrees(snapshot?.sleep_hours, snapshot?.sleep_bedtime, snapshot?.sleep_wake_time) && <Text accessibilityRole="alert" style={styles.error}>La durée manuelle/importée diffère des horaires ({formatMinutes(Math.round(sleepDurationHours(snapshot?.sleep_bedtime, snapshot?.sleep_wake_time)! * 60))}). Choisis explicitement la valeur à utiliser.</Text>}
        <View style={styles.row}>
          <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy || sleepDurationHours(snapshot?.sleep_bedtime, snapshot?.sleep_wake_time) === null} onPress={() => chooseSleepMode('calculated')}><Text>Utiliser la durée calculée</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={() => chooseSleepMode('manual')}><Text>Saisir une durée manuelle</Text></Pressable>
        </View>
        {typeof snapshot?.sleep_hours === 'number' && <Text>Sommeil avec sieste : {formatMinutes(Math.round(snapshot.sleep_hours * 60) + Number(snapshot?.nap_minutes ?? 0))}{snapshot?.nap_minutes === null ? ' · sieste non renseignée' : ''}</Text>}
      </>}
      {section.fields.map(item => <View key={item.key} style={styles.field}>
        <Text style={styles.label}>{fieldLabel(item)}</Text>
        <TextInput editable={!busy && !(item.key === 'sleep_hours' && snapshot?.sleep_duration_mode === 'calculated')} accessibilityLabel={fieldLabel(item)} value={item.key === 'sleep_hours' && snapshot?.sleep_duration_mode === 'calculated' ? typeof snapshot.sleep_hours === 'number' ? String(Number(snapshot.sleep_hours.toFixed(2))) : '' : raw[item.key] ?? String(snapshot?.[item.key] ?? '')}
          onChangeText={value => edit(item, value)} style={[styles.input, invalid.has(item.key) && styles.invalid]}
          keyboardType={item.kind === 'number' ? 'decimal-pad' : 'default'}
          multiline={item.kind === 'text'}
          placeholder={item.kind === 'time' ? 'HH:MM' : 'Non renseigné'} />
        {!(item.key === 'sleep_hours' && snapshot?.sleep_duration_mode === 'calculated') && <Pressable accessibilityLabel={`Effacer ${fieldLabel(item)}`} onPress={() => Alert.alert('Effacer cette valeur ?', fieldLabel(item), [{ text: 'Annuler' }, { text: 'Effacer', style: 'destructive', onPress: () => {
          setRaw(previous => ({ ...previous, [item.key]: '' })); setInvalid(previous => { const next = new Set(previous); next.delete(item.key); return next; }); save(item.key, null);
        } }])}><Text style={styles.clear}>Effacer</Text></Pressable>}
      </View>)}
      {section.id === 'work' && <Text style={styles.total}>Temps travaillé : {inspectWorkSchedule(snapshot as WorkTimes).issue === 'overlap' ? 'n.c.' : snapshot?.work_duration_minutes ?? 'n.c.'} min</Text>}
      {section.id === 'work' && inspectWorkSchedule(snapshot as WorkTimes).issue === 'overlap' && <Text accessibilityRole="alert" style={styles.error}>Des créneaux se chevauchent. Les horaires sont enregistrés, mais la journée est exclue du compteur jusqu’à correction.</Text>}
      {section.id === 'me-time' && <Text style={styles.total}>Temps pour moi total : {section.fields.reduce((sum, item) => sum + Number(snapshot?.[item.key] ?? 0), 0)} min</Text>}
      {['nutrition', 'summary'].includes(section.id) && <EnergyCard database={database} entryId={draft.snapshot.entry_id} revision={draft.snapshot.revision} saved={draft.status === 'saved'} />}
      {section.id === 'summary' && sections.filter(item => item.fields.length).map(item => <View style={styles.field} key={item.id}>
        <Text style={styles.label}>{item.title}</Text>{item.fields.map(input => <Text key={input.key}>{fieldLabel(input)} : {snapshot?.[input.key] ?? 'Non renseigné'}</Text>)}
        <Pressable style={styles.secondary} onPress={() => void navigate(() => moveStep(sections.indexOf(item)))}><Text>Modifier</Text></Pressable>
      </View>)}
      {section.id === 'summary' && <RelatedSummary database={database} entryId={draft.snapshot.entry_id} onModify={id => void navigate(() => moveStep(sections.findIndex(item => item.id === id)))} />}
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
