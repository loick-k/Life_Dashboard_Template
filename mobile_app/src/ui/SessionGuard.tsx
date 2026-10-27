import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { keyProtection } from '../storage/nativeProtection';
import { UnlockGeneration } from '../storage/keyProtection';
import { palette } from './palette';

/** Keep editors mounted while covered: pending writes and incomplete drafts survive locking. */
export function SessionGuard({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epochs = useRef(new UnlockGeneration());
  const working = useRef(false);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        // Native biometric prompts may temporarily make the activity inactive.
        // A real background transition, unlike the prompt, invalidates its result.
        if (state === 'background') epochs.current.invalidate();
        setLocked(true); Keyboard.dismiss();
      } else {
        const token = epochs.current.begin();
        void keyProtection.mode().then(mode => {
          if (mode === 'device' && epochs.current.accepts(token, AppState.currentState === 'active')) setLocked(false);
        }, () => setError('Protection illisible. Les données restent verrouillées.'));
      }
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!locked) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => listener.remove();
  }, [locked]);
  async function unlock() {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    const token = epochs.current.begin();
    try {
      if (!await keyProtection.readKey()) throw new Error('Missing key');
      if (epochs.current.accepts(token, AppState.currentState === 'active')) setLocked(false);
    } catch { setError('Déverrouillage annulé ou indisponible. Réessaie. Si la biométrie a changé, conserve tes fichiers et utilise ta sauvegarde chiffrée sur une installation distincte.'); }
    finally { working.current = false; setBusy(false); }
  }
  return <View style={styles.root}>
    <View style={styles.root} pointerEvents={locked ? 'none' : 'auto'} accessibilityElementsHidden={locked} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>{children}</View>
    {locked && <View accessibilityViewIsModal style={styles.cover}>
      <Text accessibilityRole="header" style={styles.title}>🔒 Life Dashboard verrouillé</Text>
      <Text>Les saisies en cours restent conservées. Déverrouille pour les retrouver.</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void unlock()}><Text style={styles.white}>{busy ? 'Vérification…' : 'Déverrouiller'}</Text></Pressable>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, cover: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#fff', padding: 28, justifyContent: 'center', gap: 24 },
  title: { fontSize: 25, fontWeight: '700', color: '#31333f' }, error: { color: '#b42318' },
  button: { minHeight: 48, padding: 14, backgroundColor: palette.primary, borderRadius: 10, alignItems: 'center' }, white: { color: '#fff', fontWeight: '600' },
});
