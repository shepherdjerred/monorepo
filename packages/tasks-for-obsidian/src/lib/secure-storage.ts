import * as Keychain from "react-native-keychain";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SERVICE_NAME = "com.tasksforobsidian.auth";
const LEGACY_KEY = "@tasknotes/auth-token";

export async function getAuthToken(): Promise<string | undefined> {
  const credentials = await Keychain.getGenericPassword({
    service: SERVICE_NAME,
  });
  if (credentials) return credentials.password;

  // Fall back to AsyncStorage for migration
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy) {
    await setAuthToken(legacy);
    await AsyncStorage.removeItem(LEGACY_KEY);
    return legacy;
  }
  return undefined;
}

export async function setAuthToken(token: string): Promise<void> {
  await Keychain.setGenericPassword("authToken", token, {
    service: SERVICE_NAME,
  });
}

export async function removeAuthToken(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE_NAME });
}
