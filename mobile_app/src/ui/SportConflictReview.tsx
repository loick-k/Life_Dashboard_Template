import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SportPatch, SportSession } from '../storage/sportSessions';
import { formatMinutes } from '../domain/workReport';

export type SportReview = { id: string; latest: SportSession; pending: SportPatch; choices: Record<string, 'draft' | 'database'> };
const labels: Record<keyof SportPatch, string> = { sport_type: 'Activité', duration_minutes: 'Durée', distance_km: 'Distance (km)' };
export function SportConflictReview({ review, busy, onChoice, onApply, onReload, onClose }: {
  review: SportReview; busy: boolean; onChoice(key: string, choice: 'draft' | 'database'): void;
  onApply(): void; onReload(): void; onClose(): void;
}) {
  const value = (key: string, data: unknown) => data === null || data === undefined ? 'Non renseigné' : key === 'duration_minutes' ? formatMinutes(Number(data)) : String(data);
  const button = { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8 };
  return <View style={{ gap: 12, marginVertical: 12 }}>
    <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600' }}>Résoudre la séance {review.latest.position}</Text>
    <Text>Choisis pour chaque valeur. Les saisies incomplètes restent en mémoire sauf remplacement explicite de ce champ par sa valeur enregistrée.</Text>
    {Object.entries(review.pending).map(([key, pending]) => <View key={key} style={{ gap: 8 }}>
      <Text>{labels[key as keyof SportPatch]}</Text>
      <Text>Enregistré : {value(key, review.latest[key as keyof SportPatch])} · Brouillon : {pending === null ? 'Effacement explicite' : value(key, pending)}</Text>
      {(['draft', 'database'] as const).map(choice => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={`Séance ${review.latest.position} · ${labels[key as keyof SportPatch]} · ${choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}`} accessibilityState={{ selected: review.choices[key] === choice, disabled: busy }} disabled={busy} style={[button, review.choices[key] === choice && { backgroundColor: '#ffe4e4' }]} onPress={() => onChoice(key, choice)}><Text>{choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}</Text></Pressable>)}
    </View>)}
    <Pressable accessibilityRole="button" disabled={busy || Object.keys(review.pending).some(key => !review.choices[key])} style={button} onPress={onApply}><Text>Appliquer les choix de cette séance</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={button} onPress={onReload}><Text>Relire la comparaison de cette séance</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={button} onPress={onClose}><Text>Fermer sans abandonner la séance</Text></Pressable>
  </View>;
}
