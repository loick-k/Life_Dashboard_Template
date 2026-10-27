import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { readWeeklyMetrics } from '../storage/weeklyMetrics';
import { formatMetric, weeklyMetrics, type MetricSeries } from '../domain/weeklyMetrics';
import { MetricChart } from './MetricChart';

export function WeeklyIndicators({ database, date, refreshToken = 0 }: { database: QueryConnection; date: string; refreshToken?: number }) {
  const [loaded, setLoaded] = useState<{ date: string; series: MetricSeries[] }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [group, setGroup] = useState('Corps');
  useEffect(() => {
    let active = true;
    setFailed(false); setLoaded(undefined);
    readWeeklyMetrics(database, date).then(series => { if (active) setLoaded({ date, series }); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, date, attempt, refreshToken]);
  if (failed) return <View><Text accessibilityRole="alert">Lecture du bilan impossible. Les données sont conservées.</Text><Pressable style={styles.button} onPress={() => setAttempt(n => n + 1)}><Text>Réessayer</Text></Pressable></View>;
  if (!loaded || loaded.date !== date) return <Text>Chargement des indicateurs…</Text>;
  return <View style={{ marginVertical: 16 }}>
    <Text style={styles.title}>Courbes par catégorie</Text>
    <Text style={styles.help}>Semaine sélectionnée, jusqu’au {date.split('-').reverse().join('/')}. n.c. : non renseigné. Une absence n’est pas comptée comme zéro.</Text>
    <View style={styles.groups}>{[...new Set(weeklyMetrics.map(item => item.group))].map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: name === group }}
      style={[styles.button, name === group && styles.selected]} onPress={() => setGroup(name)}><Text>{name}</Text></Pressable>)}</View>
    {loaded.series.filter(item => item.group === group).map(item => <View key={item.key} style={styles.card}>
      <Text style={styles.label}>{item.label}</Text>
      <Text style={styles.metric}>{formatMetric(item.value)}{item.value !== null ? ` ${item.unit}` : ''}</Text>
      <Text style={styles.help}>{item.aggregate === 'latest' ? 'Dernière valeur de la semaine' : item.aggregate === 'mean' ? 'Moyenne des jours renseignés' : 'Total des valeurs renseignées'} · {item.count} jour(s)</Text>
      <MetricChart series={item} />
      {item.excludedEstimates > 0 && <Text accessibilityRole="alert" style={styles.help}>{item.excludedEstimates} estimation(s) obsolète(s) exclue(s). Recalcule les journées modifiées pour les inclure.</Text>}
      {item.key === 'net_kcal' && <Text style={styles.help}>Apports moins sport, uniquement lorsque les deux estimations existent. Ce n’est pas le bilan énergétique complet.</Text>}
      {item.key === 'sport_minutes' && <Text style={styles.help}>Les séances à durée manquante sont exclues de ce total et comptées séparément.</Text>}
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '600', color: '#31333f', marginBottom: 12 },
  help: { color: '#626570', lineHeight: 21 }, groups: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  button: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, justifyContent: 'center' },
  selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' },
  card: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 12, padding: 16, marginBottom: 14, gap: 8 },
  label: { fontSize: 17, fontWeight: '600', color: '#31333f' }, metric: { fontSize: 25, color: '#31333f' },
});
