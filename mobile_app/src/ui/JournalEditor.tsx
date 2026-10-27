import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { SqlConnection } from '../storage/migrations';
import type { CatalogKind } from '../storage/catalogs';
import { JournalDraft, Journals, resolveJournalDraft, type JournalPatch, type JournalRecord } from '../storage/journals';
import { formatMinutes } from '../domain/workReport';
import { journalBuffers, type JournalField } from '../storage/journalBuffers';
import type { BufferedEditor } from '../storage/bufferedEditor';
import type { BufferInputs, BufferRecords } from '../storage/fieldBuffers';

export interface JournalEditorHandle { settle(): Promise<void>; flush(): Promise<void>; reload(): Promise<void>; hasUnconfirmed(): boolean }
type Review = { latest: JournalRecord; pending: JournalPatch; choices: Record<string, 'draft' | 'database'> };
const names: Record<keyof JournalPatch, string> = { note: 'Note', context: 'Contexte', duration_minutes: 'Durée' };
export const JournalEditor = forwardRef<JournalEditorHandle, { database: SqlConnection; kind: CatalogKind; id: string; label: string; disabled?: boolean; onSaved?(row: JournalRecord): void }>(function JournalEditor({ database, kind, id, label, disabled = false, onSaved }, ref) {
  const repository = useMemo(() => new Journals(database, kind), [database, kind]);
  const draft = useRef<JournalDraft | undefined>(undefined), buffers = useRef<Record<string, string>>({});
  const durable = useRef<BufferedEditor<JournalField> | undefined>(undefined);
  const invalid = useRef(new Set<string>()), review = useRef<Review | undefined>(undefined);
  const loading = useRef<Promise<void>>(Promise.resolve()), operation = useRef<Promise<void> | null>(null);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(''), [, repaint] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const refresh = () => repaint(value => value + 1);
  const accept = (row: JournalRecord, editor: BufferedEditor<JournalField>, records: BufferRecords<JournalField>) => {
    const raw: Record<string, string> = {};
    for (const [key, record] of Object.entries(records)) {
      if ('hours' in record.raw) { raw.hours = record.raw.hours; raw.minutes = record.raw.minutes; }
      else raw[key] = record.raw.value;
    }
    draft.current = new JournalDraft(repository, row); durable.current = editor; buffers.current = raw; invalid.current = new Set(editor.invalid);
    if (editor.hasUnconfirmed()) setExpanded(true); setError(''); refresh();
  };
  useEffect(() => {
    let active = true;
    loading.current = (async () => {
      try {
        const row = await repository.read(id);
        const editor = journalBuffers(database, kind, id, Crypto.randomUUID, issue => {
          if (issue === 'storage') setError('Conservation des détails non confirmée. Garde cet écran ouvert et réessaie.');
          if (issue === 'business') setError('Détails non enregistrés. Le brouillon est conservé sur cet appareil ; réessaie ou compare les valeurs.');
          refresh();
        });
        const records = await editor.read(row); if (active) accept(row, editor, records);
      } catch { if (active) setError('Journal indisponible ou brouillon incompatible. Les détails enregistrés sont conservés.'); }
    })();
    return () => { active = false; };
  }, [repository, id, attempt]);
  const settle = async () => {
    await loading.current; if (operation.current) await operation.current;
    if (!draft.current) throw new Error('Journal non chargé');
    await durable.current?.settle();
    await draft.current.flush();
    await durable.current?.settle();
  };
  useImperativeHandle(ref, () => ({
    settle,
    hasUnconfirmed: () => !draft.current || !!operation.current || !!review.current || invalid.current.size > 0 || !!durable.current?.hasUnconfirmed() || draft.current.status !== 'saved',
    flush: async () => {
      try { await settle(); if (invalid.current.size || review.current || durable.current?.invalid.size || durable.current?.needsComparison()) throw new Error('Détails de journal à terminer'); }
      catch (issue) { setExpanded(true); throw issue; }
    },
    reload: async () => {
      await settle(); if (invalid.current.size || review.current || durable.current?.invalid.size || durable.current?.needsComparison()) throw new Error('Détails à conserver');
      const row = await repository.read(id), editor = durable.current;
      if (!editor) throw new Error('Brouillon non chargé');
      accept(row, editor, await editor.read(row)); onSaved?.(row);
    },
  }));
  const locked = () => disabled || !!operation.current || !!review.current || !!durable.current?.needsComparison();
  const save = (patch: JournalPatch, raw?: BufferInputs<JournalField>) => {
    const target = draft.current, editor = durable.current;
    if (!target || !editor || locked()) return;
    try {
      const inputs: BufferInputs<JournalField> = raw ?? Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, {
        clear: value === null,
        raw: key === 'duration_minutes' ? { hours: value === null ? '' : String(Math.floor(Number(value) / 60)), minutes: value === null ? '' : String(Number(value) % 60) } : { value: value === null ? '' : String(value) },
      }]));
      void editor.submit(inputs, async fields => { target.edit(fields as JournalPatch); refresh(); await target.flush(); onSaved?.(target.snapshot); setError(''); return target.snapshot; });
      invalid.current = new Set(editor.invalid); refresh();
    } catch { setError('Détail invalide. Les valeurs enregistrées sont conservées.'); }
  };
  const editText = (key: 'note' | 'context', value: string) => {
    if (locked()) return;
    buffers.current[key] = value;
    save({}, { [key]: { raw: { value } } });
    refresh();
  };
  const editDuration = (part: 'hours' | 'minutes', value: string) => {
    if (locked() || !draft.current) return;
    const stored = draft.current.snapshot.duration_minutes ?? null;
    buffers.current.hours ??= stored === null ? '' : String(Math.floor(stored / 60));
    buffers.current.minutes ??= stored === null ? '' : String(stored % 60);
    buffers.current[part] = value;
    save({}, { duration_minutes: { raw: { hours: buffers.current.hours, minutes: buffers.current.minutes } } });
    refresh();
  };
  const run = (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = Promise.resolve().then(action).catch(() => setError('Résolution non confirmée. Le brouillon initial reste conservé ; relis la comparaison.')).finally(() => { operation.current = null; refresh(); });
    refresh();
  };
  const compare = () => run(async () => {
    if (!draft.current) return;
    await durable.current?.settle();
    const latest = await repository.read(id), pending = { ...durable.current?.recovered, ...draft.current.pendingPatch } as JournalPatch;
    review.current = { latest, pending, choices: Object.fromEntries(Object.keys(pending).filter(key => pending[key as keyof JournalPatch] === latest[key as keyof JournalPatch]).map(key => [key, 'database'])) }; setExpanded(true); setError('');
  });
  const resolve = () => {
    const current = review.current;
    if (!current || Object.keys(current.pending).some(key => !current.choices[key])) return;
    run(async () => {
      const result = await resolveJournalDraft(repository, current.latest, current.pending, Object.keys(current.choices).filter(key => current.choices[key] === 'draft'));
      const discarded = Object.keys(current.choices).filter(key => current.choices[key] === 'database');
      for (const key of discarded) {
        invalid.current.delete(key);
        if (key === 'duration_minutes') { delete buffers.current.hours; delete buffers.current.minutes; } else delete buffers.current[key];
      }
      draft.current = result; review.current = undefined; onSaved?.(result.snapshot); setError('');
      await durable.current?.resolved(result.snapshot, discarded); invalid.current = new Set(durable.current?.invalid ?? []);
    });
  };
  const row = draft.current?.snapshot, current = review.current;
  const control = { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8 };
  const input = { ...control, backgroundColor: '#f0f2f6', color: '#31333f', fontSize: 16 };
  return <View style={{ gap: 10, marginVertical: 10 }}>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>{error}</Text>}
    {!row ? <><Text>Lecture des détails…</Text>{!!error && <Pressable accessibilityRole="button" style={control} onPress={() => setAttempt(value => value + 1)}><Text>Relire les détails de {label}</Text></Pressable>}</> : <>
      {durable.current?.restored && <Text accessibilityRole="alert">Brouillon de {label} retrouvé sur cet appareil, sans modification de sa sélection. Compare les valeurs non confirmées avant reprise.</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={control} onPress={() => setExpanded(value => !value)}><Text>{expanded ? 'Masquer' : 'Afficher'} les détails de {label}</Text></Pressable>
      {!expanded && <Text>{kind === 'friends' ? `Durée : ${formatMinutes(row.duration_minutes ?? null)} · ` : ''}{row.note ? 'Note présente' : 'Aucune note'}</Text>}
      {expanded && <>
      {kind === 'friends' && <>
        <Text>Contexte</Text><TextInput accessibilityLabel={`${label} · Contexte`} editable={!locked()} maxLength={10000} value={buffers.current.context ?? row.context ?? ''} onChangeText={value => editText('context', value)} style={input} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['hours', 'minutes'] as const).map(part => <View key={part} style={{ flex: 1, minWidth: 100 }}><Text>{part === 'hours' ? 'Heures' : 'Minutes'}</Text><TextInput accessibilityLabel={`${label} · ${part === 'hours' ? 'Heures' : 'Minutes'}`} editable={!locked()} keyboardType="number-pad" value={buffers.current[part] ?? (row.duration_minutes === null || row.duration_minutes === undefined ? '' : String(part === 'hours' ? Math.floor(row.duration_minutes / 60) : row.duration_minutes % 60))} onChangeText={value => editDuration(part, value)} style={input} /></View>)}</View>
        <Text>Durée sociale : {formatMinutes(row.duration_minutes ?? null)}</Text>
        <Pressable accessibilityRole="button" disabled={locked()} style={control} onPress={() => Alert.alert('Effacer cette durée sociale ?', 'La note, le contexte et la sélection de cette personne sont conservés.', [{ text: 'Annuler', style: 'cancel' }, { text: 'Effacer', style: 'destructive', onPress: () => { if (locked()) return; delete buffers.current.hours; delete buffers.current.minutes; invalid.current.delete('duration_minutes'); save({ duration_minutes: null }); } }])}><Text>Effacer la durée de {label}</Text></Pressable>
      </>}
      <Text>Note</Text><TextInput accessibilityLabel={`${label} · Note`} editable={!locked()} maxLength={10000} multiline value={buffers.current.note ?? row.note ?? ''} onChangeText={value => editText('note', value)} style={input} />
      </>}
      {invalid.current.size > 0 && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>Contexte ou durée incomplets : brouillon conservé, dernières valeurs valides utilisées.</Text>}
      <Text accessibilityLiveRegion="polite">{invalid.current.size ? 'Brouillon incomplet, non enregistré.' : durable.current?.storageFailed() ? 'Conservation du brouillon non confirmée.' : durable.current?.needsComparison() ? 'Brouillon retrouvé à comparer, non enregistré.' : draft.current?.status === 'saving' || durable.current?.isWorking() ? 'Enregistrement des détails…' : draft.current?.status === 'failed' ? 'Détails non enregistrés' : 'Détails enregistrés localement'}</Text>
      {durable.current?.storageFailed() && <Pressable accessibilityRole="button" disabled={disabled || !!operation.current || !!current} style={control} onPress={() => { if (!operation.current && !review.current) void durable.current?.retry().then(() => { if (!durable.current?.storageFailed() && draft.current?.status === 'saved') setError(''); refresh(); }); }}><Text>Réessayer la conservation des détails de {label}</Text></Pressable>}
      {draft.current?.status === 'failed' && <>
        <Pressable accessibilityRole="button" disabled={locked()} style={control} onPress={() => run(async () => { await draft.current!.retry(); onSaved?.(draft.current!.snapshot); setError(''); await durable.current?.resolved(draft.current!.snapshot, []); })}><Text>Réessayer les détails de {label}</Text></Pressable>
      </>}
      {(draft.current?.status === 'failed' || durable.current?.needsComparison()) && <Pressable accessibilityRole="button" disabled={!!operation.current || !!current} style={control} onPress={compare}><Text>Comparer les détails de {label}</Text></Pressable>}
      {current && <View style={{ gap: 8 }}>
        <Text>Choisis les valeurs à conserver pour {label}.</Text>
        {Object.entries(current.pending).map(([key, pending]) => <View key={key} style={{ gap: 8 }}>
          <Text>{names[key as keyof JournalPatch]} · Enregistré : {String(current.latest[key as keyof JournalPatch] ?? 'Non renseigné')} · Brouillon : {String(pending ?? 'Effacement explicite')}</Text>
          {(['draft', 'database'] as const).map(choice => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={`${label} · ${names[key as keyof JournalPatch]} · ${choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}`} accessibilityState={{ selected: current.choices[key] === choice }} disabled={!!operation.current} style={[control, current.choices[key] === choice && { backgroundColor: '#ffe4e4' }]} onPress={() => { if (!operation.current && review.current) { review.current.choices[key] = choice; refresh(); } }}><Text>{choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}</Text></Pressable>)}
        </View>)}
        <Pressable accessibilityRole="button" disabled={!!operation.current || Object.keys(current.pending).some(key => !current.choices[key])} style={control} onPress={resolve}><Text>Appliquer les choix pour {label}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!!operation.current} style={control} onPress={compare}><Text>Relire la comparaison pour {label}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!!operation.current} style={control} onPress={() => { if (!operation.current) { review.current = undefined; refresh(); } }}><Text>Fermer sans abandonner les détails de {label}</Text></Pressable>
      </View>}
    </>}
  </View>;
});
