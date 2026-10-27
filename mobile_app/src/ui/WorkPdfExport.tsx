import React, { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WorkReport } from '../domain/workReport';
import { exportWorkPdf } from '../services/workPdfExport';
import { nativeWorkPdf } from '../storage/nativeWorkPdf';
import { palette } from './palette';

export function WorkPdfExport({ report, disabled = false, onBusy }: { report: WorkReport; disabled?: boolean; onBusy?(value: boolean): void }) {
  const working = useRef(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  async function begin() {
    if (working.current || disabled) return;
    working.current = true; setBusy(true); onBusy?.(true); setMessage(''); setFailed(false);
    try {
      const confirmed = await new Promise<boolean>(resolve => Alert.alert('Exporter un PDF non chiffré ?', 'Ce rapport contient tes horaires et compteurs de travail enregistrés, sans les brouillons. Choisis un espace privé. Aucun envoi réseau n’est effectué par l’application ; le dossier choisi peut toutefois être synchronisé par son fournisseur.', [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) }, { text: 'Exporter', onPress: () => resolve(true) },
      ], { cancelable: false }));
      if (!confirmed) { setMessage('Export annulé.'); return; }
      const result = await exportWorkPdf(report, nativeWorkPdf);
      setMessage(result === 'verified' ? 'PDF enregistré et relu à l’identique. Il reste non chiffré dans le dossier choisi.' : 'Export annulé.');
    } catch { setFailed(true); setMessage('Export non confirmé. Un fichier incomplet peut subsister dans le dossier choisi : ne l’utilise pas comme rapport validé. Les données de l’application sont conservées ; tu peux réessayer.'); }
    finally { working.current = false; setBusy(false); onBusy?.(false); }
  }
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} style={styles.button} onPress={() => void begin()}><Text style={styles.white}>{busy ? 'Export en cours…' : 'Enregistrer le rapport PDF du travail'}</Text></Pressable>
    {!!message && <Text accessibilityRole={failed ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: failed ? '#b42318' : '#626570' }}>{message}</Text>}
  </View>;
}
const styles = StyleSheet.create({ button: { minHeight: 48, padding: 14, backgroundColor: palette.primary, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, white: { color: '#fff', fontWeight: '600', textAlign: 'center' } });
