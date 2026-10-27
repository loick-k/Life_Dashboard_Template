import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { openLocalDatabase } from './storage/nativeDatabase';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DailyForm } from './ui/DailyForm';
import { PreferencesForm } from './ui/PreferencesForm';
import { WorkBilan } from './ui/WorkBilan';
import { BackupScreen } from './ui/BackupScreen';
import { OnboardingScreen } from './ui/OnboardingScreen';
import { OnboardingProgress } from './storage/onboarding';
import { V1ImportScreen } from './ui/V1ImportScreen';
import { ProtectionScreen } from './ui/ProtectionScreen';
import { SessionGuard } from './ui/SessionGuard';
import type { EditorHandle } from './ui/editorHandle';
import { parisDate } from './domain/dates';
import { initialNavigation, mainDestinations, navigateMain, type MainDestination, type OverlayDestination } from './domain/navigation';

export default function App() { return <SessionGuard><Dashboard /></SessionGuard>; }

function Dashboard() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'opening' | 'ready' | 'failed'>('opening');
  const [database, setDatabase] = useState<SQLiteDatabase>();
  const [onboarding, setOnboarding] = useState(false);
  const [navigation, setNavigation] = useState(() => initialNavigation(parisDate()));
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const daily = useRef<EditorHandle>(null), settings = useRef<EditorHandle>(null);
  useEffect(() => {
    let active = true; setStatus('opening');
    void (async () => {
      try {
        const db = await openLocalDatabase();
        const progress = await new OnboardingProgress(db).read();
        if (active) { setDatabase(db); setStatus('ready'); setOnboarding(!progress.completed); }
      } catch { if (active) setStatus('failed'); }
    })();
    return () => { active = false; };
  }, [attempt]);
  const rememberDaily = useCallback((date: string) => setNavigation(state => state.dailyDate === date ? state : { ...state, dailyDate: date }), []);
  const rememberBilan = useCallback((date: string) => setNavigation(state => state.bilanDate === date ? state : { ...state, bilanDate: date }), []);
  const go = async (destination: MainDestination, contextDate?: string) => {
    if (moving.current) return;
    moving.current = true; setBusy(true); Keyboard.dismiss();
    try {
      const editor = navigation.main === 'daily' ? daily.current : navigation.main === 'settings' ? settings.current : null;
      try { await editor?.settle(); } catch { /* Keep this editor mounted; navigation never discards its failed draft. */ }
      const unconfirmed = daily.current?.hasUnconfirmed() || settings.current?.hasUnconfirmed();
      setNotice(unconfirmed ? 'Un brouillon non confirmé reste conservé dans Saisie/Réglages. Les bilans et sauvegardes montrent uniquement les valeurs enregistrées. Reviens terminer ou résoudre ce brouillon avant une restauration.' : '');
      setNavigation(state => navigateMain(state, destination, contextDate));
    } finally { moving.current = false; setBusy(false); }
  };
  const beforeReplace = async () => {
    await daily.current?.beforeReplace(); await settings.current?.beforeReplace();
  };
  const refreshed = async () => { setEpoch(value => value + 1); setNotice('Les écrans reliront les données confirmées à leur ouverture.'); };
  const openOverlay = (overlay: OverlayDestination) => {
    Keyboard.dismiss();
    setNotice(daily.current?.hasUnconfirmed() || settings.current?.hasUnconfirmed() ? 'Un brouillon non confirmé reste conservé. La sauvegarde contient uniquement les valeurs enregistrées ; termine les brouillons avant une restauration.' : '');
    setNavigation(state => ({ ...state, overlay }));
  };
  const closeOverlay = () => setNavigation(state => ({ ...state, overlay: null }));
  useEffect(() => {
    if (status !== 'ready' || onboarding || navigation.overlay || navigation.main === 'daily') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { void go('daily'); return true; });
    return () => listener.remove();
  });
  if (status !== 'ready' || !database) return <View style={styles.page}>
    <Text accessibilityRole="header" style={styles.title}>🌱 Life Dashboard</Text>
    <Text>{status === 'opening' ? 'Ouverture du stockage sécurisé…' : 'Stockage ou configuration indisponible. Les fichiers sont conservés ; aucune base ni clé n’est réinitialisée.'}</Text>
    {status === 'failed' && <Pressable accessibilityRole="button" style={styles.button} onPress={() => setAttempt(value => value + 1)}><Text>Réessayer</Text></Pressable>}
  </View>;
  if (onboarding) return <OnboardingScreen database={database} onDone={() => setOnboarding(false)} />;
  const active = (destination: MainDestination) => navigation.main === destination && navigation.overlay === null;
  const panel = (destination: MainDestination) => [styles.panel, !active(destination) && styles.hidden];
  return <View style={styles.root}>
    {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
    <View style={styles.root}>
      <View style={panel('daily')} importantForAccessibility={active('daily') ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!active('daily')}>
        <DailyForm key={'daily:' + epoch} ref={daily} database={database} active={active('daily')} initialDate={navigation.dailyDate} onDate={rememberDaily} onBilan={date => void go('bilan', date)} onSettings={() => void go('settings')} />
      </View>
      {navigation.visited.includes('bilan') && <View style={panel('bilan')} importantForAccessibility={active('bilan') ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!active('bilan')}>
        <WorkBilan key={'bilan:' + epoch} database={database} active={active('bilan')} initialDate={navigation.bilanDate} onDate={rememberBilan} onDone={() => void go('daily')} />
      </View>}
      {navigation.visited.includes('settings') && <View style={panel('settings')} importantForAccessibility={active('settings') ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!active('settings')}>
        <PreferencesForm key={'settings:' + epoch} ref={settings} database={database} preserveOnNavigate active={active('settings')} onBackup={() => openOverlay('backup')} onImport={() => openOverlay('import')} onProtection={() => openOverlay('protection')} onDone={() => go('daily')} />
      </View>}
      {navigation.main === 'todo' && !navigation.overlay && <View style={styles.page}><Text accessibilityRole="header" style={styles.title}>Todo</Text><Text>L’intégration Todoist sera reliée dans le lot de parité. Les autres fonctions restent disponibles hors ligne.</Text></View>}
      {navigation.overlay === 'backup' && <BackupScreen database={database} beforeRestore={beforeReplace} onRestored={refreshed} onDone={closeOverlay} />}
      {navigation.overlay === 'import' && <V1ImportScreen database={database} beforeImport={beforeReplace} onImported={refreshed} onDone={closeOverlay} />}
      {navigation.overlay === 'protection' && <ProtectionScreen onDone={closeOverlay} />}
    </View>
    {!navigation.overlay && <View accessibilityRole="tablist" style={styles.menu}>{mainDestinations.map(destination => <Pressable key={destination} accessibilityRole="tab" accessibilityState={{ selected: navigation.main === destination, disabled: busy }} disabled={busy} style={[styles.tab, navigation.main === destination && styles.selected]} onPress={() => void go(destination)}>
      <Text style={styles.tabText}>{{ daily: 'Saisie', bilan: 'Bilan', todo: 'Todo', settings: 'Réglages' }[destination]}</Text>
    </Pressable>)}</View>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' }, panel: { flex: 1 }, hidden: { display: 'none' },
  page: { flex: 1, padding: 24, paddingTop: 56, gap: 20, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', color: '#31333f' },
  button: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, justifyContent: 'center' },
  notice: { padding: 12, backgroundColor: '#fff8df', color: '#765000', lineHeight: 20 },
  menu: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#d5d6dc', padding: 6, gap: 4 },
  tab: { flex: 1, minHeight: 52, justifyContent: 'center', alignItems: 'center', borderRadius: 10, paddingVertical: 8 },
  selected: { backgroundColor: '#ffe4e4' }, tabText: { color: '#31333f', fontSize: 14 },
});
