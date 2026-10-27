import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CatalogKind } from '../storage/catalogs';
import { CatalogForm, type CatalogFormHandle } from './CatalogForm';

export function CatalogScreen({ database, kind, onDone }: { database: SQLiteDatabase; kind: CatalogKind; onDone(): void }) {
  const editor = useRef<CatalogFormHandle>(null), leaving = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
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
    {!!error && <Text accessibilityRole="alert" style={{ color: '#b42318' }}>{error}</Text>}
    <CatalogForm key={kind} ref={editor} database={database} kind={kind} />
    <Pressable accessibilityRole="button" disabled={busy} style={{ minHeight: 48, padding: 14, borderWidth: 1, borderRadius: 10, borderColor: '#d5d6dc' }} onPress={() => void done()}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
