import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { Linking } from 'react-native';
import type { SqlConnection } from './migrations';
import { TodoistGateway } from './todoistGateway';
import { nativeFetch } from './nativeHttp';

const key = 'todoist.connection.v1', options = { keychainService: 'life-dashboard.integrations.v1' };
export function nativeTodoist(database: SqlConnection) {
  return new TodoistGateway(database, { read: () => SecureStore.getItemAsync(key, options), write: value => SecureStore.setItemAsync(key, value, options), remove: () => SecureStore.deleteItemAsync(key, options) }, nativeFetch, randomUUID);
}
// No token, task data or local health field is placed in an external URL.
export const openTodoist = () => Linking.openURL('https://app.todoist.com/');
export const openTodoistDeveloperSettings = () => Linking.openURL('https://app.todoist.com/app/settings/integrations/developer');
