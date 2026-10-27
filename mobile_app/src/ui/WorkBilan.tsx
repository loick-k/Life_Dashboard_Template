import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text } from 'react-native';
import type { CatalogKind, QueryConnection } from '../storage/catalogs';
import { parisDate, shiftDate } from '../domain/dates';
import { WorkBalanceCard } from './WorkBalanceCard';
import { HistoryIndicators } from './HistoryIndicators';
import { WeeklyAssessment } from './WeeklyAssessment';
import { useParisToday } from './useParisToday';

export function WorkBilan({ database, onDone, initialDate, onDate, active = true, onBusy, onCatalogHistory }: { database: QueryConnection; onDone(): void; initialDate?: string; onDate?(date: string): void; active?: boolean; onBusy?(value: boolean): void; onCatalogHistory?(kind: CatalogKind): void }) {
  const [date, setDate] = useState(() => initialDate ?? parisDate());
  const today = useParisToday(active);
  const [refreshToken, setRefreshToken] = useState(0);
  const wasActive = useRef(active);
  const exporting = useRef(false), [exportBusy, setExportBusy] = useState(false);
  const exportState = (value: boolean) => { exporting.current = value; setExportBusy(value); onBusy?.(value); };
  useEffect(() => { if (active && !wasActive.current) setRefreshToken(value => value + 1); wasActive.current = active; }, [active]);
  useEffect(() => { if (initialDate) setDate(initialDate); }, [initialDate]);
  const chooseDate = (value: string) => { if (!exporting.current) { setDate(value); onDate?.(value); } };
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const nextSunday = shiftDate(date, 13 - weekday);
  useEffect(() => {
    if (!active) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (!exporting.current) onDone(); return true; });
    return () => listener.remove();
  }, [onDone, active]);
  return <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 40 }}>
    <Text style={{ fontSize: 28, fontWeight: '700', color: '#31333f' }}>Bilan</Text>
    <WeeklyAssessment database={database} date={today} refreshToken={refreshToken} />
    <Text style={{ marginVertical: 16, fontSize: 20 }}>Suivi hebdomadaire du temps de travail</Text>
    <Text>Essai technique · données fictives uniquement</Text>
    <WorkBalanceCard database={database} date={date} weekly refreshToken={refreshToken} onExportBusy={exportState} />
    <Pressable accessibilityRole="button" disabled={exportBusy} style={{ padding: 16 }} onPress={() => chooseDate(shiftDate(date, -weekday - 1))}><Text>← Semaine précédente</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={exportBusy || date >= today} style={{ padding: 16 }} onPress={() => chooseDate(nextSunday > parisDate() ? parisDate() : nextSunday)}><Text>Semaine suivante →</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={exportBusy} style={{ padding: 16 }} onPress={() => chooseDate(parisDate())}><Text>Semaine en cours</Text></Pressable>
    <HistoryIndicators database={database} date={date} refreshToken={refreshToken} onDate={chooseDate} disabled={exportBusy} onCatalogHistory={kind => { if (!exporting.current) onCatalogHistory?.(kind); }} />
    <Pressable accessibilityRole="button" disabled={exportBusy} style={{ padding: 16 }} onPress={onDone}><Text>Retour</Text></Pressable>
  </ScrollView>;
}
