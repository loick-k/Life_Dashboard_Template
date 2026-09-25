import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { QueryConnection } from '../storage/catalogs';
import { readRelatedSummary, type RelatedSummary as Summary } from '../storage/dailySummary';

export function RelatedSummary({ database, entryId, onModify }: { database: QueryConnection; entryId: string; onModify: (id: string) => void }) {
  const [summary, setSummary] = useState<Summary>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setSummary(undefined); setFailed(false);
    readRelatedSummary(database, entryId).then(value => { if (active) setSummary(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [database, entryId, attempt]);
  if (failed) return <View><Text accessibilityRole="alert">Impossible de lire le récapitulatif des séances et journaux.</Text><Pressable onPress={() => setAttempt(value => value + 1)} style={{ padding: 14 }}><Text>Réessayer</Text></Pressable></View>;
  if (!summary) return <Text>Chargement des séances et journaux…</Text>;
  const blocks = [
    { id: 'sport', title: 'Séances de sport', lines: summary.sports.map(item => ({ id: item.session_id, text: `${item.sport_type ?? 'Sport non précisé'} · ${item.duration_minutes ?? 'n.c.'} min · ${item.distance_km ?? 'n.c.'} km` })) },
    { id: 'social', title: 'Suivi social', lines: summary.social.map(item => ({ id: item.id, text: `${item.name} · ${item.category}\n${item.context} · ${item.duration_minutes ?? 'n.c.'} min${item.note ? `\n${item.note}` : ''}` })) },
    { id: 'goals', title: 'Objectifs', lines: summary.goals.map(item => ({ id: item.id, text: `${item.title} · ${item.worked ? 'Travaillé' : 'Non travaillé'}${item.note ? `\n${item.note}` : ''}` })) },
  ];
  return <>{blocks.map(block => <View key={block.id} style={{ marginBottom: 18 }}>
    <Text style={{ fontSize: 18, fontWeight: '600', color: '#31333f', marginBottom: 8 }}>{block.title}</Text>
    {block.lines.length ? block.lines.map(line => <Text key={line.id} style={{ marginBottom: 8, lineHeight: 22 }}>{line.text}</Text>) : <Text>Non renseigné</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={`Modifier ${block.title}`} onPress={() => onModify(block.id)} style={{ borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, padding: 14, marginTop: 8 }}><Text>Modifier</Text></Pressable>
  </View>)}</>;
}
