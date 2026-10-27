import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import type { SqlConnection } from '../storage/migrations';
import type { CatalogKind } from '../storage/catalogs';
import { JournalDraft, Journals, resolveJournalDraft, validateJournalPatch, type JournalPatch, type JournalRecord } from '../storage/journals';
import { durationFromParts } from '../domain/durationInput';
import { formatMinutes } from '../domain/workReport';

export interface JournalEditorHandle { settle(): Promise<void>; flush(): Promise<void>; reload(): Promise<void>; hasUnconfirmed(): boolean }
type Review = { latest: JournalRecord; pending: JournalPatch; choices: Record<string, 'draft' | 'database'> };
const names: Record<keyof JournalPatch, string> = { note: 'Note', context: 'Contexte', duration_minutes: 'Durée' };
export const JournalEditor = forwardRef<JournalEditorHandle, { database: SqlConnection; kind: CatalogKind; id: string; label: string; disabled?: boolean; onSaved?(row: JournalRecord): void }>(function JournalEditor({ database, kind, id, label, disabled = false, onSaved }, ref) {
  const repository = useMemo(() => new Journals(database, kind), [database, kind]);
  const draft = useRef<JournalDraft | undefined>(undefined), buffers = useRef<Record<string, string>>({});
  const invalid = useRef(new Set<string>()), review = useRef<Review | undefined>(undefined);
  const loading = useRef<Promise<void>>(Promise.resolve()), operation = useRef<Promise<void> | null>(null);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(''), [, repaint] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const refresh = () => repaint(value => value + 1);
  useEffect(() => {
    let active = true;
    loading.current = repository.read(id).then(row => { if (active) { draft.current = new JournalDraft(repository, row); setError(''); refresh(); } }, () => { if (active) setError('Journal indisponible. Les détails enregistrés sont conservés.'); });
    return () => { active = false; };
  }, [repository, id, attempt]);
  const settle = async () => {
    await loading.current; if (operation.current) await operation.current;
    if (!draft.current) throw new Error('Journal non chargé');
    await draft.current.flush();
  };
  useImperativeHandle(ref, () => ({
    settle,
    hasUnconfirmed: () => !draft.current || !!operation.current || !!review.current || invalid.current.size > 0 || draft.current.status !== 'saved',
    flush: async () => {
      try { await settle(); if (invalid.current.size || review.current) throw new Error('Détails de journal à terminer'); }
      catch (issue) { setExpanded(true); throw issue; }
    },
    reload: async () => {
      await settle(); if (invalid.current.size || review.current) throw new Error('Détails à conserver');
      const row = await repository.read(id); draft.current = new JournalDraft(repository, row); buffers.current = {}; onSaved?.(row); refresh();
    },
  }));
  const locked = () => disabled || !!operation.current || !!review.current;
  const save = (patch: JournalPatch) => {
    if (!draft.current || locked()) return;
    try {
      draft.current.edit(patch); refresh();
      void draft.current.flush().then(() => { if (draft.current) onSaved?.(draft.current.snapshot); setError(''); refresh(); }, () => { setError('Détails non enregistrés. Le brouillon est conservé ; réessaie ou compare les valeurs.'); refresh(); });
    } catch { setError('Détail invalide. Les valeurs enregistrées sont conservées.'); }
  };
  const editText = (key: 'note' | 'context', value: string) => {
    if (locked()) return;
    buffers.current[key] = value;
    try { validateJournalPatch(kind, { [key]: value }); invalid.current.delete(key); save({ [key]: value }); }
    catch { invalid.current.add(key); }
    refresh();
  };
  const editDuration = (part: 'hours' | 'minutes', value: string) => {
    if (locked() || !draft.current) return;
    const stored = draft.current.snapshot.duration_minutes ?? null;
    buffers.current.hours ??= stored === null ? '' : String(Math.floor(stored / 60));
    buffers.current.minutes ??= stored === null ? '' : String(stored % 60);
    buffers.current[part] = value;
    const minutes = durationFromParts(buffers.current.hours, buffers.current.minutes);
    if (minutes === undefined || minutes > 1440) invalid.current.add('duration_minutes');
    else { invalid.current.delete('duration_minutes'); save({ duration_minutes: minutes }); }
    refresh();
  };
  const run = (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = action().catch(() => setError('Résolution non confirmée. Le brouillon initial reste conservé ; relis la comparaison.')).finally(() => { operation.current = null; refresh(); });
    refresh();
  };
  const compare = () => run(async () => {
    if (!draft.current) return;
    const latest = await repository.read(id), pending = draft.current.pendingPatch;
    review.current = { latest, pending, choices: Object.fromEntries(Object.keys(pending).filter(key => pending[key as keyof JournalPatch] === latest[key as keyof JournalPatch]).map(key => [key, 'database'])) }; setExpanded(true); setError('');
  });
  const resolve = () => {
    const current = review.current;
    if (!current || Object.keys(current.pending).some(key => !current.choices[key])) return;
    run(async () => {
      const result = await resolveJournalDraft(repository, current.latest, current.pending, Object.keys(current.choices).filter(key => current.choices[key] === 'draft'));
      for (const key of Object.keys(current.choices).filter(key => current.choices[key] === 'database')) {
        invalid.current.delete(key);
        if (key === 'duration_minutes') { delete buffers.current.hours; delete buffers.current.minutes; } else delete buffers.current[key];
      }
      draft.current = result; review.current = undefined; onSaved?.(result.snapshot); setError('');
    });
  };
  const row = draft.current?.snapshot, current = review.current;
  const control = { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8 };
  const input = { ...control, backgroundColor: '#f0f2f6', color: '#31333f', fontSize: 16 };
  return <View style={{ gap: 10, marginVertical: 10 }}>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>{error}</Text>}
    {!row ? <><Text>Lecture des détails…</Text>{!!error && <Pressable accessibilityRole="button" style={control} onPress={() => setAttempt(value => value + 1)}><Text>Relire les détails de {label}</Text></Pressable>}</> : <>
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
      <Text accessibilityLiveRegion="polite">{invalid.current.size ? 'Brouillon incomplet, non enregistré.' : draft.current?.status === 'saving' ? 'Enregistrement des détails…' : draft.current?.status === 'failed' ? 'Détails non enregistrés' : 'Détails enregistrés localement'}</Text>
      {draft.current?.status === 'failed' && <>
        <Pressable accessibilityRole="button" disabled={locked()} style={control} onPress={() => run(async () => { await draft.current!.retry(); onSaved?.(draft.current!.snapshot); setError(''); })}><Text>Réessayer les détails de {label}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={!!operation.current || !!current} style={control} onPress={compare}><Text>Comparer les détails de {label}</Text></Pressable>
      </>}
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
