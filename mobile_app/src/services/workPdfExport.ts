import { buildWorkPdf } from '../domain/workPdf.ts';
import type { WorkReport } from '../domain/workReport.ts';

export interface PdfDestination { write(bytes: Uint8Array): Promise<void>; read(): Promise<Uint8Array> }
export interface PdfExportEnvironment { uuid(): string; chooseDestination(name: string): Promise<PdfDestination | null> }
/** Export only an already-confirmed work snapshot. Never writes to the database or an app temp folder. */
export async function exportWorkPdf(report: WorkReport, environment: PdfExportEnvironment): Promise<'cancelled' | 'verified'> {
  const bytes = buildWorkPdf(report), id = environment.uuid();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Identifiant d’export invalide');
  const destination = await environment.chooseDestination(`travail-${report.date}-${id}.pdf`);
  if (!destination) return 'cancelled';
  await destination.write(bytes);
  const actual = await destination.read();
  if (actual.length !== bytes.length || actual.some((byte, index) => byte !== bytes[index])) throw new Error('Export PDF non vérifié');
  return 'verified';
}
