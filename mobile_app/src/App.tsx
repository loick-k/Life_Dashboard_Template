import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Bootstrap only: do not collect personal data until native storage is verified. */
export default function App() {
  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>🌱 Life Dashboard</Text>
      <Text style={styles.subtitle}>Votre tableau de bord personnel, sur votre téléphone.</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Version de développement</Text>
        <Text style={styles.body}>Le stockage sécurisé et le parcours de première utilisation sont en préparation. Aucune donnée personnelle n’est demandée à cette étape.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, paddingTop: 64, backgroundColor: '#ffffff' },
  title: { fontSize: 30, fontWeight: '700', color: '#31333f' },
  subtitle: { fontSize: 16, color: '#626570', marginTop: 12, lineHeight: 24 },
  card: { borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 16, padding: 20, marginTop: 32 },
  heading: { fontSize: 20, fontWeight: '600', color: '#31333f', marginBottom: 12 },
  body: { fontSize: 16, lineHeight: 24, color: '#31333f' },
});
