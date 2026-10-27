import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { SPORT_TYPES, SportDraft, SportSessions, type SportPatch } from '../storage/sportSessions';
import { parseInput } from '../domain/input';
import { parseSportDuration } from '../domain/sportInput';
import { settleWrites } from '../storage/settleWrites';
import { resolveSportDraft } from '../storage/sportRecovery';
import { SportConflictReview, type SportReview } from './SportConflictReview';
import { sportBuffers, type SportField } from '../storage/sportBuffers';
import type { BufferedEditor } from '../storage/bufferedEditor';
import type { BufferInputs } from '../storage/fieldBuffers';

export type SportFormHandle = { flush(): Promise<void>; settle(): Promise<void>; hasUnconfirmed(): boolean };
export const SportForm = forwardRef<SportFormHandle, { database: SQLiteDatabase; entryId: string }>(function SportForm({ database, entryId }, ref) {
  const [drafts, setDrafts] = useState<SportDraft[]>([]);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const rawRef = useRef<Record<string, string>>({});
  const [expanded, setExpanded] = useState<number[]>([1]);
  const invalid = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loading = useRef<Promise<void>>(Promise.resolve());
  const rows = useRef<SportDraft[]>([]);
  const journals = useRef(new Map<string, BufferedEditor<SportField>>());
  const loadingFailed = useRef(false);
  const [review, setReview] = useState<SportReview>();
  const currentReview = useRef<SportReview | undefined>(undefined);
  const recovery = useRef<Promise<void> | null>(null);
  const [recovering, setRecovering] = useState(false);
  const showReview = (value: SportReview | undefined) => { currentReview.current = value; setReview(value); };
  const [, repaint] = useState(0);
  const refresh = () => repaint(value => value + 1);
  const setBuffers = (update: (previous: Record<string, string>) => Record<string, string>) => {
    rawRef.current = update(rawRef.current); setRaw(rawRef.current);
  };
  useEffect(() => {
    let active = true;
    const repo = new SportSessions(database, Crypto.randomUUID);
    loadingFailed.current = false;
    loading.current = (async () => {
      const results = await Promise.allSettled([1, 2, 3].map(async position => {
        const row = await repo.getOrCreate(entryId, position);
        const journal = sportBuffers(database, row.session_id, Crypto.randomUUID, kind => {
          if (kind === 'storage') setError('Conservation du brouillon sportif non confirmée. Garde cet écran ouvert et réessaie.');
          if (kind === 'business') setError('Sauvegarde sportive non confirmée. Le brouillon est conservé sur cet appareil ; compare les valeurs.');
          refresh();
        });
        const records = await journal.read(row); return { draft: new SportDraft(repo, row), journal, records };
      }));
      if (results.some(result => result.status === 'rejected')) {
        loadingFailed.current = true;
        if (active) setError('Chargement des séances impossible. Les valeurs enregistrées sont conservées.');
        return;
      }
      if (active) {
        const loaded = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        rows.current = loaded.map(value => value.draft); journals.current = new Map();
        const restoredRaw: Record<string, string> = {}; invalid.current.clear(); const opened = [1];
        for (const { draft, journal, records } of loaded) {
          const row = draft.snapshot; journals.current.set(row.session_id, journal);
          for (const [key, record] of Object.entries(records)) {
            if ('hours' in record.raw) { restoredRaw[`${row.session_id}:hours`] = record.raw.hours; restoredRaw[`${row.session_id}:minutes`] = record.raw.minutes; }
            else if (key === 'distance_km') restoredRaw[`${row.session_id}:distance`] = record.raw.value;
          }
          if (journal.invalid.has('duration_minutes')) { invalid.current.add(`${row.session_id}:hours`); invalid.current.add(`${row.session_id}:minutes`); }
          if (journal.invalid.has('distance_km')) invalid.current.add(`${row.session_id}:distance`);
          if (journal.hasUnconfirmed()) opened.push(row.position);
        }
        setBuffers(() => restoredRaw); setExpanded([...new Set(opened)]); setDrafts(rows.current); setError('');
      }
    })();
    return () => { active = false; };
  }, [database, entryId, loadAttempt]);
  const settle = async () => {
    if (recovery.current) await recovery.current;
    await loading.current;
    await settleWrites([...journals.current.values()].map(journal => journal.settle()));
    await settleWrites(rows.current.map(draft => draft.flush()));
    await settleWrites([...journals.current.values()].map(journal => journal.settle()));
    if (loadingFailed.current) throw new Error('Chargement sportif non confirmé');
  };
  useImperativeHandle(ref, () => ({
    settle,
    hasUnconfirmed: () => !!recovery.current || !!currentReview.current || loadingFailed.current || rows.current.length !== 3 || invalid.current.size > 0 || [...journals.current.values()].some(journal => journal.hasUnconfirmed()) || rows.current.some(draft => draft.status !== 'saved'),
    flush: async () => {
    await settle();
    if (invalid.current.size || [...journals.current.values()].some(journal => journal.invalid.size > 0)) {
      setExpanded(current => [...new Set([...current, ...rows.current.filter(draft => [...invalid.current].some(key => key.startsWith(`${draft.snapshot.session_id}:`)) || journals.current.get(draft.snapshot.session_id)?.invalid.size).map(draft => draft.snapshot.position)])]);
      setError('Corrige les durées ou distances signalées, ou supprime explicitement la valeur.');
    }
    if (rows.current.length !== 3 || invalid.current.size || currentReview.current || [...journals.current.values()].some(journal => journal.needsComparison() || journal.invalid.size > 0)) throw new Error('Saisie sportive incomplète ou invalide');
    await settleWrites(rows.current.map(draft => draft.flush()));
  } }));
  const locked = (id: string) => !!recovery.current || currentReview.current?.id === id || !!journals.current.get(id)?.needsComparison();
  const save = (draft: SportDraft, patch: SportPatch, buffers?: BufferInputs<SportField>) => {
    if (locked(draft.snapshot.session_id)) return;
    try {
      const journal = journals.current.get(draft.snapshot.session_id); if (!journal) throw new Error('Brouillon non chargé');
      const inputs: BufferInputs<SportField> = buffers ?? Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, {
        clear: value === null,
        raw: key === 'duration_minutes' ? { hours: value === null ? '' : String(Math.floor(Number(value) / 60)), minutes: value === null ? '' : String(Number(value) % 60) } : { value: value === null ? '' : String(value) },
      }]));
      void journal.submit(inputs, async fields => { draft.edit(fields as SportPatch); refresh(); await draft.flush(); return draft.snapshot; });
    }
    catch { setError('Valeur sportive invalide.'); }
  };
  const recover = (action: () => Promise<void>) => {
    if (recovery.current) return;
    setRecovering(true);
    recovery.current = Promise.resolve().then(action).catch(() => setError('Comparaison ou résolution non confirmée. Le brouillon initial est conservé. Relis la comparaison avant de réessayer.')).finally(() => { recovery.current = null; setRecovering(false); });
  };
  const compare = (draft: SportDraft) => recover(async () => {
    const journal = journals.current.get(draft.snapshot.session_id); await journal?.settle();
    const latest = await new SportSessions(database, Crypto.randomUUID).read(draft.snapshot.session_id);
    const pending = { ...journal?.recovered, ...draft.pendingPatch } as SportPatch;
    showReview({ id: latest.session_id, latest, pending, choices: Object.fromEntries(Object.keys(pending).filter(key => pending[key as keyof SportPatch] === latest[key as keyof SportPatch]).map(key => [key, 'database'])) });
    setError('');
  });
  const resolve = () => {
    const reviewed = currentReview.current;
    if (!reviewed || Object.keys(reviewed.pending).some(key => !reviewed.choices[key])) return;
    recover(async () => {
      const resolved = await resolveSportDraft(new SportSessions(database, Crypto.randomUUID), reviewed.latest, reviewed.pending, Object.keys(reviewed.choices).filter(key => reviewed.choices[key] === 'draft'));
      const replaced = Object.keys(reviewed.choices).filter(key => reviewed.choices[key] === 'database');
      const buffers = replaced.flatMap(key => key === 'duration_minutes' ? ['hours', 'minutes'] : key === 'distance_km' ? ['distance'] : []).map(key => `${reviewed.id}:${key}`);
      buffers.forEach(key => invalid.current.delete(key));
      setBuffers(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !buffers.includes(key))));
      rows.current = rows.current.map(draft => draft.snapshot.session_id === reviewed.id ? resolved : draft); setDrafts(rows.current);
      showReview(undefined); setError('Choix enregistrés. Les autres séances et brouillons sont conservés.');
      await journals.current.get(reviewed.id)?.resolved(resolved.snapshot, replaced);
    });
  };
  const clear = (draft: SportDraft, kind: 'distance' | 'duration') => Alert.alert('Effacer cette valeur ?', 'Les autres données de la séance seront conservées.', [
    { text: 'Annuler' }, { text: 'Effacer', style: 'destructive', onPress: () => {
      const id = draft.snapshot.session_id;
      if (locked(id)) return;
      const keys = kind === 'distance' ? [`${id}:distance`] : [`${id}:hours`, `${id}:minutes`];
      keys.forEach(key => invalid.current.delete(key));
      setBuffers(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, ''])) }));
      save(draft, kind === 'distance' ? { distance_km: null } : { duration_minutes: null });
    } },
  ]);
  const edit = (draft: SportDraft, part: 'distance' | 'hours' | 'minutes', text: string) => {
    const row = draft.snapshot;
    if (locked(row.session_id)) return;
    const key = `${row.session_id}:${part}`;
    const nextRaw = { ...rawRef.current, [key]: text }; setBuffers(() => nextRaw);
    const value = parseInput(text, 'number');
    let valid = typeof value === 'number';
    if (part === 'distance') {
      valid = valid && Number(value) <= 200;
      save(draft, {}, { distance_km: { raw: { value: text } } });
    } else {
      const base = row.duration_minutes;
      const h = nextRaw[`${row.session_id}:hours`] ?? (base === null ? '' : String(Math.floor(base / 60)));
      const m = nextRaw[`${row.session_id}:minutes`] ?? (base === null ? '' : String(base % 60));
      const duration = parseSportDuration(h, m);
      valid = duration.valid;
      for (const field of ['hours', 'minutes']) {
        const partKey = `${row.session_id}:${field}`;
        if (valid) invalid.current.delete(partKey); else invalid.current.add(partKey);
      }
      save(draft, {}, { duration_minutes: { raw: { hours: h, minutes: m } } });
    }
    if (valid) invalid.current.delete(key); else invalid.current.add(key);
    refresh();
  };
  return <View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {loadingFailed.current && <Pressable accessibilityRole="button" style={styles.choice} onPress={() => setLoadAttempt(value => value + 1)}><Text>Réessayer le chargement des séances</Text></Pressable>}
    {!drafts.length && <Text>Chargement des séances…</Text>}
    {drafts.map(draft => {
      const row = draft.snapshot;
      const journal = journals.current.get(row.session_id);
      const disabled = recovering || review?.id === row.session_id || journal?.needsComparison();
      return <View key={row.session_id} style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded.includes(row.position) }} style={styles.choice} onPress={() => setExpanded(current => current.includes(row.position) ? current.filter(value => value !== row.position) : [...current, row.position])}>
          <Text style={styles.title}>Séance {row.position} · {row.sport_type ?? 'À renseigner'} {expanded.includes(row.position) ? '−' : '+'}</Text>
        </Pressable>
        {expanded.includes(row.position) && <>
        <View style={styles.row}>{SPORT_TYPES.map(type => <Pressable accessibilityRole="button" disabled={!!disabled} accessibilityState={{ selected: row.sport_type === type, disabled: !!disabled }} key={type} style={[styles.choice, row.sport_type === type && styles.selected]} onPress={() => save(draft, { sport_type: type })}><Text>{type}</Text></Pressable>)}</View>
        {(['hours', 'minutes', 'distance'] as const).map(part => {
          const key = `${row.session_id}:${part}`;
          const label = part === 'hours' ? 'Heures' : part === 'minutes' ? 'Minutes' : 'Distance (km)';
          const value = part === 'distance' ? row.distance_km : row.duration_minutes === null ? null : part === 'hours' ? Math.floor(row.duration_minutes / 60) : row.duration_minutes % 60;
          return <View key={part}><Text>{label}</Text><TextInput editable={!disabled} accessibilityLabel={`Séance ${row.position} · ${label}`} keyboardType="decimal-pad" value={raw[key] ?? String(value ?? '')} placeholder="Non renseigné" onChangeText={text => edit(draft, part, text)} style={[styles.input, invalid.current.has(key) && styles.invalid]} /></View>;
        })}
        <View style={styles.row}><Pressable disabled={!!disabled} style={styles.choice} onPress={() => clear(draft, 'duration')}><Text>Effacer la durée</Text></Pressable><Pressable disabled={!!disabled} style={styles.choice} onPress={() => clear(draft, 'distance')}><Text>Effacer la distance</Text></Pressable></View>
        <Pressable disabled={!!disabled} accessibilityRole="button" style={styles.choice} onPress={() => Alert.alert('Supprimer cette séance ?', 'Le type, la durée et la distance de cette seule séance seront effacés. Les autres séances sont conservées.', [
          { text: 'Annuler', style: 'cancel' }, { text: 'Supprimer', style: 'destructive', onPress: () => {
            if (locked(row.session_id)) return;
            const prefix = `${row.session_id}:`;
            for (const part of ['hours', 'minutes', 'distance']) invalid.current.delete(prefix + part);
            setBuffers(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(prefix))));
            save(draft, { sport_type: null, duration_minutes: null, distance_km: null });
          } },
        ])}><Text>Supprimer cette séance</Text></Pressable>
        </>}
        {journal?.restored && <Text accessibilityRole="alert">Brouillon sportif retrouvé sur cet appareil. Les valeurs incomplètes restent à terminer ; une intention non confirmée doit être comparée. Aucun rejeu automatique.</Text>}
        {journal?.storageFailed() && <Pressable accessibilityRole="button" disabled={recovering || !!review} style={styles.choice} onPress={() => { if (!recovery.current && !currentReview.current) void journal.retry(); }}><Text>Réessayer la conservation de la séance {row.position}</Text></Pressable>}
        {(draft.status === 'saving' || journal?.isWorking()) && <Text accessibilityLiveRegion="polite">Enregistrement en cours…</Text>}
        {!!journal?.invalid.size && <Text accessibilityRole="alert" style={styles.error}>Brouillon incomplet : termine les valeurs signalées ou efface-les explicitement.</Text>}
        {draft.status === 'failed' && <>
          <Pressable disabled={!!disabled} style={styles.choice} onPress={() => { if (!locked(row.session_id)) void draft.retry().then(async () => { setError(''); await journal?.resolved(draft.snapshot, []); refresh(); }, refresh); }}><Text>Réessayer</Text></Pressable>
        </>}
        {(draft.status === 'failed' || journal?.needsComparison()) && <Pressable accessibilityRole="button" disabled={recovering || !!review} style={styles.choice} onPress={() => compare(draft)}><Text>Comparer la séance {row.position} aux valeurs enregistrées</Text></Pressable>}
        {review?.id === row.session_id && <SportConflictReview review={review} busy={recovering} onChoice={(key, choice) => { if (currentReview.current && !recovery.current) showReview({ ...currentReview.current, choices: { ...currentReview.current.choices, [key]: choice } }); }} onApply={resolve} onReload={() => compare(draft)} onClose={() => { if (!recovery.current) showReview(undefined); }} />}
      </View>;
    })}
  </View>;
});
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 12, padding: 16, marginVertical: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }, title: { fontSize: 20, fontWeight: '600', color: '#31333f' },
  choice: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8, minHeight: 48, padding: 12 }, selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' },
  input: { backgroundColor: '#f0f2f6', padding: 14, fontSize: 18, borderRadius: 8, marginVertical: 8, minHeight: 48, borderWidth: 1, borderColor: 'transparent' }, invalid: { borderColor: '#b74a00' }, error: { color: '#b42318', marginVertical: 12 },
});
