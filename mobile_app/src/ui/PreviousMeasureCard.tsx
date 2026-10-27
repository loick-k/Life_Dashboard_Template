import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { previousMeasure, type BodyMeasure, type PreviousMeasure } from '../storage/previousMeasures';
import type { QueryConnection } from '../storage/catalogs';

export function PreviousMeasureCard({ database, field, date, disabled, onReuse }: {
  database: QueryConnection; field: BodyMeasure; date: string; disabled: boolean; onReuse(measure: PreviousMeasure): void;
}) {
  const [loaded, setLoaded] = useState<{ field: BodyMeasure; date: string; value: PreviousMeasure | null }>();
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setLoaded(undefined); setFailed(false);
    void previousMeasure(database, field, date).then(value => { if (active) setLoaded({ field, date, value }); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, field, date, attempt]);
  if (failed) return <View><Text>Dernière mesure indisponible. La saisie reste possible.</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 48, padding: 12 }}><Text>Relire la dernière mesure</Text></Pressable></View>;
  if (!loaded || loaded.date !== date || loaded.field !== field) return <Text>Lecture de la mesure précédente…</Text>;
  if (!loaded.value) return <Text>Aucune mesure précédente.</Text>;
  const value = loaded.value;
  return <View style={{ padding: 12, borderRadius: 10, backgroundColor: '#e8f2fc', gap: 8 }}>
    <Text>Dernière mesure : {new Intl.NumberFormat('fr-FR').format(value.value)} {field === 'weight_kg' ? 'kg' : field === 'body_fat_pct' ? '%' : 'cm'} · {value.date.split('-').reverse().join('/')}</Text>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onReuse(value)} style={{ minHeight: 48, padding: 12 }}><Text>Réutiliser cette mesure</Text></Pressable>
  </View>;
}
