import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { formatMetric, type MetricSeries } from '../domain/weeklyMetrics';

/** Native line segments for body measures; gaps remain gaps. Other series use signed bars. */
export function MetricChart({ series }: { series: MetricSeries }) {
  const [width, setWidth] = useState(0);
  const values = series.points.map(point => point.value).filter(value => value !== null);
  const line = series.group === 'Corps';
  const low = line ? Math.min(...values, series.value ?? 0) - 1 : Math.min(0, ...values);
  const high = line ? Math.max(...values, series.value ?? 0) + 1 : Math.max(1, ...values);
  const height = 100;
  const y = (value: number) => height - (value - low) / (high - low) * height;
  const x = (index: number) => (index + 0.5) * width / 7;
  const baseline = y(0);
  return <View>
    <View accessible accessibilityLabel={`${series.label}, valeurs détaillées par jour ci-dessous`} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height, marginVertical: 12 }}>
      {!line && <View style={{ position: 'absolute', top: baseline, width: '100%', height: 1, backgroundColor: '#626570' }} />}
      {width > 0 && series.points.map((point, index) => {
        if (point.value === null) return null;
        if (!line) return <View key={point.date} style={{ position: 'absolute', left: x(index) - width / 28, width: width / 14,
          top: Math.min(y(point.value), baseline), height: Math.max(2, Math.abs(y(point.value) - baseline)), backgroundColor: point.value < 0 ? '#2563eb' : '#ff4b4b', borderRadius: 3 }} />;
        const next = series.points[index + 1];
        const dy = next?.value !== null && next?.value !== undefined ? y(next.value) - y(point.value) : null;
        const dx = width / 7;
        const length = dy === null ? 0 : Math.hypot(dx, dy);
        return <React.Fragment key={point.date}>
          {dy !== null && <View style={{ position: 'absolute', width: length, height: 2, backgroundColor: '#ff4b4b',
            left: x(index) + dx / 2 - length / 2, top: y(point.value) + dy / 2 - 1, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />}
          <View style={{ position: 'absolute', left: x(index) - 3, top: y(point.value) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#ff4b4b' }} />
        </React.Fragment>;
      })}
    </View>
    <View style={{ flexDirection: 'row', gap: 2 }}>{series.points.map((point, index) => <View key={point.date} style={{ flex: 1, alignItems: 'center' }}
      accessible accessibilityLabel={`${point.date} : ${point.future ? 'à venir' : formatMetric(point.value)} ${series.unit}`}>
      <Text style={{ fontSize: 12 }}>{['L', 'M', 'M', 'J', 'V', 'S', 'D'][index]}</Text>
      <Text style={{ fontSize: 11 }}>{point.future ? '—' : formatMetric(point.value)}</Text>
    </View>)}</View>
  </View>;
}
