import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DailyEntries, dailyRules, validateDate, type DailyField, type DailyEntry } from '../storage/dailyEntries';
import { DailyDraft } from '../storage/dailyDraft';
import { parisDate, shiftDate } from '../domain/dates';
import { parseInput } from '../domain/input';
import { SportForm, type SportFormHandle } from './SportForm';
import { CHECKIN_SECTIONS as sections, type CheckinField as Field } from '../domain/checkinConfig';
import { CatalogForm, type CatalogFormHandle } from './CatalogForm';
import { CheckinPositions, CheckinPositionConflict, type CheckinPosition } from '../storage/checkinPosition';
import { readProgress, setCheckinProgress } from '../storage/checkinProgress';
import { RelatedSummary } from './RelatedSummary';
import { Preferences } from '../storage/preferences';
import { standardWorkPatch, previousWorkPatch } from '../storage/workShortcuts';
import type { DailyPatch } from '../storage/dailyEntries';
import { WorkBalanceCard } from './WorkBalanceCard';
import { inspectWorkSchedule, effectiveWorkMinutes, type WorkState, type WorkTimes } from '../domain/work';
import { sleepDurationHours, sleepDisagrees } from '../domain/sleep';
import { EnergyCard } from './EnergyCard';
import { formatMinutes } from '../domain/workReport';
import type { EditorHandle } from './editorHandle';
import { resolveDailyDraft } from '../storage/dailyRecovery';
import { settleWrites } from '../storage/settleWrites';
import { durationFromParts, sumKnownMinutes } from '../domain/durationInput';
import type { BodyMeasure, PreviousMeasure } from '../storage/previousMeasures';
import { PreviousMeasureCard } from './PreviousMeasureCard';
import { FrenchCalendar } from './FrenchCalendar';
import { palette } from './palette';
import type { CatalogKind } from '../storage/catalogs';
import { useParisToday } from './useParisToday';

type DailyReview = { latest: DailyEntry; pending: DailyPatch; choices: Record<string, 'draft' | 'database'> };

/** Vertical development slice, not the final daily journey. Synthetic data only. */
export const DailyForm = forwardRef<EditorHandle, { database: SQLiteDatabase; initialDate?: string; active?: boolean; onDate?(date: string): void; onSettings?(date: string): void; onBilan?(date: string): void; onManageCatalog?(kind: CatalogKind): void }>(function DailyForm({ database, initialDate, active = true, onDate, onSettings, onBilan, onManageCatalog }, ref) {
  const [date, setDate] = useState(() => initialDate ?? parisDate());
  const today = useParisToday(active);
  const [closeLabel, setCloseLabel] = useState('Écoute de mes proches');
  const [step, setStep] = useState(0);
  const [home, setHome] = useState(true);
  const [chosenDate, setChosenDate] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [draft, renderDraft] = useState<DailyDraft>();
  const currentDraft = useRef<DailyDraft | undefined>(undefined);
  const setDraft = (value: DailyDraft | undefined) => { currentDraft.current = value; renderDraft(value); };
  const [raw, setRaw] = useState<Record<string, string>>({});
  const durationBuffers = useRef<Record<string, string>>({});
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [review, renderReview] = useState<DailyReview>();
  const currentReview = useRef<DailyReview | undefined>(undefined);
  const recovery = useRef<Promise<void> | null>(null);
  const setReview = (value: DailyReview | undefined) => { currentReview.current = value; renderReview(value); };
  const loading = useRef<Promise<void>>(Promise.resolve());
  const history = useRef<number[]>([]);
  const scroll = useRef<ScrollView>(null);
  const position = useRef<CheckinPosition | null>(null);
  const [positionIssue, setPositionIssue] = useState(false);
  const navigating = useRef(false);
  const [busy, setBusy] = useState(false);
  const sports = useRef<SportFormHandle>(null);
  const catalog = useRef<CatalogFormHandle>(null);
  const [, repaint] = useState(0);
  const refresh = () => repaint(value => value + 1);
  useEffect(() => {
    let active = true;
    setDraft(undefined); setRaw({}); setInvalid(new Set()); setError(''); setHome(true); setReview(undefined); position.current = null; history.current = [];
    durationBuffers.current = {};
    setChosenDate(''); setShowCalendar(false);
    setPositionIssue(false);
    const repo = new DailyEntries(database, Crypto.randomUUID);
    loading.current = (async () => {
      const results = await Promise.allSettled([repo.getOrCreate(date), new CheckinPositions(database).read(date), new Preferences(database).read('close_relations_label').catch(() => null)] as const);
      if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled' || results[2].status !== 'fulfilled') {
        if (active) setError('Impossible de charger cette journée.');
        return;
      }
      const row = results[0].value, cursor = results[1].value, label = results[2].value;
      if (active) {
        setCloseLabel(label ? String(label.value) : 'Écoute des proches · libellé indisponible');
        if (!label) setError('Le libellé personnalisé est illisible. Les mesures restent accessibles ; vérifie les Réglages.');
        position.current = cursor; setStep(sections.findIndex(item => item.id === cursor.step)); setDraft(new DailyDraft(repo, row));
      }
    })();
    return () => { active = false; };
  }, [database, date, loadAttempt]);
  useEffect(() => { onDate?.(date); }, [date, onDate]);
  const reviewing = !!review;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [date, step, home, reviewing]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void new Preferences(database).read('close_relations_label').then(label => { if (current) setCloseLabel(String(label.value)); }, () => {});
    return () => { current = false; };
  }, [database, active]);
  const settle = async () => {
    if (navigating.current) throw new Error('Navigation en cours');
    if (recovery.current) await recovery.current;
    await settleWrites([loading.current, currentDraft.current?.flush() ?? Promise.resolve(), sports.current?.settle() ?? Promise.resolve(), catalog.current?.settle() ?? Promise.resolve()]);
  };
  useImperativeHandle(ref, () => ({
    settle,
    hasUnconfirmed: () => invalid.size > 0 || !!recovery.current || !!currentReview.current || (!!currentDraft.current && currentDraft.current.status !== 'saved') || !!sports.current?.hasUnconfirmed() || !!catalog.current?.hasUnconfirmed(),
    beforeReplace: async () => {
      await settle();
      if (invalid.size || currentReview.current) throw new Error('Brouillon quotidien à terminer');
      await sports.current?.flush(); await catalog.current?.flush();
    },
  }));
  const navigate = async (action: () => void | Promise<void>) => {
    if (!draft || navigating.current) return;
    if (recovery.current || currentReview.current) { setError('Termine ou ferme la comparaison avant de poursuivre. Ton brouillon est conservé.'); return; }
    if (invalid.size) { setError('Termine la valeur en cours ou utilise Effacer pour une suppression volontaire.'); return; }
    navigating.current = true; setBusy(true);
    try { await draft.flush(); if (sports.current) await sports.current.flush(); if (catalog.current) await catalog.current.flush(); setError(''); await action(); } catch (issue) { setError(issue instanceof CheckinPositionConflict ? issue.message : 'Saisie invalide, ajout non terminé ou sauvegarde non confirmée. Termine la saisie avant de continuer.'); }
    finally { navigating.current = false; setBusy(false); refresh(); }
  };
  const moveStep = async (target: number, remember = true) => {
    if (!position.current || !sections[target]) throw new Error('Position indisponible');
    try { position.current = await new CheckinPositions(database).move(date, position.current.revision, sections[target]!.id); }
    catch (issue) { setPositionIssue(true); throw issue; }
    if (remember) { if (home) history.current = []; else if (target !== step) history.current.push(step); }
    setStep(target);
    setHome(false);
  };
  const reloadPosition = async () => {
    if (navigating.current) return;
    navigating.current = true; setBusy(true);
    try {
      position.current = await new CheckinPositions(database).read(date);
      setPositionIssue(false); setError('Position relue. Tes valeurs et brouillons sont conservés ; réessaie la navigation souhaitée.');
    } catch { setError('Position toujours illisible. Aucune saisie ni progression réinitialisée. Réessaie ou utilise la récupération dans Réglages.'); }
    finally { navigating.current = false; setBusy(false); }
  };
  const back = async () => {
    if (history.current.length) { await moveStep(history.current.at(-1)!, false); history.current.pop(); }
    else setHome(true);
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
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!draft) return false; // A failed load must not trap the Android Back button.
      void navigate(async () => {
        if (!home) await back();
        else Alert.alert('Quitter', 'Les écritures sont confirmées.', [{ text: 'Rester' }, { text: 'Quitter', onPress: () => BackHandler.exitApp() }]);
      });
      return true;
    });
    return () => subscription.remove();
  });
  const editsLocked = () => navigating.current || !active || !!recovery.current || !!currentReview.current;
  const save = (key: DailyField, value: string | number | null) => {
    if (!draft || editsLocked()) return;
    try { draft.edit({ [key]: value }); } catch { setError('Saisie invalide : les données enregistrées sont conservées.'); return; }
    refresh();
    void draft.flush().then(refresh, () => { setError('Échec de sauvegarde. Le brouillon reste en mémoire sur cette page.'); refresh(); });
  };
  const edit = (item: Field, value: string) => {
    if (editsLocked()) return;
    setRaw(previous => ({ ...previous, [item.key]: value }));
    const parsed = parseInput(value, item.kind);
    const valid = parsed !== undefined && dailyRules[item.key](parsed);
    setInvalid(previous => { const next = new Set(previous); if (valid) next.delete(item.key); else next.add(item.key); return next; });
    if (valid) save(item.key, parsed!);
  };
  const fieldLabel = (item: Field) => item.key === 'close_relations_listening_score' ? `${closeLabel} (1 à 10)` : item.label;
  const editDuration = (item: Field, part: 'hours' | 'minutes', text: string) => {
    if (!draft || editsLocked()) return;
    durationBuffers.current[`${item.key}.${part}`] = text;
    const stored = typeof draft.snapshot[item.key] === 'number' ? Number(draft.snapshot[item.key]) : null;
    const hours = durationBuffers.current[`${item.key}.hours`] ?? (stored === null ? '' : String(Math.floor(stored / 60)));
    const minutes = durationBuffers.current[`${item.key}.minutes`] ?? (stored === null ? '' : String(stored % 60));
    setRaw(previous => ({ ...previous, ...durationBuffers.current }));
    const value = durationFromParts(hours, minutes), valid = value !== undefined && dailyRules[item.key](value);
    setInvalid(previous => { const next = new Set(previous); if (valid) next.delete(item.key); else next.add(item.key); return next; });
    if (valid) save(item.key, value!);
  };
  const reuseBodyMeasure = (field: BodyMeasure, measure: PreviousMeasure) => void navigate(async () => {
    const confirmed = await new Promise<boolean>(resolve => Alert.alert('Réutiliser cette mesure ?', `${measure.value} · mesuré le ${measure.date.split('-').reverse().join('/')}\nCette valeur sera enregistrée pour le ${date.split('-').reverse().join('/')}. Les autres mesures seront conservées.`, [
      { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) }, { text: 'Réutiliser', onPress: () => resolve(true) },
    ], { cancelable: false }));
    if (!confirmed || !draft) return;
    draft.edit({ [field]: measure.value }); setRaw(previous => { const next = { ...previous }; delete next[field]; return next; });
    await draft.flush(); refresh();
  });
  const chooseSleepMode = (mode: 'manual' | 'calculated') => {
    if (editsLocked()) return;
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
  const recover = (action: () => Promise<void>, message: string) => {
    if (recovery.current || navigating.current) return Promise.resolve();
    setBusy(true);
    // Lock synchronously, before the first await or another native input event.
    recovery.current = Promise.resolve().then(action).catch(() => setError(message)).finally(() => { recovery.current = null; setBusy(false); });
    return recovery.current;
  };
  const openReview = () => {
    if (!draft || draft.status !== 'failed') return Promise.resolve();
    return recover(async () => {
      const latest = await new DailyEntries(database, Crypto.randomUUID).read(draft.snapshot.entry_id);
      const pending = draft.pendingPatch;
      setReview({ latest, pending, choices: Object.fromEntries(Object.keys(pending).filter(key => pending[key as DailyField] === latest[key]).map(key => [key, 'database'])) });
      setError('');
    }, 'Relecture impossible. Ton brouillon reste conservé.');
  };
  const applyReview = () => {
    const reviewed = currentReview.current;
    if (!draft || !reviewed || Object.keys(reviewed.pending).some(key => !reviewed.choices[key])) return Promise.resolve();
    return recover(async () => {
      const resolved = await resolveDailyDraft(new DailyEntries(database, Crypto.randomUUID), reviewed.latest, reviewed.pending, Object.keys(reviewed.choices).filter(key => reviewed.choices[key] === 'draft'));
      setDraft(resolved);
      const replaced = Object.keys(reviewed.choices).filter(key => reviewed.choices[key] === 'database');
      for (const key of replaced) { delete durationBuffers.current[`${key}.hours`]; delete durationBuffers.current[`${key}.minutes`]; }
      setRaw(previous => { const next = { ...previous }; for (const key of replaced) { delete next[key]; delete next[`${key}.hours`]; delete next[`${key}.minutes`]; } return next; });
      setInvalid(previous => { const next = new Set(previous); replaced.forEach(key => next.delete(key)); return next; });
      setReview(undefined); setError('Choix enregistrés. Les autres champs sont conservés.');
    }, 'La journée a encore changé ou l’écriture a échoué. Le brouillon initial reste conservé ; recharge la comparaison.');
  };
  const fieldsDisabled = busy || !!review;
  return <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Text style={styles.notice}>Essai technique · données fictives uniquement</Text>
    <View style={styles.row}>{[['Aujourd’hui', 0], ['Hier', -1]].map(([label, offset]) => <Pressable accessibilityRole="button" disabled={busy || !draft} key={label} style={styles.secondary} onPress={() => void navigate(() => changeDate(shiftDate(parisDate(), Number(offset))))}><Text>{label}</Text></Pressable>)}</View>
    <Text>{date}</Text><Text style={styles.title}>Mon point quotidien</Text>
    {date !== today && <Text style={styles.notice}>Journée historique ouverte. Aujourd’hui à Paris : {today.split('-').reverse().join('/')}. Tes saisies restent associées au {date.split('-').reverse().join('/')}.</Text>}
    {home && <>
      {onBilan && <Pressable accessibilityRole="button" disabled={busy || !draft} style={styles.secondary} onPress={() => void navigate(() => onBilan(date))}><Text>Bilan</Text></Pressable>}
      {onSettings && <Pressable accessibilityRole="button" disabled={busy || !draft} style={styles.secondary} onPress={() => void navigate(() => onSettings(date))}><Text>Réglages</Text></Pressable>}
      <View style={styles.row}>
        <Pressable disabled={busy || !draft} style={styles.secondary} onPress={() => void navigate(() => changeDate(shiftDate(date, -1)))}><Text>← Jour précédent</Text></Pressable>
        <Pressable disabled={busy || !draft || date >= parisDate()} style={styles.secondary} onPress={() => void navigate(() => changeDate(shiftDate(date, 1)))}><Text>Jour suivant →</Text></Pressable>
      </View>
      <Text style={styles.label}>Ouvrir une date de l’historique (AAAA-MM-JJ)</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showCalendar }} style={styles.secondary} onPress={() => setShowCalendar(value => !value)}><Text>{showCalendar ? 'Masquer le calendrier' : 'Choisir dans le calendrier'}</Text></Pressable>
      {showCalendar && <FrenchCalendar value={chosenDate || date} latest={parisDate()} disabled={busy} onSelect={setChosenDate} />}
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
    {positionIssue && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void reloadPosition()}><Text>Relire la position sans perdre mes saisies</Text></Pressable>}
    {!draft && error && <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => setLoadAttempt(value => value + 1)}><Text>Réessayer le chargement de la journée</Text></Pressable>}
    {draft?.status === 'failed' && <>
      <Pressable accessibilityRole="button" disabled={fieldsDisabled} style={styles.secondary} onPress={() => { if (!editsLocked()) void draft.retry().then(() => { setError(''); refresh(); }, refresh); }}><Text>Réessayer la sauvegarde</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void openReview()}><Text>Comparer le brouillon aux valeurs enregistrées</Text></Pressable>
    </>}
    {review && <View style={styles.field}>
      <Text style={styles.heading}>Résoudre sans écrasement automatique</Text>
      <Text>Choisis pour chaque champ. Les saisies incomplètes restent en mémoire tant que tu ne choisis pas de les remplacer.</Text>
      {Object.entries(review.pending).map(([key, value]) => <View key={key} style={styles.field}>
        <Text style={styles.label}>{sections.flatMap(section => section.fields).find(item => item.key === key)?.label ?? key}</Text>
        <Text>Enregistré : {String(review.latest[key] ?? 'Non renseigné')} · Brouillon : {String(value ?? 'Effacement explicite')}</Text>
        <View style={styles.row}>{(['draft', 'database'] as const).map(choice => <Pressable key={choice} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: review.choices[key] === choice, disabled: busy }} style={[styles.secondary, review.choices[key] === choice && styles.selected]} onPress={() => { const current = currentReview.current; if (current && !recovery.current) setReview({ ...current, choices: { ...current.choices, [key]: choice } }); }}><Text>{choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}</Text></Pressable>)}</View>
      </View>)}
      <Pressable accessibilityRole="button" disabled={busy || Object.keys(review.pending).some(key => !review.choices[key])} style={styles.primary} onPress={() => void applyReview()}><Text style={styles.white}>Appliquer mes choix</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={() => void openReview()}><Text>Recharger la comparaison</Text></Pressable>
      <Pressable accessibilityRole="button" style={styles.secondary} disabled={busy} onPress={() => { if (!recovery.current) setReview(undefined); }}><Text>Fermer sans abandonner le brouillon</Text></Pressable>
    </View>}
    {!draft ? <Text>{error ? 'Journée non chargée. Bilan et Réglages restent accessibles dans le menu principal.' : 'Chargement local…'}</Text> : !progress ? <Text style={styles.error}>Progression incompatible. Les données sont conservées.</Text> : home ? <View pointerEvents={busy ? 'none' : 'auto'}>
      <Pressable style={styles.primary} onPress={() => void navigate(() => moveStep(progress.finished ? sections.length - 1 : step))}><Text style={styles.white}>{progress.finished ? 'Voir le récapitulatif' : progress.count ? 'Reprendre mon point quotidien' : 'Commencer mon point quotidien'}</Text></Pressable>
      <Text style={styles.heading}>Accès direct</Text>
      <View style={styles.row}>{sections.filter(item => item.id !== 'summary').map(item => <Pressable key={item.id} style={styles.secondary} onPress={() => void navigate(() => moveStep(sections.indexOf(item)))}><Text>{item.title}{progress.completed.includes(item.id) ? ' ✓' : progress.skipped.includes(item.id) ? ' · passé' : ''}</Text></Pressable>)}</View>
    </View> : <View pointerEvents={busy ? 'none' : 'auto'}>
      <Pressable style={styles.secondary} onPress={() => void navigate(() => setHome(true))}><Text>Accueil de la journée</Text></Pressable>
      {section.id === 'work' && <WorkBalanceCard database={database} date={date} revision={draft.snapshot.revision} saved={draft.status === 'saved'} />}
      {['weight', 'fat', 'belly'].includes(section.id) && <PreviousMeasureCard database={database} field={section.fields[0]!.key as BodyMeasure} date={date} disabled={busy} onReuse={measure => reuseBodyMeasure(section.fields[0]!.key as BodyMeasure, measure)} />}
      {section.id === 'sport' && <SportForm key={draft.snapshot.entry_id} ref={sports} database={database} entryId={draft.snapshot.entry_id} />}
      {['social', 'goals'].includes(section.id) && <>
        {onManageCatalog && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void navigate(() => onManageCatalog(section.id === 'social' ? 'friends' : 'goals'))}><Text>{section.id === 'social' ? 'Gérer les personnes suivies' : 'Gérer mes objectifs'}</Text></Pressable>}
        <CatalogForm key={`${draft.snapshot.entry_id}:${section.id}`} ref={catalog} database={database} entryId={draft.snapshot.entry_id} active={active} kind={section.id === 'social' ? 'friends' : 'goals'} />
      </>}
      {section.id === 'work' && <View style={styles.row}>{['Télétravail', 'Day off', 'Bureau', 'Déplacement'].map(mode => <Pressable accessibilityRole="button" disabled={fieldsDisabled} accessibilityState={{ selected: snapshot?.work_mode === mode, disabled: fieldsDisabled }} key={mode} style={[styles.secondary, snapshot?.work_mode === mode && styles.selected]} onPress={() => save('work_mode', mode)}><Text>{mode}</Text></Pressable>)}</View>}
      {section.id === 'work' && <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => applyShortcut('previous')}><Text>Horaires d’hier</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => applyShortcut('standard')}><Text>Horaires standards</Text></Pressable>
      </View>}
      {section.id === 'sleep' && <>
        <Text>Durée {snapshot?.sleep_duration_mode === 'calculated' ? 'calculée depuis les horaires' : snapshot?.sleep_duration_mode === 'imported' ? 'historique importée' : 'saisie manuellement'} · {typeof snapshot?.sleep_hours === 'number' ? formatMinutes(Math.round(snapshot.sleep_hours * 60)) : 'n.c.'}</Text>
        {sleepDisagrees(snapshot?.sleep_hours, snapshot?.sleep_bedtime, snapshot?.sleep_wake_time) && <Text accessibilityRole="alert" style={styles.error}>La durée manuelle/importée diffère des horaires ({formatMinutes(Math.round(sleepDurationHours(snapshot?.sleep_bedtime, snapshot?.sleep_wake_time)! * 60))}). Choisis explicitement la valeur à utiliser.</Text>}
        <View style={styles.row}>
          <Pressable accessibilityRole="button" style={styles.secondary} disabled={fieldsDisabled || sleepDurationHours(snapshot?.sleep_bedtime, snapshot?.sleep_wake_time) === null} onPress={() => chooseSleepMode('calculated')}><Text>Utiliser la durée calculée</Text></Pressable>
          <Pressable accessibilityRole="button" style={styles.secondary} disabled={fieldsDisabled} onPress={() => chooseSleepMode('manual')}><Text>Saisir une durée manuelle</Text></Pressable>
        </View>
        {typeof snapshot?.sleep_hours === 'number' && <Text>Sommeil avec sieste : {formatMinutes(Math.round(snapshot.sleep_hours * 60) + Number(snapshot?.nap_minutes ?? 0))}{snapshot?.nap_minutes === null ? ' · sieste non renseignée' : ''}</Text>}
      </>}
      {section.fields.map(item => <View key={item.key} style={styles.field}>
        <Text style={styles.label}>{fieldLabel(item)}</Text>
        {item.key.endsWith('_minutes') ? <View style={styles.row}>{(['hours', 'minutes'] as const).map(part => {
          const stored = typeof snapshot?.[item.key] === 'number' ? Number(snapshot[item.key]) : null;
          const partValue = stored === null ? '' : String(part === 'hours' ? Math.floor(stored / 60) : stored % 60);
          const partLabel = `${fieldLabel(item).replace(' (minutes)', '')} · ${part === 'hours' ? 'Heures' : 'Minutes'}`;
          return <View key={part} style={{ flex: 1, minWidth: 100 }}><Text>{part === 'hours' ? 'Heures' : 'Minutes'}</Text><TextInput accessibilityLabel={partLabel} editable={!fieldsDisabled} value={raw[`${item.key}.${part}`] ?? partValue} onChangeText={text => editDuration(item, part, text)} keyboardType="number-pad" placeholder="Non renseigné" style={[styles.input, invalid.has(item.key) && styles.invalid]} /></View>;
        })}</View> : <TextInput editable={!fieldsDisabled && !(item.key === 'sleep_hours' && snapshot?.sleep_duration_mode === 'calculated')} accessibilityLabel={fieldLabel(item)} value={item.key === 'sleep_hours' && snapshot?.sleep_duration_mode === 'calculated' ? typeof snapshot.sleep_hours === 'number' ? String(Number(snapshot.sleep_hours.toFixed(2))) : '' : raw[item.key] ?? String(snapshot?.[item.key] ?? '')}
          onChangeText={value => edit(item, value)} style={[styles.input, invalid.has(item.key) && styles.invalid]}
          onBlur={() => { if (!editsLocked() && item.kind === 'time' && !invalid.has(item.key)) setRaw(previous => ({ ...previous, [item.key]: String(draft.snapshot[item.key] ?? '') })); }}
          keyboardType={item.kind === 'number' ? 'decimal-pad' : 'default'}
          multiline={item.kind === 'text'}
          placeholder={item.kind === 'time' ? 'HH:MM ou HHMM' : 'Non renseigné'} />}
        {!(item.key === 'sleep_hours' && snapshot?.sleep_duration_mode === 'calculated') && <Pressable disabled={fieldsDisabled} accessibilityLabel={`Effacer ${fieldLabel(item)}`} onPress={() => { if (editsLocked()) return; Alert.alert('Effacer cette valeur ?', fieldLabel(item), [{ text: 'Annuler' }, { text: 'Effacer', style: 'destructive', onPress: () => {
          if (editsLocked()) return;
          delete durationBuffers.current[`${item.key}.hours`]; delete durationBuffers.current[`${item.key}.minutes`];
          setRaw(previous => { const next = { ...previous, [item.key]: '' }; delete next[`${item.key}.hours`]; delete next[`${item.key}.minutes`]; return next; }); setInvalid(previous => { const next = new Set(previous); next.delete(item.key); return next; }); save(item.key, null);
        } }]); }}><Text style={styles.clear}>Effacer</Text></Pressable>}
      </View>)}
      {section.id === 'work' && <Text style={styles.total}>Temps travaillé : {formatMinutes(effectiveWorkMinutes(snapshot as WorkState))}</Text>}
      {section.id === 'work' && inspectWorkSchedule(snapshot as WorkTimes).issue === 'overlap' && <Text accessibilityRole="alert" style={styles.error}>Des créneaux se chevauchent. Les horaires sont enregistrés, mais la journée est exclue du compteur jusqu’à correction.</Text>}
      {section.id === 'me-time' && <Text style={styles.total}>Temps pour moi total : {formatMinutes(sumKnownMinutes(section.fields.map(item => snapshot?.[item.key])))}</Text>}
      {['nutrition', 'summary'].includes(section.id) && <EnergyCard database={database} entryId={draft.snapshot.entry_id} revision={draft.snapshot.revision} saved={draft.status === 'saved'} />}
      {section.id === 'summary' && sections.filter(item => item.fields.length).map(item => <View style={styles.field} key={item.id}>
        <Text style={styles.label}>{item.title}</Text>{item.fields.map(input => <Text key={input.key}>{fieldLabel(input)} : {snapshot?.[input.key] ?? 'Non renseigné'}</Text>)}
        {item.id === 'work' && <><Text>Type de journée : {snapshot?.work_mode ?? 'Non renseigné'}</Text><WorkBalanceCard database={database} date={date} revision={draft.snapshot.revision} saved={draft.status === 'saved'} /></>}
        <Pressable style={styles.secondary} onPress={() => void navigate(() => moveStep(sections.indexOf(item)))}><Text>Modifier</Text></Pressable>
      </View>)}
      {section.id === 'summary' && <RelatedSummary database={database} entryId={draft.snapshot.entry_id} onModify={id => void navigate(() => moveStep(sections.findIndex(item => item.id === id)))} />}
      {draft.status === 'saving' && <Text accessibilityLiveRegion="polite">Enregistrement en cours…</Text>}
      {invalid.size > 0 && <Text accessibilityRole="alert" style={styles.error}>Saisie incomplète ou hors limites : elle reste en brouillon. Les totaux utilisent les dernières valeurs valides.</Text>}
      {section.fields.length > 0 && draft.status === 'saved' && !invalid.size && <Text style={styles.notice}>Valeurs enregistrées localement. Continuer valide l’étape ; Passer la marque comme passée.</Text>}
      <View style={styles.row}>
        <Pressable disabled={busy} style={styles.secondary} onPress={() => void navigate(back)}><Text>← Retour</Text></Pressable>
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
});

const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 56, paddingBottom: 48, backgroundColor: '#fff', flexGrow: 1 },
  notice: { color: '#895000', marginBottom: 16 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#31333f', marginVertical: 8 },
  heading: { fontSize: 23, fontWeight: '600', color: '#31333f', marginVertical: 20 },
  field: { marginBottom: 14 }, label: { fontSize: 16, marginBottom: 8, color: '#31333f' },
  input: { backgroundColor: '#f0f2f6', borderRadius: 10, padding: 14, minHeight: 50, fontSize: 18, color: '#31333f', borderWidth: 1, borderColor: 'transparent' },
  invalid: { borderColor: '#b74a00' }, clear: { color: '#626570', paddingVertical: 12, alignSelf: 'flex-end' },
  secondary: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, padding: 14, minHeight: 48 },
  selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' }, primary: { backgroundColor: palette.primary, padding: 14, borderRadius: 10, minHeight: 48, flexGrow: 1, alignItems: 'center' },
  white: { color: '#fff', fontWeight: '600' }, total: { backgroundColor: '#e8f2fc', padding: 16, borderRadius: 12, fontSize: 18, marginVertical: 12 },
  error: { color: '#b42318', marginVertical: 12, lineHeight: 22 },
});
