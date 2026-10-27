import type { SqlConnection } from './migrations';

export const onboardingSteps = ['welcome', 'data', 'preferences', 'protection', 'backup', 'integrations', 'review'] as const;
export type OnboardingStep = typeof onboardingSteps[number];
export interface OnboardingState {
  version: 1;
  revision: number;
  step: OnboardingStep;
  completed: boolean;
  dataChoice: 'empty' | 'existing' | 'import-v1' | 'restore-v2' | null;
}
const key = 'onboarding.v1';
const initial: OnboardingState = { version: 1, revision: 1, step: 'welcome', completed: false, dataChoice: null };

function decode(value: string | null): OnboardingState {
  if (value === null) throw new Error('Configuration initiale illisible. Aucune réinitialisation effectuée.');
  const state = JSON.parse(value) as OnboardingState;
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1 ||
      !onboardingSteps.includes(state.step) || typeof state.completed !== 'boolean' ||
      ![null, 'empty', 'existing', 'import-v1', 'restore-v2'].includes(state.dataChoice) ||
      (state.completed && (state.step !== 'review' || state.dataChoice === null))) {
    throw new Error('Configuration initiale incompatible. Aucune réinitialisation effectuée.');
  }
  return state;
}

/** Progress only. Imported data, preferences, protection and backup operations must
 * be committed by their own services before the UI advances beyond those steps.
 * No credentials or personal profile values are stored in this record.
 */
export class OnboardingProgress {
  private database: SqlConnection;
  constructor(database: SqlConnection) { this.database = database; }

  async read(): Promise<OnboardingState> {
    await this.database.runAsync('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
      key, JSON.stringify(initial), new Date().toISOString());
    const row = await this.database.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    return decode(row?.value ?? null);
  }

  async move(revision: number, step: OnboardingStep): Promise<OnboardingState> {
    return this.update(revision, current => {
      const from = onboardingSteps.indexOf(current.step);
      const to = onboardingSteps.indexOf(step);
      if (to < 0 || Math.abs(to - from) > 1) throw new Error('Étape non accessible.');
      if (from === 1 && to === 2 && current.dataChoice === null) throw new Error('Choisissez vos données de départ.');
      return { ...current, step };
    });
  }

  async chooseData(revision: number, choice: Exclude<OnboardingState['dataChoice'], null>): Promise<OnboardingState> {
    return this.update(revision, current => {
      if (current.step !== 'data' || !['empty', 'existing', 'import-v1', 'restore-v2'].includes(choice)) throw new Error('Choix non disponible.');
      return { ...current, dataChoice: choice };
    });
  }

  async finish(revision: number): Promise<OnboardingState> {
    return this.update(revision, current => {
      if (current.step !== 'review' || current.dataChoice === null) throw new Error('Vérifiez les choix avant de terminer.');
      return { ...current, completed: true };
    });
  }

  private async update(revision: number, transform: (state: OnboardingState) => OnboardingState): Promise<OnboardingState> {
    const row = await this.database.getFirstAsync<{ value: string | null }>('SELECT value FROM settings WHERE key = ?', key);
    const current = decode(row?.value ?? null);
    if (current.revision !== revision) throw new Error('La configuration a changé. Rechargez avant de continuer.');
    if (current.completed) throw new Error('Configuration déjà terminée. Utilisez les réglages.');
    const next = { ...transform(current), revision: current.revision + 1 };
    const encoded = JSON.stringify(next);
    decode(encoded);
    const result = await this.database.runAsync('UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?',
      encoded, new Date().toISOString(), key, row!.value);
    if (result.changes !== 1) throw new Error('La configuration a changé. Rechargez avant de continuer.');
    return next;
  }
}
