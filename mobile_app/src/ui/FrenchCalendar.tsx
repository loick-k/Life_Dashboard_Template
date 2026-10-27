import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { adjacentMonth, calendarCells } from '../domain/calendar';
import { validateDate } from '../storage/dailyEntries';

/** Inline calendar: selecting a date never discards a draft or opens another day implicitly. */
export function FrenchCalendar({ value, latest, disabled, onSelect }: { value: string; latest: string; disabled: boolean; onSelect(date: string): void }) {
  const validMonth = () => { try { validateDate(value); return (value <= latest && Number(value.slice(0, 4)) >= 1 ? value : latest).slice(0, 7); } catch { return latest.slice(0, 7); } };
  const [month, setMonth] = useState(validMonth);
  useEffect(() => { try { validateDate(value); if (value <= latest && Number(value.slice(0, 4)) >= 1) setMonth(value.slice(0, 7)); } catch { /* Manual input can be unfinished; keep the valid calendar visible. */ } }, [value, latest]);
  const cells = calendarCells(month);
  return <View style={{ gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable accessibilityRole="button" disabled={disabled || month === '0001-01'} accessibilityLabel="Mois précédent" onPress={() => setMonth(adjacentMonth(month, -1))} style={{ minWidth: 48, minHeight: 48, padding: 12 }}><Text>←</Text></Pressable>
      <Text accessibilityRole="header">{new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(`${month}-01T12:00:00Z`))}</Text>
      <Pressable accessibilityRole="button" disabled={disabled || month >= latest.slice(0, 7)} accessibilityLabel="Mois suivant" onPress={() => setMonth(adjacentMonth(month, 1))} style={{ minWidth: 48, minHeight: 48, padding: 12 }}><Text>→</Text></Pressable>
    </View>
    <View style={{ flexDirection: 'row' }}>{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(day => <Text key={day} style={{ flex: 1, textAlign: 'center' }}>{day}</Text>)}</View>
    {Array.from({ length: 6 }, (_, week) => <View key={week} style={{ flexDirection: 'row' }}>{cells.slice(week * 7, week * 7 + 7).map((date, index) => <View key={date ?? index} style={{ flex: 1 }}>{date && <Pressable accessibilityRole="button" disabled={disabled || date > latest}
      accessibilityLabel={`Choisir le ${date.split('-').reverse().join('/')}`} accessibilityState={{ selected: date === value, disabled: disabled || date > latest }} onPress={() => onSelect(date)}
      style={{ minHeight: 48, paddingVertical: 12, alignItems: 'center', borderRadius: 8, backgroundColor: date === value ? '#ffe4e4' : 'transparent', opacity: date > latest ? 0.4 : 1 }}><Text>{Number(date.slice(-2))}</Text></Pressable>}</View>)}</View>)}
  </View>;
}
