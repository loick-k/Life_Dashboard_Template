import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { SPORT_TYPES, SportDraft, SportSessions, type SportPatch } from '../storage/sportSessions';
import { parseInput } from '../domain/input';

export type SportFormHandle = { flush(): Promise<void> };
export const SportForm = forwardRef<SportFormHandle, { database: SQLiteDatabase; entryId: string }>(function SportForm({ database, entryId }, ref) {
  const [drafts, setDrafts] = useState<SportDraft[]>([]);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const invalid = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [, repaint] = useState(0);
  const refresh = () => repaint(value => value + 1);
  useEffect(() => {
    let active = true;
    const repo = new SportSessions(database, Crypto.randomUUID);
    Promise.all([1, 2, 3].map(async position => new SportDraft(repo, await repo.getOrCreate(entryId, position))))
      .then(rows => { if (active) setDrafts(rows); }, () => { if (active) setError('Chargement des séances impossible.'); });
    return () => { active = false; };
  }, [database, entryId]);
  useImperativeHandle(ref, () => ({ flush: async () => {
    if (drafts.length !== 3 || invalid.current.size) throw new Error('Saisie sportive incomplète ou invalide');
    await Promise.all(drafts.map(draft => draft.flush()));
  } }));
  const save = (draft: SportDraft, patch: SportPatch) => {
    try { draft.edit(patch); refresh(); void draft.flush().then(refresh, () => { setError('Sauvegarde sportive non confirmée. Réessaie avant de quitter.'); refresh(); }); }
    catch { setError('Valeur sportive invalide.'); }
  };
  const clear = (draft: SportDraft, kind: 'distance' | 'duration') => Alert.alert('Effacer cette valeur ?', 'Les autres données de la séance seront conservées.', [
    { text: 'Annuler' }, { text: 'Effacer', style: 'destructive', onPress: () => {
      const id = draft.snapshot.session_id;
      const keys = kind === 'distance' ? [`${id}:distance`] : [`${id}:hours`, `${id}:minutes`];
      keys.forEach(key => invalid.current.delete(key));
      setRaw(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, ''])) }));
      save(draft, kind === 'distance' ? { distance_km: null } : { duration_minutes: null });
    } },
  ]);
  const edit = (draft: SportDraft, part: 'distance' | 'hours' | 'minutes', text: string) => {
    const row = draft.snapshot;
    const key = `${row.session_id}:${part}`;
    const nextRaw = { ...raw, [key]: text }; setRaw(nextRaw);
    const value = parseInput(text, 'number');
    let valid = typeof value === 'number';
    if (part === 'distance') {
      valid = valid && Number(value) <= 200;
      if (valid) save(draft, { distance_km: Number(value) });
    } else {
      const base = row.duration_minutes;
      const h = nextRaw[`${row.session_id}:hours`] ?? (base === null ? '' : String(Math.floor(base / 60)));
      const m = nextRaw[`${row.session_id}:minutes`] ?? (base === null ? '' : String(base % 60));
      const hours = h === '' ? 0 : parseInput(h, 'number');
      const minutes = m === '' ? 0 : parseInput(m, 'number');
      valid = valid && typeof hours === 'number' && typeof minutes === 'number' && Number.isInteger(hours) && Number.isInteger(minutes) && minutes < 60 && hours * 60 + minutes <= 600;
      if (valid) save(draft, { duration_minutes: Number(hours) * 60 + Number(minutes) });
    }
    if (valid) invalid.current.delete(key); else invalid.current.add(key);
    refresh();
  };
  return <View>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {!drafts.length && <Text>Chargement des séances…</Text>}
    {drafts.map(draft => {
      const row = draft.snapshot;
      return <View key={row.session_id} style={styles.card}>
        <Text style={styles.title}>Séance {row.position}</Text>
        <View style={styles.row}>{SPORT_TYPES.map(type => <Pressable accessibilityRole="button" accessibilityState={{ selected: row.sport_type === type }} key={type} style={[styles.choice, row.sport_type === type && styles.selected]} onPress={() => save(draft, { sport_type: type })}><Text>{type}</Text></Pressable>)}</View>
        {(['hours', 'minutes', 'distance'] as const).map(part => {
          const key = `${row.session_id}:${part}`;
          const label = part === 'hours' ? 'Heures' : part === 'minutes' ? 'Minutes' : 'Distance (km)';
          const value = part === 'distance' ? row.distance_km : row.duration_minutes === null ? null : part === 'hours' ? Math.floor(row.duration_minutes / 60) : row.duration_minutes % 60;
          return <View key={part}><Text>{label}</Text><TextInput accessibilityLabel={`Séance ${row.position} · ${label}`} keyboardType="decimal-pad" value={raw[key] ?? String(value ?? '')} placeholder="Non renseigné" onChangeText={text => edit(draft, part, text)} style={[styles.input, invalid.current.has(key) && styles.invalid]} /></View>;
        })}
        <View style={styles.row}><Pressable style={styles.choice} onPress={() => clear(draft, 'duration')}><Text>Effacer la durée</Text></Pressable><Pressable style={styles.choice} onPress={() => clear(draft, 'distance')}><Text>Effacer la distance</Text></Pressable></View>
        {draft.status === 'saving' && <Text>Enregistrement en cours…</Text>}
        {draft.status === 'failed' && <Pressable style={styles.choice} onPress={() => { void draft.retry().then(() => { setError(''); refresh(); }, refresh); }}><Text>Réessayer</Text></Pressable>}
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
