import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { CatalogKind, QueryConnection } from '../storage/catalogs';
import { readCatalogHistory, type CatalogHistoryReport } from '../storage/catalogHistory';
import { historyLabels, historyPeriods, type HistoryPeriod } from '../domain/historyMetrics';
import { formatMinutes } from '../domain/workReport';
import { MetricChart } from './MetricChart';

const formatDate = (date: string | null) => date ? date.split('-').reverse().join('/') : 'n.c.';
const number = (value: number | null) => value === null ? 'n.c.' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);
const button = { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 8 };
export function CatalogHistory({ database, kind, date, active = true }: { database: QueryConnection; kind: CatalogKind; date: string; active?: boolean }) {
  const [period, setPeriod] = useState<HistoryPeriod>('all'), [grain, setGrain] = useState<'week' | 'month'>('week');
  const [statsPage, setStatsPage] = useState(0), [logsPage, setLogsPage] = useState(0), [chartPage, setChartPage] = useState(0);
  const [subject, setSubject] = useState<{ id: string; label: string }>(), [includeUncounted, setIncludeUncounted] = useState(kind === 'goals');
  const [loaded, setLoaded] = useState<{ key: string; report: CatalogHistoryReport }>(), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const key = JSON.stringify([kind, date, period, grain, statsPage, logsPage, subject?.id, includeUncounted]);
  useEffect(() => {
    if (!active) return;
    let current = true; setLoaded(undefined); setFailed(false); setExpanded(new Set());
    void readCatalogHistory(database, kind, date, period, { statisticsPage: statsPage, logsPage, subject: subject?.id, includeUncounted, grain }).then(report => { if (current) setLoaded({ key, report }); }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [database, active, key, attempt]);
  const report = loaded?.key === key ? loaded.report : undefined;
  const resetPages = () => { setStatsPage(0); setLogsPage(0); setChartPage(0); };
  const count = report?.periods.length ?? 0, pages = Math.max(1, Math.ceil(count / 24));
  const last = count - Math.min(chartPage, pages - 1) * 24, first = Math.max(0, last - 24);
  return <View style={{ gap: 14 }}>
    <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600' }}>{kind === 'friends' ? 'Récurrence et historique social' : 'Historique des objectifs'}</Text>
    <Text>Situation des activités au {formatDate(date)} (Paris). Archives incluses ; les statuts du répertoire affichés sont les statuts actuels.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{historyPeriods.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: value === period }} style={[button, value === period && { backgroundColor: '#ffe4e4' }]} onPress={() => { setPeriod(value); resetPages(); }}><Text>{historyLabels[value]}</Text></Pressable>)}</View>
    <Pressable accessibilityRole="button" style={button} onPress={() => setAttempt(value => value + 1)}><Text>Actualiser cet historique</Text></Pressable>
    {failed ? <><Text accessibilityRole="alert">Historique indisponible. Aucune donnée modifiée ; filtres conservés.</Text><Pressable accessibilityRole="button" style={button} onPress={() => setAttempt(value => value + 1)}><Text>Réessayer cet historique</Text></Pressable></> : !report ? <Text>Lecture de l’historique détaillé…</Text> : <>
      <Text>Du {formatDate(report.start)} au {formatDate(report.end)}.</Text>
      <Text accessibilityRole="header" style={{ fontSize: 19, fontWeight: '600' }}>{kind === 'friends' ? 'Personnes et récurrence' : 'Objectifs et contributions'} · page {statsPage + 1}</Text>
      <Text>Deux éléments homonymes restent distincts. Les jours décochés ne comptent pas comme interaction/contribution. Un intervalle nécessite au moins deux jours distincts.</Text>
      {!report.statistics.length && <Text>Aucun élément sur cette page.</Text>}
      {report.statistics.map(item => <View key={item.id} style={{ padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, gap: 6 }}>
        <Text style={{ fontWeight: '600' }}>{item.label}{item.category ? ` · ${item.category}` : ''} · {item.completed_at ? 'Terminé' : item.active ? 'Actif' : 'Archivé'}</Text>
        <Text>{kind === 'friends' ? 'Nombre de fois vue' : 'Jours de contribution'} : {item.count} · journées suivies : {item.tracked_days}</Text>
        <Text>Première fois : {formatDate(item.first_date)} · Dernière fois : {formatDate(item.last_date)}</Text>
        <Text>Jours depuis : {number(item.daysSince)} · Intervalle moyen entre deux fois : {item.averageInterval === null ? 'n.c.' : `${number(item.averageInterval)} j`}</Text>
        <Text>Créé le : {new Date(item.created_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}{item.completed_at ? ` · Terminé le : ${new Date(item.completed_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Voir le journal de ${item.label}`} style={button} onPress={() => { setSubject({ id: item.id, label: item.label }); setLogsPage(0); }}><Text>Voir ce journal</Text></Pressable>
      </View>)}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Pressable accessibilityRole="button" disabled={statsPage === 0} style={button} onPress={() => setStatsPage(value => value - 1)}><Text>← Éléments précédents</Text></Pressable><Pressable accessibilityRole="button" disabled={!report.statisticsMore} style={button} onPress={() => setStatsPage(value => value + 1)}><Text>Éléments suivants →</Text></Pressable></View>
      {kind === 'friends' && <>
        <Text accessibilityRole="header" style={{ fontSize: 19, fontWeight: '600' }}>Périodes sociales</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>{(['week', 'month'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: grain === value }} style={button} onPress={() => { setGrain(value); setChartPage(0); }}><Text>{value === 'week' ? 'Par semaine' : 'Par mois'}</Text></Pressable>)}</View>
        <Text>Toutes les personnes de la période, même si un journal individuel est filtré ci-dessous. Périodes renseignées seulement : l’absence d’une période ne signifie pas zéro activité.</Text>
        {!count ? <Text>Aucune interaction comptée pour cette période.</Text> : <>
          {([['days', 'Jours sociaux'], ['interactions', 'Personnes vues']] as const).map(([field, title]) => <View key={field}><Text>{title} · total : {report.periods.reduce((sum, item) => sum + item[field], 0)}</Text><MetricChart series={{ label: title, unit: field === 'days' ? 'jours' : 'interactions', group: 'Social', value: null, points: report.periods.slice(first, last).map(item => ({ date: item.date, value: item[field], future: false, label: grain === 'month' ? `${item.date.slice(5, 7)}/${item.date.slice(2, 4)}` : item.date.slice(5).split('-').reverse().join('/') })) }} /></View>)}
          {pages > 1 && <View><Text>Graphiques : points {first + 1}–{last} sur {count}.</Text><Pressable accessibilityRole="button" disabled={chartPage >= pages - 1} style={button} onPress={() => setChartPage(value => value + 1)}><Text>← Périodes plus anciennes</Text></Pressable><Pressable accessibilityRole="button" disabled={chartPage === 0} style={button} onPress={() => setChartPage(value => value - 1)}><Text>Périodes plus récentes →</Text></Pressable></View>}
        </>}
      </>}
      <Text accessibilityRole="header" style={{ fontSize: 19, fontWeight: '600' }}>Journal détaillé · page {logsPage + 1}</Text>
      {subject && <><Text>Filtre : {subject.label}</Text><Pressable accessibilityRole="button" style={button} onPress={() => { setSubject(undefined); setLogsPage(0); }}><Text>Voir tous les journaux</Text></Pressable></>}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: includeUncounted }} style={button} onPress={() => { setIncludeUncounted(value => !value); setLogsPage(0); }}><Text>Inclure les entrées non comptées</Text></Pressable>
      {!report.logs.length && <Text>Aucune entrée avec ces filtres.</Text>}
      {report.logs.map(item => <View key={item.id} style={{ padding: 12, borderWidth: 1, borderColor: '#d5d6dc', borderRadius: 10, gap: 8 }}>
        <Text style={{ fontWeight: '600' }}>{formatDate(item.entry_date)} · {item.label}{item.category ? ` · ${item.category}` : ''}</Text>
        <Text>{item.counted ? kind === 'friends' ? 'Interaction comptée' : 'Objectif travaillé' : 'Non compté · détails conservés'}{!item.active ? ' · Élément actuellement archivé/terminé' : ''}</Text>
        {kind === 'friends' && <Text>{(item.context ?? '').slice(0, expanded.has(item.id) ? undefined : 160)}{!expanded.has(item.id) && (item.context?.length ?? 0) > 160 ? '…' : ''} · Durée : {formatMinutes(item.duration_minutes)}</Text>}
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded.has(item.id) }} style={button} onPress={() => setExpanded(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}><Text>{expanded.has(item.id) ? 'Masquer' : 'Lire'} les détails du {formatDate(item.entry_date)} · {item.label}</Text></Pressable>
        {expanded.has(item.id) && <Text>{item.note ?? 'Aucune note.'}</Text>}
      </View>)}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Pressable accessibilityRole="button" disabled={logsPage === 0} style={button} onPress={() => setLogsPage(value => value - 1)}><Text>← Entrées plus récentes</Text></Pressable><Pressable accessibilityRole="button" disabled={!report.logsMore} style={button} onPress={() => setLogsPage(value => value + 1)}><Text>Entrées plus anciennes →</Text></Pressable></View>
      <Text>Lecture seule. Ouvre la journée correspondante dans Saisie pour modifier ses détails.</Text>
    </>}
  </View>;
}
