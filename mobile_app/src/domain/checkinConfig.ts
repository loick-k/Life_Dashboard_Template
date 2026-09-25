import type { DailyField } from '../storage/dailyEntries';
import type { InputKind } from './input';

export type CheckinField = { key: DailyField; label: string; kind: InputKind };
export type CheckinSection = { id: string; title: string; fields: CheckinField[] };
const field = (key: DailyField, label: string, kind: InputKind = 'number'): CheckinField => ({ key, label, kind });

/** V1 order from app_config.CHECKIN_STEPS. Stable IDs, never numerical UI branches. */
export const CHECKIN_SECTIONS: CheckinSection[] = [
  { id: 'sleep', title: 'Sommeil', fields: [field('sleep_hours', 'Durée du sommeil (heures)'), field('sleep_bedtime', 'Heure de coucher', 'time'), field('sleep_wake_time', 'Heure de réveil', 'time'), field('nap_minutes', 'Sieste (minutes)')] },
  { id: 'alcohol', title: 'Alcool', fields: [field('alcohol_glasses', 'Nombre de verres · 0 pour une journée sans alcool')] },
  { id: 'weight', title: 'Poids', fields: [field('weight_kg', 'Poids (kg)')] },
  { id: 'fat', title: 'Masse graisseuse', fields: [field('body_fat_pct', 'Masse graisseuse (%)')] },
  { id: 'belly', title: 'Tour de ventre', fields: [field('belly_cm', 'Tour de ventre (cm)')] },
  { id: 'work', title: 'Temps de travail', fields: [field('work_start_time', 'Heure de début', 'time'), field('work_morning_end_time', 'Fin de matinée', 'time'), field('work_afternoon_start_time', 'Début d’après-midi', 'time'), field('work_end_time', 'Fin de journée', 'time'), field('work_third_start_time', 'Créneau 3 · début', 'time'), field('work_third_end_time', 'Créneau 3 · fin', 'time')] },
  { id: 'sport', title: 'Séances de sport', fields: [] },
  { id: 'phone', title: 'Temps de portable', fields: [field('phone_minutes', 'Temps de portable (minutes)')] },
  { id: 'nutrition', title: 'Alimentation', fields: [field('meal_breakfast', 'Petit déjeuner', 'text'), field('meal_lunch', 'Déjeuner', 'text'), field('meal_dinner', 'Dîner', 'text'), field('meal_other', 'Autres prises', 'text')] },
  { id: 'me-time', title: 'Temps pour moi', fields: [field('me_time_writing_minutes', 'Écriture (minutes)'), field('me_time_meditation_minutes', 'Méditation (minutes)'), field('me_time_relaxation_minutes', 'Détente · lecture, musique, jeux de société (minutes)'), field('me_time_outings_minutes', 'Sorties · balades, cafés, bars, restaurants (minutes)')] },
  { id: 'listening', title: 'Écoute', fields: [field('self_listening_score', 'Écoute de soi-même (1 à 10)'), field('close_relations_listening_score', 'Écoute de mes proches (1 à 10)')] },
  { id: 'social', title: 'Suivi social', fields: [] },
  { id: 'goals', title: 'Objectifs', fields: [] },
  { id: 'summary', title: 'Récapitulatif', fields: [] },
];
