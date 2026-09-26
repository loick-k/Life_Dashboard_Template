import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { openLocalDatabase } from './storage/nativeDatabase';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DailyForm } from './ui/DailyForm';
import { PreferencesForm } from './ui/PreferencesForm';
import { WorkBilan } from './ui/WorkBilan';

/** Bootstrap only: do not collect personal data until native storage is verified. */
export default function App() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'opening' | 'ready' | 'failed'>('opening');
  const [database, setDatabase] = useState<SQLiteDatabase>();
  const [testing, setTesting] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [dailyDate, setDailyDate] = useState<string>();
  const [bilan, setBilan] = useState(false);
  useEffect(() => {
    let active = true;
    setStatus('opening');
    openLocalDatabase().then(
      db => { if (active) { setDatabase(db); setStatus('ready'); } },
      () => { if (active) setStatus('failed'); },
    );
    return () => { active = false; };
  }, [attempt]);
  if (preferences && database) return <PreferencesForm database={database} onDone={() => setPreferences(false)} />;
  if (bilan && database) return <WorkBilan database={database} onDone={() => setBilan(false)} />;
  if (testing && database) return <DailyForm database={database} initialDate={dailyDate} onBilan={date => { setDailyDate(date); setBilan(true); }} onSettings={date => { setDailyDate(date); setPreferences(true); }} />;
  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>🌱 Life Dashboard</Text>
      <Text style={styles.subtitle}>Votre tableau de bord personnel, sur votre téléphone.</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Version de développement</Text>
        <Text style={styles.body}>Le stockage sécurisé et le parcours de première utilisation sont en préparation. Aucune donnée personnelle n’est demandée à cette étape.</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {status === 'opening' ? 'Ouverture du stockage sécurisé…' : status === 'ready' ? 'Base chiffrée ouverte et schéma vérifié.' : 'Stockage indisponible. Les fichiers existants sont conservés.'}
        </Text>
        {__DEV__ && status === 'ready' && <Pressable style={styles.button} onPress={() => setTesting(true)}><Text style={styles.buttonText}>Tester les formulaires avec des données fictives</Text></Pressable>}
        {__DEV__ && status === 'ready' && <Pressable accessibilityRole="button" style={styles.button} onPress={() => setPreferences(true)}><Text style={styles.buttonText}>Tester les réglages locaux</Text></Pressable>}
        {__DEV__ && status === 'ready' && <Pressable accessibilityRole="button" style={styles.button} onPress={() => setBilan(true)}><Text style={styles.buttonText}>Tester le bilan travail</Text></Pressable>}
        {status === 'failed' && <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={styles.button}>
          <Text style={styles.buttonText}>Réessayer</Text>
        </Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: '#ffffff' },
  title: { fontSize: 30, fontWeight: '700', color: '#31333f' },
  subtitle: { fontSize: 16, color: '#626570', marginTop: 12, lineHeight: 24 },
  card: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 16, padding: 20, marginTop: 32 },
  heading: { fontSize: 20, fontWeight: '600', color: '#31333f', marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 24, color: '#31333f' },
  status: { fontSize: 16, lineHeight: 24, marginTop: 20, color: '#31333f' },
  button: { minHeight: 48, backgroundColor: '#ff4b4b', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
});
