import React, { useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { canUseBiometrics, keyProtection } from '../storage/nativeProtection';
import type { ProtectionMode } from '../storage/keyProtection';

export function ProtectionScreen({ onDone }: { onDone(): void }) {
  const [mode, setMode] = useState<ProtectionMode>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  async function refresh() {
    try { setMode(await keyProtection.mode()); }
    catch { setError('Configuration illisible. Aucun déverrouillage de secours automatique.'); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (!working.current) onDone(); return true; });
    return () => listener.remove();
  }, [onDone]);
  async function change(enable: boolean) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { if (enable) await keyProtection.enable(); else await keyProtection.disable(); }
    catch { setError('Opération non confirmée. Les données sont conservées. Réessaie et vérifie l’état affiché.'); }
    finally { await refresh(); working.current = false; setBusy(false); }
  }
  return <ScrollView contentContainerStyle={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>Protection de l’application</Text>
    <Text>La base reste chiffrée. La biométrie protège sa clé dans Android Keystore et verrouille l’interface après chaque passage en arrière-plan.</Text>
    <Text accessibilityLiveRegion="polite">{mode === undefined ? 'Lecture de la protection…' : mode === 'device' ? 'Protection : verrouillage du téléphone uniquement.' : mode === 'enabling' ? 'Activation interrompue : authentification nécessaire pour terminer.' : 'Protection biométrique activée.'}</Text>
    <Text>Avant activation, crée une sauvegarde chiffrée dans Réglages et garde son code hors du téléphone. Ajouter ou retirer une empreinte peut invalider la clé Android : il faudra alors restaurer cette sauvegarde après réinstallation. Ne désinstalle jamais sans sauvegarde vérifiée.</Text>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    {mode === 'device' ? <>
      {!canUseBiometrics() && <Text>Biométrie forte non disponible ou non configurée. Configure-la dans les réglages de sécurité Android.</Text>}
      <Pressable accessibilityRole="button" disabled={busy || !canUseBiometrics()} style={styles.primary} onPress={() => Alert.alert('Activer la biométrie ?', 'As-tu conservé une sauvegarde chiffrée et son code ? Android peut demander deux confirmations lors de cette activation.', [
        { text: 'Annuler', style: 'cancel' }, { text: 'Activer', onPress: () => void change(true) },
      ])}><Text style={styles.white}>Activer la protection biométrique</Text></Pressable>
    </> : mode && <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => Alert.alert('Désactiver la biométrie ?', 'Le verrouillage de l’application sera retiré après authentification. Le chiffrement et le verrouillage du téléphone restent actifs.', [
      { text: 'Annuler', style: 'cancel' }, { text: 'Désactiver', onPress: () => void change(false) },
    ])}><Text>Désactiver après authentification</Text></Pressable>}
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => void Linking.openSettings().catch(() => setError('Ouvre manuellement les réglages Android.'))}><Text>Ouvrir les réglages Android de l’application</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={onDone}><Text>← Retour</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 24, paddingTop: 48, gap: 20, backgroundColor: '#fff' }, title: { fontSize: 26, fontWeight: '700', color: '#31333f' },
  primary: { minHeight: 48, padding: 14, borderRadius: 10, backgroundColor: '#ff4b4b', alignItems: 'center' }, white: { color: '#fff', fontWeight: '600' },
  secondary: { minHeight: 48, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d5d6dc' }, error: { color: '#b42318' },
});
