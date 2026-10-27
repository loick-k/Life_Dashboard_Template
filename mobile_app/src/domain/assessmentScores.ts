/** V1 dashboard_metrics.py formulas, without pandas/Streamlit. Deliberate V2 fixes
 * (configurable sleep, missing observations, zero targets) are documented and tested separately. */
export type Score = readonly [number | null, string];
export function roundEven(value: number): number {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + Math.abs(floor % 2) : Math.round(value);
}
export function scoreSleep(hours: number | null, minimum = 7): Score {
  if (minimum === 0) return [null, 'Objectif sommeil désactivé dans les réglages.'];
  if (hours === null) return [null, 'Pas assez de données sommeil.'];
  const maximum = minimum + 2;
  if (hours >= minimum && hours <= maximum) return [100, 'Sommeil moyen dans la zone cible.'];
  if (hours >= minimum - 1 && hours <= maximum + 1) return [75, 'Sommeil proche de la zone cible.'];
  if (hours >= minimum - 2 && hours <= maximum + 2) return [50, 'Sommeil à surveiller.'];
  return [30, 'Sommeil très éloigné de la zone cible.'];
}
export function scoreAlcohol(glasses: number | null): Score {
  if (glasses === null) return [null, 'Pas assez de données alcool cette semaine.'];
  return glasses === 0 ? [100, 'Semaine explicitement saisie sans alcool.']
    : glasses <= 4 ? [80, 'Consommation alcool faible cette semaine.']
    : glasses <= 8 ? [55, 'Consommation alcool modérée à surveiller.'] : [30, 'Consommation alcool élevée cette semaine.'];
}
export function scoreTobacco(days: number): Score {
  return days >= 365 ? [100, 'Plus d’un an sans tabac.'] : days >= 90 ? [90, 'Plus de trois mois sans tabac.']
    : days >= 30 ? [80, 'Plus d’un mois sans tabac.'] : days >= 7 ? [70, 'Plus d’une semaine sans tabac.']
    : days > 0 ? [60, 'Dynamique sans tabac engagée.'] : [30, 'Arrêt du tabac à consolider.'];
}
export function scoreSport(hours: number | null, target: number): Score {
  if (target === 0) return [null, 'Objectif sport désactivé dans les réglages.'];
  if (hours === null) return [null, 'Pas assez de données sport cette semaine.'];
  return hours >= target ? [100, 'Objectif sport hebdomadaire atteint.']
    : hours >= target / 2 ? [70, 'Sport présent mais objectif pas encore atteint.']
    : hours > 0 ? [45, 'Un peu de sport, mais volume faible.'] : [25, 'Aucune activité sportive saisie cette semaine.'];
}
export function scorePhone(hours: number | null, maximum: number): Score {
  if (hours === null) return [null, 'Pas assez de données portable.'];
  if (maximum === 0) return hours === 0 ? [100, 'Temps portable dans ton critère.'] : [25, 'Temps portable très élevé.'];
  return hours <= maximum ? [100, 'Temps portable dans ton critère.']
    : hours <= maximum * 1.4 + 1e-9 ? [70, 'Temps portable légèrement au-dessus du critère.']
    : hours <= maximum * 2 + 1e-9 ? [45, 'Temps portable assez élevé.'] : [25, 'Temps portable très élevé.'];
}
export function scoreNutrition(days: number): Score {
  if (!days) return [null, 'Aucune donnée alimentation renseignée cette semaine.'];
  return days >= 6 ? [100, 'Alimentation bien renseignée cette semaine.']
    : days >= 4 ? [75, 'Alimentation renseignée sur une partie de la semaine.']
    : days >= 2 ? [50, 'Alimentation peu renseignée.'] : [30, 'Très peu de données alimentation.'];
}
export function scoreBody(belly: number | null, weight: number | null, fat: number | null, goal: number | null, trend: number | null): Score {
  if (belly === null && weight === null && fat === null) return [null, 'Pas assez de données corps.'];
  if (goal !== null && goal > 0 && belly !== null) {
    const delta = belly - goal;
    return delta <= 0 ? [100, 'Tour de ventre dans ton critère personnel.']
      : delta <= 3 ? [75, 'Tour de ventre proche du critère personnel.']
      : delta <= 7 ? [55, 'Tour de ventre au-dessus du critère.'] : [35, 'Tour de ventre nettement au-dessus du critère.'];
  }
  if (trend !== null) return trend < -1 ? [85, 'Tendance récente du tour de ventre à la baisse.']
    : trend <= 1 ? [65, 'Tour de ventre plutôt stable.'] : [45, 'Tour de ventre en hausse sur la période récente.'];
  return [60, 'Données corps présentes, mais pas encore assez de recul.'];
}
export function scoreSocial(days: number | null, target: number): Score {
  if (target === 0) return [null, 'Objectif social désactivé dans les réglages.'];
  if (days === null) return [null, 'Aucun suivi social renseigné cette semaine.'];
  return days >= target ? [100, 'Objectif social hebdomadaire atteint.'] : days >= 1
    ? [70, 'Au moins une journée sociale cette semaine.'] : [35, 'Aucune interaction sociale saisie cette semaine.'];
}
export function scoreGoals(workedDays: number, trackedDays: number): Score {
  if (!trackedDays) return [null, "Pas encore de suivi d'objectifs cette semaine."];
  const ratio = workedDays / trackedDays;
  return ratio >= 0.8 ? [100, 'Objectifs travaillés presque tous les jours saisis.']
    : ratio >= 0.5 ? [75, 'Objectifs travaillés régulièrement.'] : ratio > 0
    ? [50, 'Objectifs travaillés ponctuellement.'] : [25, 'Aucun objectif travaillé sur les jours saisis.'];
}
export function scoreTracking(tracked: number, expected: number, label: string): Score {
  if (!tracked) return [null, `Aucune donnée ${label.toLowerCase()} cette semaine.`];
  const ratio = tracked / Math.max(expected, 1);
  return [ratio >= 0.8 ? 100 : ratio >= 0.5 ? 75 : ratio >= 0.25 ? 50 : 30, `${tracked}/${expected} jour(s) renseigné(s) cette semaine.`];
}
export function scoreWork(hours: number | null, target: number): Score {
  if (target === 0) return [null, 'Objectif travail hebdomadaire désactivé dans les réglages.'];
  if (hours === null) return [null, 'Aucun temps de travail renseigné cette semaine.'];
  const ratio = hours / target;
  return ratio >= 0.9 && ratio <= 1.1 ? [100, 'Temps de travail proche de l’objectif hebdomadaire.']
    : ratio >= 0.7 && ratio <= 1.25 ? [75, 'Temps de travail assez proche de l’objectif.']
    : ratio > 1.25 ? [50, 'Temps de travail nettement supérieur à l’objectif.'] : [45, 'Temps de travail inférieur à l’objectif hebdomadaire.'];
}
export function scorePositiveTime(minutes: number | null, label: string, target = 60): Score {
  if (minutes === null) return [null, `Aucun temps ${label.toLowerCase()} renseigné cette semaine.`];
  return minutes >= target ? [100, `${label} bien présent cette semaine.`] : minutes > 0
    ? [65, `${label} présent, mais encore ponctuel cette semaine.`] : [35, `Aucun temps consacré à ${label.toLowerCase()} cette semaine.`];
}
export function scoreRating(average: number | null, label: string): Score {
  return average === null ? [null, `Aucune note pour ${label.toLowerCase()} cette semaine.`]
    : [roundEven(Math.max(1, Math.min(10, average)) * 10), `Note moyenne : ${average.toFixed(1)}/10 cette semaine.`];
}
export function assessmentLabel(score: number | null): string {
  return score === null ? 'Pas assez de données' : score >= 85 ? 'Très bonne dynamique' : score >= 70
    ? 'Bonne dynamique' : score >= 55 ? 'Équilibre fragile' : 'Semaine difficile';
}
