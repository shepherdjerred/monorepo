import { useEffect } from "react";
import { Linking } from "react-native";

import { useSettingsContext } from "../state/SettingsContext";
import { navigationRef } from "./navigation-ref";

/**
 * __DEV__-only deep link that lets the Maestro e2e harness point the app at
 * a local test server without driving the Settings UI:
 *
 *   tasknotes://e2e-config?apiUrl=<url>&token=<token>
 *
 * On receipt (only in dev builds) it persists the API URL + auth token via
 * the normal SettingsContext setters and lands on the Today tab. The path is
 * intentionally absent from `linking.ts`, so React Navigation ignores it; in
 * production builds this component renders nothing and attaches no listener.
 */

type E2EConfig = {
  apiUrl: string;
  token: string;
};

export function parseE2EConfigUrl(url: string): E2EConfig | null {
  const separatorIndex = url.indexOf("?");
  if (separatorIndex === -1) return null;
  const base = url.slice(0, separatorIndex);
  if (base !== "tasknotes://e2e-config") return null;
  // React Native's URL polyfill mishandles custom schemes, so split the
  // query string off manually and parse it with URLSearchParams.
  const params = new URLSearchParams(url.slice(separatorIndex + 1));
  const apiUrl = params.get("apiUrl");
  const token = params.get("token");
  if (apiUrl === null || apiUrl.length === 0 || token === null) return null;
  return { apiUrl, token };
}

export function E2EConfigHandler() {
  const { setApiUrl, setAuthToken } = useSettingsContext();

  useEffect(() => {
    if (!__DEV__) return;

    async function applyConfig(url: string): Promise<void> {
      const config = parseE2EConfigUrl(url);
      if (config === null) return;
      await setApiUrl(config.apiUrl);
      await setAuthToken(config.token);
      if (navigationRef.isReady()) {
        navigationRef.navigate("Main", { screen: "Today" });
      }
    }

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyConfig(url);
    });
    // Also handle the case where the config link launched the app.
    void (async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl !== null) await applyConfig(initialUrl);
    })();

    return () => {
      subscription.remove();
    };
  }, [setApiUrl, setAuthToken]);

  return null;
}
