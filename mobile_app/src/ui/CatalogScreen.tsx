import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CatalogKind } from '../storage/catalogs';
import { CatalogForm, type CatalogFormHandle } from './CatalogForm';
import { CatalogHistory } from './CatalogHistory';
import { parisDate } from '../domain/dates';

export function CatalogScreen({ database, kind, onDone, date = parisDate(), initialView = 'catalog' }: { database: SQLiteDatabase; kind: CatalogKind; onDone(): void; date?: string; initialView?: 'catalog' | 'history' }) {
  const editor = useRef<CatalogFormHandle>(null), leaving = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [view, setView] = useState(initialView), [catalogVisited, setCatalogVisited] = useState(initialView === 'catalog'), [historyVisited, setHistoryVisited] = useState(initialView === 'history');
  async function switchView(target: 'catalog' | 'history') {
    if (leaving.current) return;
    leaving.current = true; setBusy(true);
    try {
      try { await editor.current?.settle(); } catch { /* Retained editor stays mounted with its failed draft. */ }
      setError(editor.current?.hasUnconfirmed() ? 'Un brouillon reste conservé dans le répertoire. L’historique présente uniquement les valeurs enregistrées.' : '');
      if (target === 'catalog') setCatalogVisited(true); else setHistoryVisited(true);
      setView(target);
    } finally { leaving.current = false; setBusy(false); }
  }
  async function done() {
    if (leaving.current) return;
    leaving.current = true; setBusy(true);
    try { await editor.current?.flush(); onDone(); }
    catch { setError('Ajout incomplet ou opération non confirmée. Termine ou annule explicitement cet ajout, ou recharge les valeurs avant de revenir.'); }
    finally { leaving.current = false; setBusy(false); }
  }
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { void done(); return true; });
    return () => listener.remove();
  });
  return <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 40, gap: 16, backgroundColor: '#fff', flexGrow: 1 }} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', color: '#31333f' }}>{kind === 'friends' ? 'Personnes suivies' : 'Mes objectifs'}</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(['catalog', 'history'] as const).map(target => <Pressable key={target} accessibilityRole="button" accessibilityState={{ selected: view === target, disabled: busy }} disabled={busy} style={{ minHeight: 48, padding: 14, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, backgroundColor: view === target ? '#ffe4e4' : '#fff' }} onPress={() => void switchView(target)}><Text>{target === 'catalog' ? 'Répertoire' : 'Historique et récurrence'}</Text></Pressable>)}</View>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>{error}</Text>}
    {catalogVisited && <View style={view !== 'catalog' && { display: 'none' }} accessibilityElementsHidden={view !== 'catalog'} importantForAccessibility={view === 'catalog' ? 'auto' : 'no-hide-descendants'}><CatalogForm key={kind} ref={editor} database={database} kind={kind} active={view === 'catalog'} /></View>}
    {historyVisited && <View style={view !== 'history' && { display: 'none' }} accessibilityElementsHidden={view !== 'history'} importantForAccessibility={view === 'history' ? 'auto' : 'no-hide-descendants'}><CatalogHistory database={database} kind={kind} date={date} active={view === 'history'} /></View>}
    <Pressable accessibilityRole="button" disabled={busy} style={{ minHeight: 48, padding: 14, borderWidth: 1, borderRadius: 10, borderColor: '#d5d6dc' }} onPress={() => void done()}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
