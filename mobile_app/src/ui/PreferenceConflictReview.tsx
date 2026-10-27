import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PreferenceKey, PreferenceValue } from '../domain/preferences';
import type { PreferenceState } from '../storage/preferences';

export interface PreferenceReview { key: PreferenceKey; latest: PreferenceState; pending: PreferenceValue; choice?: 'draft' | 'database' }
export function PreferenceConflictReview({ review, label, busy, onChoice, onApply, onReload, onClose }: {
  review: PreferenceReview; label: string; busy: boolean; onChoice(choice: 'draft' | 'database'): void;
  onApply(): void; onReload(): void; onClose(): void;
}) {
  const button = { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8 };
  return <View style={{ gap: 10 }}>
    <Text accessibilityRole="header">Comparer : {label}</Text>
    <Text>Enregistré : {String(review.latest.value ?? 'Non renseigné')} · Brouillon : {review.pending === null ? 'Effacement explicite' : String(review.pending)}</Text>
    {(['draft', 'database'] as const).map(choice => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={`${label} · ${choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}`} disabled={busy} accessibilityState={{ selected: review.choice === choice, disabled: busy }} style={[button, review.choice === choice && { backgroundColor: '#ffe4e4' }]} onPress={() => onChoice(choice)}><Text>{choice === 'draft' ? 'Garder mon brouillon' : 'Garder la valeur enregistrée'}</Text></Pressable>)}
    <Pressable accessibilityRole="button" disabled={busy || !review.choice} style={button} onPress={onApply}><Text>Appliquer le choix pour ce réglage</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={button} onPress={onReload}><Text>Relire la comparaison du réglage</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={button} onPress={onClose}><Text>Fermer sans abandonner ce réglage</Text></Pressable>
  </View>;
}
