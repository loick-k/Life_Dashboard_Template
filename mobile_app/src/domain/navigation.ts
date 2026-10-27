import { validateDate } from '../storage/dailyEntries.ts';
export const mainDestinations = ['daily', 'bilan', 'todo', 'settings'] as const;
export type MainDestination = typeof mainDestinations[number];
export type OverlayDestination = 'backup' | 'import' | 'protection';
export interface AppNavigation {
  main: MainDestination; overlay: OverlayDestination | null;
  dailyDate: string; bilanDate: string; visited: MainDestination[];
}
export function initialNavigation(date: string): AppNavigation {
  validateDate(date);
  return { main: 'daily', overlay: null, dailyDate: date, bilanDate: date, visited: ['daily'] };
}
export function navigateMain(state: AppNavigation, destination: MainDestination, contextDate?: string): AppNavigation {
  if (!mainDestinations.includes(destination)) throw new Error('Destination inconnue');
  if (contextDate) validateDate(contextDate);
  return { ...state, main: destination, overlay: null,
    bilanDate: destination === 'bilan' && (contextDate || state.main === 'daily') ? contextDate ?? state.dailyDate : state.bilanDate,
    visited: [...new Set([...state.visited, destination])] };
}
