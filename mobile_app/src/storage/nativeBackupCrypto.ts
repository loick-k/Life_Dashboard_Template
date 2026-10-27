import * as Crypto from 'expo-crypto';
import type { BackupCrypto } from './backupFormat';

export const nativeBackupCrypto: BackupCrypto = {
  randomKey: async () => (await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256)).encoded('hex'),
  encrypt: async (plaintext, key, aad) => {
    const imported = await Crypto.AESEncryptionKey.import(key, 'hex');
    const sealed = await Crypto.aesEncryptAsync(plaintext, imported, { nonce: { length: 12 }, tagLength: 16, additionalData: aad });
    return sealed.combined('base64');
  },
  decrypt: async (combined, key, aad) => Crypto.aesDecryptAsync(
    Crypto.AESSealedData.fromCombined(combined, { ivLength: 12, tagLength: 16 }),
    await Crypto.AESEncryptionKey.import(key, 'hex'), { additionalData: aad }),
  sha256: text => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
};
