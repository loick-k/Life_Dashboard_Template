import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { parisDate } from '../domain/dates';

/** A calendar reference, not the selected day: never replace a historical draft. */
export function useParisToday(visible = true): string {
  const [today, setToday] = useState(parisDate);
  useEffect(() => {
    if (!visible) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer !== undefined) { clearInterval(timer); timer = undefined; } };
    const refresh = () => setToday(parisDate());
    const resume = () => { stop(); refresh(); timer = setInterval(refresh, 60_000); };
    if (AppState.currentState === 'active') resume();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') resume(); else stop(); });
    return () => { stop(); listener.remove(); };
  }, [visible]);
  return today;
}
