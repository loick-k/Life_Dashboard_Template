import * as SecureStore from 'expo-secure-store';
import { KeyProtection } from './keyProtection';

const legacyKey = 'life-dashboard.database-key.v1';
const protectedKey = 'database-key';
const policyKey = 'life-dashboard.protection.v1';
const authenticated = {
  keychainService: 'life-dashboard.biometric.v1',
  requireAuthentication: true,
  authenticationPrompt: 'Déverrouiller Life Dashboard',
};
export const canUseBiometrics = () => SecureStore.canUseBiometricAuthentication();
export const keyProtection = new KeyProtection({
  readPolicy: () => SecureStore.getItemAsync(policyKey),
  writePolicy: value => SecureStore.setItemAsync(policyKey, value),
  readPlain: () => SecureStore.getItemAsync(legacyKey),
  writePlain: key => SecureStore.setItemAsync(legacyKey, key),
  deletePlain: () => SecureStore.deleteItemAsync(legacyKey),
  readProtected: () => SecureStore.getItemAsync(protectedKey, authenticated),
  writeProtected: key => SecureStore.setItemAsync(protectedKey, key, authenticated),
  deleteProtected: () => SecureStore.deleteItemAsync(protectedKey, authenticated),
  canAuthenticate: canUseBiometrics,
});
