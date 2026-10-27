import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { estimateFields, nutritionStatus } from '../domain/nutrition';

export function EnergyCard({ database, entryId, revision, saved }: { database: QueryConnection; entryId: string; revision: number; saved: boolean }) {
  const [loaded, setLoaded] = useState<{ revision: number; row: Record<string, unknown> }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showPrevious, setShowPrevious] = useState(false);
  useEffect(() => {
    let active = true; setFailed(false);
    if (saved) void database.getFirstAsync<Record<string, unknown>>(
      `SELECT ${estimateFields.join(',')}, nutrition_estimate_stale, nutrition_estimate_origin,
        nutrition_analyzed_at, nutrition_analysis_model, nutrition_analysis_confidence
        FROM daily_entries WHERE entry_id = ?`, entryId).then(row => {
      if (!row) throw new Error('Journée absente');
      if (active) setLoaded({ revision, row });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, entryId, revision, saved, attempt]);
  if (failed) return <View style={styles.card}><Text accessibilityRole="alert">Lecture de l’estimation impossible.</Text><Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text>Réessayer</Text></Pressable></View>;
  const pending = !saved || !loaded || loaded.revision !== revision;
  const row = pending ? {} : loaded.row;
  const status = nutritionStatus(row);
  const usable = !pending && status === 'available';
  const value = (key: string) => usable && typeof row[key] === 'number' ? Math.round(Number(row[key])) : 'n.c.';
  const timestamp = typeof row.nutrition_analyzed_at === 'string' ? new Date(row.nutrition_analyzed_at) : null;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Bilan énergétique estimé</Text>
    <Text>Ingérées : {value('kcal')} kcal · Sport : {value('sport_kcal_burned')} kcal</Text>
    <Text>Kcal nettes : {usable && typeof row.kcal === 'number' && typeof row.sport_kcal_burned === 'number' ? Math.round(row.kcal - row.sport_kcal_burned) : 'n.c.'}</Text>
    <Text>Protéines : {value('proteins_g')} g · Glucides : {value('carbs_g')} g · Lipides : {value('fats_g')} g</Text>
    {pending ? <Text>Relecture après confirmation de la sauvegarde…</Text> : status === 'stale' ? <>
      <Text accessibilityRole="alert">Estimation obsolète : un repas, une mesure corporelle ou une séance a changé. Les anciennes valeurs sont conservées mais exclues des bilans jusqu’au recalcul.</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => setShowPrevious(value => !value)}><Text>{showPrevious ? 'Masquer' : 'Voir'} l’ancienne estimation</Text></Pressable>
      {showPrevious && <Text>Anciennes valeurs, non actualisées : {String(row.kcal ?? 'n.c.')} kcal alimentaires · {String(row.sport_kcal_burned ?? 'n.c.')} kcal sportives.</Text>}
    </> : status === 'unavailable' ? <Text>Pas encore calculé.</Text> : null}
    {!pending && status !== 'unavailable' && <Text style={styles.help}>Origine : {row.nutrition_estimate_origin === 'v1' ? 'import V1' : row.nutrition_estimate_origin === 'v2' ? 'calcul V2' : 'estimation historique'}{timestamp && Number.isFinite(timestamp.valueOf()) ? ` · ${timestamp.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}{row.nutrition_analysis_model ? ` · ${String(row.nutrition_analysis_model)}` : ''}{row.nutrition_analysis_confidence ? ` · confiance ${String(row.nutrition_analysis_confidence)}` : ''}.</Text>}
    <Text style={styles.help}>Nettes = apports moins sport, pas la dépense totale du corps. Le calcul externe explicite sera proposé dans un lot suivant ; aucun appel réseau lors de la sauvegarde.</Text>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 16, backgroundColor: '#e8f2fc', borderRadius: 12, gap: 10, marginVertical: 12 },
  title: { fontSize: 20, fontWeight: '600', color: '#31333f' }, help: { color: '#626570', lineHeight: 22 },
  button: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8, justifyContent: 'center' },
});
