import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { parisDate, shiftDate } from '../domain/dates';
import { WorkBalanceCard } from './WorkBalanceCard';
import { HistoryIndicators } from './HistoryIndicators';
import { WeeklyAssessment } from './WeeklyAssessment';

export function WorkBilan({ database, onDone, initialDate, onDate, active = true }: { database: QueryConnection; onDone(): void; initialDate?: string; onDate?(date: string): void; active?: boolean }) {
  const [date, setDate] = useState(() => initialDate ?? parisDate());
  const [refreshToken, setRefreshToken] = useState(0);
  const wasActive = useRef(active);
  useEffect(() => { if (active && !wasActive.current) setRefreshToken(value => value + 1); wasActive.current = active; }, [active]);
  useEffect(() => { if (initialDate) setDate(initialDate); }, [initialDate]);
  const chooseDate = (value: string) => { setDate(value); onDate?.(value); };
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nextSunday = shiftDate(date, 13 - weekday);
  useEffect(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { onDone(); return true; });
    return () => listener.remove();
  }, [onDone, active]);
  return <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 40 }}>
    <Text style={{ fontSize: 28, fontWeight: '700', color: '#31333f' }}>Bilan</Text>
    <WeeklyAssessment database={database} date={parisDate()} refreshToken={refreshToken} />
    <Text style={{ marginVertical: 16, fontSize: 20 }}>Suivi hebdomadaire du temps de travail</Text>
    <Text>Essai technique · données fictives uniquement</Text>
    <WorkBalanceCard database={database} date={date} weekly refreshToken={refreshToken} />
    <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => chooseDate(shiftDate(date, -weekday - 1))}><Text>← Semaine précédente</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={date >= parisDate()} style={{ padding: 16 }} onPress={() => chooseDate(nextSunday > parisDate() ? parisDate() : nextSunday)}><Text>Semaine suivante →</Text></Pressable>
    <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={() => chooseDate(parisDate())}><Text>Semaine en cours</Text></Pressable>
    <HistoryIndicators database={database} date={date} refreshToken={refreshToken} onDate={chooseDate} />
    <Pressable accessibilityRole="button" style={{ padding: 16 }} onPress={onDone}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
