import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { readHistoryMetrics } from '../storage/historyMetrics';
import { historyPeriods, historyLabels, periodDays, type HistoryPeriod, type HistoryReport } from '../domain/historyMetrics';
import { formatMetric, weeklyMetrics } from '../domain/weeklyMetrics';
import { parisDate, shiftDate } from '../domain/dates';
import { MetricChart } from './MetricChart';

const chartWindow = 24;
export function HistoryIndicators({ database, date, refreshToken = 0, onDate }: { database: QueryConnection; date: string; refreshToken?: number; onDate?(date: string): void }) {
  const [period, setPeriod] = useState<HistoryPeriod>('month'), [group, setGroup] = useState('Corps'), [page, setPage] = useState(0);
  const [report, setReport] = useState<HistoryReport>(), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setReport(undefined); setFailed(false); setPage(0);
    void readHistoryMetrics(database, date, period).then(value => { if (active) setReport(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, date, period, refreshToken, attempt]);
  const points = report?.series[0]?.points.length ?? 0, pages = Math.max(1, Math.ceil(points / chartWindow));
  const last = points - Math.min(page, pages - 1) * chartWindow, first = Math.max(0, last - chartWindow);
  const choosePeriod = (value: HistoryPeriod) => { setPeriod(value); setPage(0); };
  const previous = () => { if (period !== 'all') onDate?.(shiftDate(date, -periodDays[period])); };
  const next = () => { if (period !== 'all') { const target = shiftDate(date, periodDays[period]); onDate?.(target > parisDate() ? parisDate() : target); } };
  return <View style={{ marginVertical: 16, gap: 10 }}>
    <Text accessibilityRole="header" style={styles.title}>Courbes par catégorie</Text>
    <View style={styles.row}>{historyPeriods.map(value => <Pressable accessibilityRole="button" accessibilityState={{ selected: period === value }} key={value} style={[styles.button, period === value && styles.selected]} onPress={() => choosePeriod(value)}><Text>{historyLabels[value]}</Text></Pressable>)}</View>
    {onDate && <View style={styles.row}><Pressable accessibilityRole="button" disabled={period === 'all'} style={styles.button} onPress={previous}><Text>← Période précédente</Text></Pressable><Pressable accessibilityRole="button" disabled={period === 'all' || date >= parisDate()} style={styles.button} onPress={next}><Text>Période suivante →</Text></Pressable></View>}
    {failed ? <><Text accessibilityRole="alert">Historique indisponible. Les données sont conservées.</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text>Réessayer l’historique</Text></Pressable></> : !report || report.end !== date || report.period !== period ? <Text>Lecture de l’historique…</Text> : <>
      <Text>Du {report.start.split('-').reverse().join('/')} au {report.end.split('-').reverse().join('/')} · détail {report.grain === 'day' ? 'journalier' : report.grain === 'week' ? 'par semaine (lundi–dimanche)' : 'par mois'}.</Text>
      <Text style={styles.help}>1 mois = 30 jours, 1 an = 365 jours, comme en V1. Totaux et moyennes sur toute la période ; n.c. n’est pas zéro. Pour le corps, la carte montre la dernière mesure et la courbe la moyenne par période.</Text>
      <View style={styles.row}>{[...new Set(weeklyMetrics.map(item => item.group))].map(name => <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected: name === group }} style={[styles.button, name === group && styles.selected]} onPress={() => setGroup(name)}><Text>{name}</Text></Pressable>)}</View>
      {pages > 1 && <View><Text>Graphiques : points {first + 1}–{last} sur {points}. Les indicateurs chiffrés couvrent toujours la période complète.</Text><View style={styles.row}><Pressable accessibilityRole="button" disabled={page >= pages - 1} style={styles.button} onPress={() => setPage(value => value + 1)}><Text>← Points plus anciens</Text></Pressable><Pressable accessibilityRole="button" disabled={page === 0} style={styles.button} onPress={() => setPage(value => value - 1)}><Text>Points plus récents →</Text></Pressable></View></View>}
      {group === 'Travail' && report.excludedWorkDates.length > 0 && <Text accessibilityRole="alert">Journées aux horaires chevauchants exclues : {report.excludedWorkDates.map(value => value.split('-').reverse().join('/')).join(', ')}.</Text>}
      {report.series.filter(item => item.group === group).map(item => <View key={item.key} style={styles.card}>
        <Text style={styles.label}>{item.label}</Text><Text style={styles.metric}>{formatMetric(item.value)}{item.value === null ? '' : ` ${item.unit}`}</Text>
        <Text style={styles.help}>{item.aggregate === 'latest' ? 'Dernière valeur renseignée' : item.aggregate === 'mean' ? 'Moyenne des jours renseignés' : 'Total des valeurs renseignées'} · {item.count} jour(s).</Text>
        <MetricChart series={{ ...item, points: item.points.slice(first, last) }} />
        {!!item.excludedEstimates && <Text accessibilityRole="alert">{item.excludedEstimates} estimation(s) obsolète(s) exclue(s).</Text>}
        {item.key === 'net_kcal' && <Text style={styles.help}>Apports moins sport, seulement pour les jours où les deux estimations existent. Ce n’est pas le bilan énergétique complet.</Text>}
        {item.key === 'work_balance_minutes' && <Text style={styles.help}>Écart des journées de la période, pas un compteur remis à zéro. Le compteur cumulé au-dessus utilise tout l’historique.</Text>}
      </View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  title: { color: '#31333f', fontSize: 22, fontWeight: '600' }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { color: '#626570', lineHeight: 21 }, button: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10 },
  selected: { backgroundColor: '#ffe4e4', borderColor: '#ff4b4b' }, card: { padding: 16, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 12, gap: 8, marginBottom: 14 },
  label: { color: '#31333f', fontSize: 17, fontWeight: '600' }, metric: { color: '#31333f', fontSize: 25 },
});
