import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { readWeeklyAssessment } from '../storage/weeklyAssessment';
import type { WeeklyAssessment as Assessment } from '../domain/weeklyAssessment';

export function WeeklyAssessment({ database, date, refreshToken = 0 }: { database: QueryConnection; date: string; refreshToken?: number }) {
  const [value, setValue] = useState<Assessment>(), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0), [details, setDetails] = useState(false);
  useEffect(() => {
    let active = true; setValue(undefined); setFailed(false);
    void readWeeklyAssessment(database, date).then(result => { if (active) setValue(result); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, date, refreshToken, attempt]);
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Évaluation de la semaine en cours</Text>
    {failed ? <><Text accessibilityRole="alert">Évaluation indisponible. Les données et réglages sont conservés.</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text>Réessayer l’évaluation</Text></Pressable></> : !value || value.date !== date ? <Text>Lecture de la semaine…</Text> : <>
      <Text>Du {value.monday.split('-').reverse().join('/')} au {value.date.split('-').reverse().join('/')} · {value.elapsedDays} jour(s) écoulé(s).</Text>
      <Text style={styles.metric}>{value.score === null ? 'n.c.' : `${value.score}/100`} · {value.label}</Text>
      <Text>{value.observed}/{value.total} dimensions renseignées et actives. Les dimensions manquantes sont exclues, pas notées zéro.</Text>
      <Text style={styles.help}>Lecture indicative de ton suivi personnel, pas une évaluation médicale. Les objectifs sport/travail restent hebdomadaires, sans proratisation ; le suivi alimentaire conserve les seuils V1 de 2/4/6 jours, même en début de semaine. Les repas comptent sans calcul calorique. Les courbes historiques ci-dessous ont leur propre période.</Text>
      {!!value.staleEstimates && <Text accessibilityRole="alert">{value.staleEstimates} estimation(s) obsolète(s) exclue(s) des scores calories/macros.</Text>}
      {!!value.excludedWorkDates.length && <Text accessibilityRole="alert">Créneaux de travail chevauchants exclus : {value.excludedWorkDates.map(date => date.split('-').reverse().join('/')).join(', ')}.</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} style={styles.button} onPress={() => setDetails(value => !value)}><Text>{details ? 'Masquer' : 'Voir'} le détail des indicateurs</Text></Pressable>
      {details && value.items.map(item => <View key={item.key} style={styles.item}><Text style={styles.label}>{item.label} · {item.score === null ? 'n.c.' : `${item.score}/100`}</Text><Text>{item.comment}</Text>{item.weight === 0 && <Text style={styles.help}>Couverture du suivi, hors score global et sans effet sur le compteur de 7 h 42.</Text>}</View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, backgroundColor: '#e8f2fc', borderRadius: 12, gap: 10, marginVertical: 12 },
  title: { color: '#31333f', fontSize: 22, fontWeight: '600' }, metric: { color: '#31333f', fontSize: 25 },
  label: { color: '#31333f', fontWeight: '600', fontSize: 17 }, help: { color: '#626570', lineHeight: 21 },
  button: { minHeight: 48, paddingVertical: 12, justifyContent: 'center' },
  item: { borderTopWidth: 1, borderColor: '#d5d6dc', paddingTop: 12, gap: 6 },
});
