import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { readWorkReport } from '../storage/workReport';
import { formatMinutes, type WorkReport } from '../domain/workReport';
import { WorkDurationChart } from './WorkDurationChart';

export function WorkBalanceCard({ database, date, revision, saved = true, weekly = false }: {
  database: QueryConnection; date: string; revision?: number; saved?: boolean; weekly?: boolean;
}) {
  const [result, setResult] = useState<{ date: string; revision?: number; report: WorkReport }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (saved) void readWorkReport(database, date).then(report => { if (active) setResult({ date, revision, report }); },
      () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, date, revision, saved, attempt]);
  if (failed) return <View><Text accessibilityRole="alert">Compteur indisponible. Aucune donnée modifiée.</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(n => n + 1)}><Text>Réessayer</Text></Pressable></View>;
  if (!result || result.date !== date) return <Text>Chargement du compteur…</Text>;
  const pending = !saved || result.revision !== revision;
  const report = result.report;
  return <View style={styles.card}>
    <Text style={styles.label}>{weekly ? 'Compteur cumulé du temps de travail' : 'Avance / retard avant cette journée'}</Text>
    <Text style={styles.metric}>{formatMinutes(weekly ? report.cumulativeMinutes : report.beforeMinutes, true)}</Text>
    {!weekly && pending && <Text>Calcul de la journée en attente de confirmation de la sauvegarde. Le solde avant cette journée est conservé.</Text>}
    {!weekly && !pending && <>
      <Text>Temps travaillé : {formatMinutes(report.dayMinutes)}</Text>
      <Text>Avance / retard de la journée : {formatMinutes(report.dayBalance, true)}</Text>
      <Text>Compteur après cette journée : {formatMinutes(report.afterMinutes, true)}</Text>
      {report.dayMinutes === null && <Text>Journée non calculable : le compteur cumulé reste inchangé.</Text>}
    </>}
    <Text style={styles.help}>Référence : 7 h 42 par jour travaillé. Les jours sans durée calculable sont exclus. Day off : cible de 0 h.</Text>
    <Text style={styles.help}>{report.countedDays} journée(s) comptée(s) jusqu’au {date.split('-').reverse().join('/')}.</Text>
    {report.incompleteDays > 0 && <Text style={styles.help}>{report.incompleteDays} journée(s) avec type de travail mais sans durée calculable, non comptée(s).</Text>}
    {weekly && <>
      <Text style={styles.label}>Semaine du {report.monday.split('-').reverse().join('/')} au {report.sunday.split('-').reverse().join('/')}</Text>
      <Text>Durée de travail : {formatMinutes(report.weekMinutes)}</Text>
      <Text>Objectif hebdomadaire : {formatMinutes(report.weekTargetMinutes)} · Écart : {formatMinutes(report.weekDifference, true)}</Text>
      <Text style={styles.help}>L’objectif hebdomadaire est distinct du compteur cumulé. Seules les données jusqu’à la date sélectionnée sont prises en compte.</Text>
      <WorkDurationChart report={report} />
      {report.rows.length === 0 && <Text>Aucune journée renseignée cette semaine.</Text>}
      {report.rows.map(row => <View key={row.entry_date} style={styles.day}>
        <Text style={styles.label}>{row.entry_date.split('-').reverse().join('/')} · {row.work_mode ?? 'Type non renseigné'}</Text>
        <Text>Durée : {formatMinutes(row.work_duration_minutes)} · Écart jour : {formatMinutes(row.balance, true)}</Text>
        <Text>Cumul total : {formatMinutes(row.cumulative, true)}</Text>
      </View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { gap: 10, backgroundColor: '#e8f2fc', borderRadius: 12, padding: 16, marginVertical: 12 },
  label: { fontSize: 16, color: '#31333f', fontWeight: '600' }, metric: { fontSize: 28, color: '#31333f' },
  help: { color: '#626570', lineHeight: 21 }, button: { minHeight: 48, justifyContent: 'center' },
  day: { borderTopWidth: 1, borderColor: '#d5d6dc', paddingTop: 12, gap: 6 },
});
