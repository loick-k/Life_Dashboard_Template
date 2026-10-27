import { Directory } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { PdfExportEnvironment } from '../services/workPdfExport';

export const nativeWorkPdf: PdfExportEnvironment = {
  uuid: randomUUID,
  chooseDestination: async name => {
    let directory: Directory;
    try { directory = await Directory.pickDirectoryAsync(); }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_PICKER_CANCELLED') return null; throw error; }
    const file = directory.createFile(name, 'application/pdf');
    return { write: async bytes => { file.write(bytes); }, read: () => file.bytes() };
  },
};
