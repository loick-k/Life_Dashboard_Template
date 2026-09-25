import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Catalogs, FRIEND_CATEGORIES, type CatalogItem, type CatalogKind, type LogItem } from '../storage/catalogs';

export type CatalogFormHandle = { flush(): Promise<void> };
export const CatalogForm = forwardRef<CatalogFormHandle, { database: SQLiteDatabase; entryId: string; kind: CatalogKind }>(function CatalogForm({ database, entryId, kind }, ref) {
  const repo = useMemo(() => new Catalogs(database, Crypto.randomUUID, kind), [database, kind]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('Ami');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const ready = useRef(false), failed = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const reload = async () => {
    const [nextItems, nextLogs] = await Promise.all([repo.list(false), repo.logs(entryId)]);
    setItems(nextItems); setLogs(nextLogs); ready.current = true;
  };
  const run = (action: () => Promise<void>) => {
    if (pending.current) return;
    setBusy(true);
    const task = action().then(reload);
    pending.current = task;
    void task.then(() => { failed.current = false; setError(''); }, () => {
      failed.current = true; setError('Opération non confirmée. Recharge les valeurs avant de réessayer.');
    }).finally(() => { pending.current = null; setBusy(false); });
  };
  useEffect(() => { run(async () => {}); }, [repo, entryId]);
  useImperativeHandle(ref, () => ({ flush: async () => {
    if (pending.current) await pending.current;
    if (!ready.current || failed.current || label.trim()) throw new Error('Catalogue non confirmé ou ajout non terminé');
  } }));
  const toggle = (item: CatalogItem) => {
    const log = logs.find(value => value.subject_id === item.id && (kind === 'friends' || value.worked === 1));
    run(async () => { if (log) await repo.deselect(log); else await repo.select(entryId, item.id); });
  };
  return <View>
    <Text>{kind === 'friends' ? 'Qui as-tu vu aujourd’hui ?' : 'As-tu contribué à tes objectifs ?'}</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {error ? <Pressable style={styles.button} disabled={busy} onPress={() => run(async () => {})}><Text>Recharger les valeurs</Text></Pressable> : null}
    {!items.length && !busy && <Text style={styles.hint}>Aucun élément enregistré. Ajoute le premier ci-dessous.</Text>}
    {items.filter(item => showArchived || item.active).map(item => {
      const selected = logs.some(log => log.subject_id === item.id && (kind === 'friends' || log.worked === 1));
      return <View key={item.id} style={styles.card}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} style={styles.button} onPress={() => toggle(item)}>
          <Text>{selected ? '☑' : '☐'} {item.label}{item.active ? '' : ' · archivé'}</Text>
        </Pressable>
        {item.category && <Text style={styles.hint}>{item.category}</Text>}
        <Pressable disabled={busy} style={styles.button} onPress={() => Alert.alert(item.active ? 'Archiver cet élément ?' : 'Réactiver cet élément ?', 'Le journal historique sera conservé.', [{ text: 'Annuler' }, { text: 'Confirmer', onPress: () => run(() => repo.setActive(item, !item.active)) }])}><Text>{item.active ? 'Archiver' : 'Réactiver'}</Text></Pressable>
      </View>;
    })}
    <Pressable style={styles.button} onPress={() => setShowArchived(value => !value)}><Text>{showArchived ? 'Masquer les archives' : 'Afficher les archives'}</Text></Pressable>
    <Text style={styles.heading}>{kind === 'friends' ? 'Ajouter une personne' : 'Ajouter un objectif'}</Text>
    <TextInput accessibilityLabel={kind === 'friends' ? 'Nom de la personne' : 'Titre de l’objectif'} style={styles.input} value={label} onChangeText={setLabel} placeholder={kind === 'friends' ? 'Nom' : 'Titre'} maxLength={200} editable={!busy} />
    {kind === 'friends' && <View style={styles.row}>{FRIEND_CATEGORIES.map(value => <Pressable key={value} style={[styles.button, category === value && styles.selected]} onPress={() => setCategory(value)}><Text>{value}</Text></Pressable>)}</View>}
    <Pressable style={[styles.button, styles.selected]} disabled={busy || !label.trim()} onPress={() => run(async () => {
      const id = await repo.create(label, category); setLabel(''); await repo.select(entryId, id);
    })}><Text>Ajouter et sélectionner</Text></Pressable>
    {kind === 'goals' && <Text style={styles.hint}>Jusqu’à trois objectifs actifs.</Text>}
    {busy && <Text accessibilityLiveRegion="polite">Enregistrement en cours…</Text>}
  </View>;
});
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, marginVertical: 10, padding: 8 },
  button: { minHeight: 48, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d5d6dc', marginVertical: 4 },
  selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { backgroundColor: '#f0f2f6', borderRadius: 8, minHeight: 48, padding: 14, fontSize: 18 },
  heading: { fontSize: 20, fontWeight: '600', marginVertical: 16 }, hint: { color: '#626570', marginVertical: 8 }, error: { color: '#b42318', marginVertical: 12 },
});
