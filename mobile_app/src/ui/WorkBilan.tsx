import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { parisDate, shiftDate } from '../domain/dates';
import { WorkBalanceCard } from './WorkBalanceCard';

export function WorkBilan({ database, onDone }: { database: QueryConnection; onDone(): void }) {
  const [date, setDate] = useState(parisDate);
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nextSunday = shiftDate(date, 13 - weekday);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onDone(); return true; });
    return () => listener.remove();
  }, [onDone]);
  return <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 40 }}>
    <Text style={{ fontSize: 28, fontWeight: '700', color: '#31333f' }}>Bilan</Text>
    <Text style={{ marginVertical: 16, fontSize: 20 }}>Suivi hebdomadaire du temps de travail</Text>
    <Text>Essai technique · données fictives uniquement</Text>
    <WorkBalanceCard database={database} date={date} weekly />
    <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => setDate(shiftDate(date, -weekday - 1))}><Text>← Semaine précédente</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={date >= parisDate()} style={{ padding: 16 }} onPress={() => setDate(nextSunday > parisDate() ? parisDate() : nextSunday)}><Text>Semaine suivante →</Text></Pressable>
    <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => setDate(parisDate())}><Text>Semaine en cours</Text></Pressable>
    <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={onDone}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
