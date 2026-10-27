import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Catalogs, FRIEND_CATEGORIES, type CatalogItem, type CatalogKind, type LogItem } from '../storage/catalogs';
import { JournalEditor, type JournalEditorHandle } from './JournalEditor';
import { settleWrites } from '../storage/settleWrites';
import { CatalogAddition } from '../storage/catalogAddition';

export type CatalogFormHandle = { flush(): Promise<void>; settle(): Promise<void>; beforeClose(): Promise<void>; hasUnconfirmed(): boolean };
export const CatalogForm = forwardRef<CatalogFormHandle, { database: SQLiteDatabase; entryId?: string; kind: CatalogKind; active?: boolean }>(function CatalogForm({ database, entryId, kind, active = true }, ref) {
  const repo = useMemo(() => new Catalogs(database, Crypto.randomUUID, kind), [database, kind]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [additionAttempt, setAdditionAttempt] = useState(0), [additionError, setAdditionError] = useState('');
  const [, repaintAddition] = useState(0);
  const addition = useMemo(() => new CatalogAddition(database, kind, entryId ? `day-${entryId}` : 'standalone', Crypto.randomUUID, failed => {
    if (failed) setAdditionError('Conservation du brouillon d’ajout non confirmée. Garde cet écran ouvert et réessaie.');
    repaintAddition(value => value + 1);
  }), [database, kind, entryId]);
  const additionLoading = useRef<Promise<void>>(Promise.resolve());
  const label = addition.snapshot?.label ?? '', category = addition.snapshot?.category ?? 'Ami';
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const ready = useRef(false), failed = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  useEffect(() => {
    additionLoading.current = addition.read().then(() => setAdditionError(''), () => setAdditionError('Brouillon d’ajout indisponible ou incompatible. Aucune donnée réinitialisée.'));
  }, [addition, additionAttempt]);
  const editors = useRef(new Map<string, JournalEditorHandle>());
  const flushJournals = async () => {
    try { await settleWrites([...editors.current.values()].map(editor => editor.flush())); }
    catch (issue) { setShowArchived(true); throw issue; } // A retained draft must never block navigation invisibly under an archive.
  };
  const reload = async () => {
    const [nextItems, nextLogs] = await Promise.all([repo.list(false), entryId ? repo.logs(entryId, true) : Promise.resolve([])]);
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
  useEffect(() => { if (active) run(async () => {}); }, [repo, entryId, active]);
  useImperativeHandle(ref, () => ({
    settle: async () => { await additionLoading.current; if (pending.current) await pending.current; await addition.settle(); await settleWrites([...editors.current.values()].map(editor => editor.settle())); if (failed.current) throw new Error('Journal non confirmé'); },
    hasUnconfirmed: () => !!pending.current || failed.current || addition.hasUnconfirmed() || [...editors.current.values()].some(editor => editor.hasUnconfirmed()),
    beforeClose: async () => {
      // A failed read is not a draft. Wait for any action, but do not trap the
      // standalone directory when its storage remains temporarily unreadable.
      if (pending.current) try { await pending.current; } catch { /* Existing data stays in SQLite. */ }
      await additionLoading.current;
      if (addition.loaded) { await addition.settle(); if (addition.hasUnconfirmed()) throw new Error('Ajout non terminé'); }
      await flushJournals();
    },
    flush: async () => {
    await additionLoading.current; if (pending.current) await pending.current;
    await addition.settle();
    await flushJournals();
    if (!ready.current || failed.current || addition.hasUnconfirmed()) throw new Error('Catalogue non confirmé ou ajout non terminé');
  } }));
  const toggle = (item: CatalogItem) => {
    if (!entryId) return;
    const wasSelected = logs.some(value => value.subject_id === item.id && (kind === 'friends' ? value.included === 1 : value.worked === 1));
    run(async () => {
      await flushJournals();
      const current = (await repo.logs(entryId, true)).find(value => value.subject_id === item.id);
      let id = current?.id;
      if (wasSelected) { if (current && (kind === 'friends' ? current.included === 1 : current.worked === 1)) await repo.deselect(current); }
      else id = (await repo.select(entryId, item.id)).id;
      if (id) await editors.current.get(id)?.reload();
    });
  };
  const mutate = (action: () => Promise<void>) => run(async () => { await flushJournals(); await action(); });
  return <View>
    <Text>{entryId ? kind === 'friends' ? 'Qui as-tu vu pour cette journée ?' : 'As-tu contribué à tes objectifs pour cette journée ?' : 'Ce répertoire est indépendant des journées. Ajouter ou archiver un élément ne crée aucune interaction ni contribution.'}</Text>
    {!!message && <Text accessibilityLiveRegion="polite" style={styles.hint}>{message}</Text>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {error ? <Pressable style={styles.button} disabled={busy} onPress={() => run(async () => {})}><Text>Recharger les valeurs</Text></Pressable> : null}
    {!items.length && !busy && <Text style={styles.hint}>Aucun élément enregistré. Ajoute le premier ci-dessous.</Text>}
    {items.map(item => {
      const log = logs.find(log => log.subject_id === item.id);
      const selected = !!log && (kind === 'friends' ? log.included === 1 : log.worked === 1);
      const hidden = !showArchived && !item.active;
      return <View key={item.id} style={[styles.card, hidden && { display: 'none' }]} accessibilityElementsHidden={!!hidden} importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}>
        {entryId ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: busy }} disabled={busy} style={styles.button} onPress={() => toggle(item)}>
          <Text>{selected ? '☑' : '☐'} {item.label}{item.completed_at ? ' · terminé' : item.active ? '' : ' · archivé'}</Text>
        </Pressable> : <Text style={styles.heading}>{item.label}{item.completed_at ? ' · terminé' : item.active ? '' : ' · archivé'}</Text>}
        {item.category && <Text style={styles.hint}>{item.category}</Text>}
        {log && <>
          {!selected && <Text style={styles.hint}>Non compté pour cette journée · détails conservés.</Text>}
          <JournalEditor ref={editor => { if (editor) editors.current.set(log.id, editor); else editors.current.delete(log.id); }} database={database} kind={kind} id={log.id} label={item.label} disabled={busy || !active} onSaved={row => setLogs(current => current.map(value => value.id === row.id ? { ...value, revision: row.revision, ...(row.included !== undefined ? { included: row.included } : {}), ...(row.worked !== undefined ? { worked: row.worked } : {}) } : value))} />
        </>}
        {!item.completed_at && <Pressable disabled={busy} style={styles.button} onPress={() => Alert.alert(item.active ? 'Archiver cet élément ?' : 'Réactiver cet élément ?', 'Le journal historique et les dates de réalisation seront conservés.', [{ text: 'Annuler' }, { text: 'Confirmer', onPress: () => mutate(() => repo.setActive(item, !item.active)) }])}><Text>{item.active ? 'Archiver' : 'Réactiver'}</Text></Pressable>}
        {kind === 'goals' && <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => Alert.alert(item.completed_at ? 'Rouvrir cet objectif ?' : 'Terminer cet objectif ?', item.completed_at ? 'La date de réalisation sera retirée et cet objectif redeviendra actif. Son journal reste conservé.' : 'Cet objectif sera marqué comme terminé, avec sa date de réalisation. Il ne comptera plus parmi les trois objectifs actifs.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Confirmer', onPress: () => mutate(() => repo.setCompleted(item, !item.completed_at)) }])}><Text>{item.completed_at ? 'Rouvrir cet objectif' : 'Marquer comme terminé'}</Text></Pressable>}
      </View>;
    })}
    <Pressable style={styles.button} onPress={() => setShowArchived(value => !value)}><Text>{showArchived ? 'Masquer les archives' : 'Afficher les archives'}</Text></Pressable>
    <Text style={styles.heading}>{kind === 'friends' ? 'Ajouter une personne' : 'Ajouter un objectif'}</Text>
    {additionError && <Text accessibilityRole="alert" style={styles.error}>{additionError}</Text>}
    {!addition.loaded && <Pressable accessibilityRole="button" style={styles.button} onPress={() => setAdditionAttempt(value => value + 1)}><Text>Relire le brouillon d’ajout</Text></Pressable>}
    {addition.restored && <Text style={styles.hint}>Brouillon d’ajout retrouvé, sans création ni sélection automatique.</Text>}
    {addition.snapshot?.phase === 'prepared' && <Text accessibilityRole="alert" style={styles.hint}>Ajout en attente de confirmation : le bouton Ajouter reprend le même identifiant, sans doublon. Vérifie le répertoire avant un abandon.</Text>}
    <TextInput accessibilityLabel={kind === 'friends' ? 'Nom de la personne' : 'Titre de l’objectif'} style={styles.input} value={label} onChangeText={text => { if (!busy && active) { try { void addition.edit(text, category); } catch { setAdditionError('Ajout non modifiable tant que sa confirmation est en attente.'); } } }} placeholder={kind === 'friends' ? 'Nom' : 'Titre'} maxLength={200} editable={!busy && !addition.isMutating() && active && addition.loaded && addition.snapshot?.phase !== 'prepared'} />
    {kind === 'friends' && <View style={styles.row}>{FRIEND_CATEGORIES.map(value => <Pressable accessibilityRole="button" accessibilityState={{ selected: category === value, disabled: busy || addition.isMutating() || addition.snapshot?.phase === 'prepared' }} disabled={busy || addition.isMutating() || !active || !addition.loaded || addition.snapshot?.phase === 'prepared'} key={value} style={[styles.button, category === value && styles.selected]} onPress={() => { if (!pending.current && active) { try { void addition.edit(label, value); } catch { setAdditionError('Ajout en attente de confirmation.'); } } }}><Text>{value}</Text></Pressable>)}</View>}
    {addition.storageFailed() && <Pressable accessibilityRole="button" disabled={busy || !active} style={styles.button} onPress={() => { void addition.retry().then(() => setAdditionError(''), () => setAdditionError('Conservation toujours non confirmée. Le texte reste affiché.')); }}><Text>Réessayer la conservation de l’ajout</Text></Pressable>}
    {addition.storageFailed() && <Pressable accessibilityRole="button" disabled={busy || addition.isWorking() || !active} style={styles.button} onPress={() => Alert.alert('Relire le brouillon enregistré ?', 'Le texte local non confirmé sera abandonné au profit du brouillon enregistré sur cet appareil. Aucun élément déjà créé ni journal ne sera supprimé.', [{ text: 'Garder mon texte', style: 'cancel' }, { text: 'Relire', onPress: () => { if (!pending.current && active) void addition.read().then(() => setAdditionError(''), () => setAdditionError('Brouillon toujours indisponible. Le texte local est conservé.')); } }])}><Text>Relire le brouillon enregistré</Text></Pressable>}
    <Pressable accessibilityRole="button" style={[styles.button, styles.selected]} disabled={busy || addition.isMutating() || !active || !addition.loaded || !label.trim()} onPress={() => run(async () => {
      await addition.create(repo); setAdditionError('');
      setMessage(entryId ? 'Élément ajouté au répertoire. Coche-le séparément si une interaction ou une contribution a eu lieu pour cette journée.' : 'Élément ajouté au répertoire, sans modifier les journées.');
    })}><Text>{kind === 'friends' ? 'Ajouter la personne' : 'Ajouter l’objectif'}</Text></Pressable>
    {!!addition.snapshot && <Pressable accessibilityRole="button" disabled={busy || addition.isMutating() || !active} style={styles.button} onPress={() => Alert.alert('Annuler cet ajout ?', 'Le brouillon et son suivi local seront abandonnés, sans supprimer un élément déjà enregistré ni ses journaux. Si une création était en attente, vérifie le répertoire avant de recommencer.', [{ text: 'Garder', style: 'cancel' }, { text: 'Abandonner cet ajout', style: 'destructive', onPress: () => { if (!pending.current && active) { void addition.abandon().then(() => setAdditionError(''), () => setAdditionError('Abandon non confirmé. Aucun texte ni élément supprimé automatiquement.')); } } }])}><Text>Annuler cet ajout</Text></Pressable>}
    {kind === 'goals' && <Text style={styles.hint}>Jusqu’à trois objectifs actifs.</Text>}
    {(busy || addition.isWorking()) && <Text accessibilityLiveRegion="polite">Enregistrement en cours…</Text>}
  </View>;
});
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, marginVertical: 10, padding: 8 },
  button: { minHeight: 48, padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d5d6dc', marginVertical: 4 },
  selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { backgroundColor: '#f0f2f6', borderRadius: 8, minHeight: 48, padding: 14, fontSize: 18 },
  heading: { fontSize: 20, fontWeight: '600', marginVertical: 16 }, hint: { color: '#626570', marginVertical: 8 }, error: { color: '#b42318', marginVertical: 12 },
});
