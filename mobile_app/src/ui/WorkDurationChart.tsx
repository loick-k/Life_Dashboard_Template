import React from 'react';
import { Text, View } from 'react-native';
import { shiftDate } from '../domain/dates';
import { formatMinutes, type WorkReport } from '../domain/workReport';

/** Native bars, no network or extra chart dependency. Missing data never becomes zero. */
export function WorkDurationChart({ report }: { report: WorkReport }) {
  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((label, index) => {
    const date = shiftDate(report.monday, index);
    const row = report.rows.find(item => item.entry_date === date);
    return { label, date, minutes: row?.work_duration_minutes ?? null, future: date > report.date };
  });
  const max = Math.max(462, ...days.map(day => day.minutes ?? 0));
  return <View style={{ marginVertical: 12 }}>
    <Text style={{ fontWeight: '600', color: '#31333f', marginBottom: 12 }}>Durée de travail par jour</Text>
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {days.map(day => <View key={day.date} accessible accessibilityLabel={`${day.date} : ${day.future ? 'à venir' : formatMinutes(day.minutes)}`}
        style={{ flex: 1, alignItems: 'center' }}>
        <View style={{ height: 100, width: '70%', justifyContent: 'flex-end', borderBottomWidth: 1, borderColor: '#626570' }}>
          {!day.future && day.minutes !== null && <View style={{ height: Math.max(2, day.minutes / max * 100), backgroundColor: '#ff4b4b', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />}
        </View>
        <Text style={{ marginTop: 6, fontSize: 12 }}>{day.label}</Text>
        <Text style={{ fontSize: 11, color: '#626570' }}>{day.future ? 'à venir' : formatMinutes(day.minutes)}</Text>
      </View>)}
    </View>
  </View>;
}
