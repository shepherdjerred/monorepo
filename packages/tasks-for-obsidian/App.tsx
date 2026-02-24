import React, { useEffect } from "react";
import { StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SettingsProvider } from "./src/state/SettingsContext";
import { SyncProvider } from "./src/state/SyncContext";
import { TaskProvider } from "./src/state/TaskContext";
import { PomodoroProvider } from "./src/state/PomodoroContext";
import { TimeTrackingProvider } from "./src/state/TimeTrackingContext";
import { useSettings } from "./src/hooks/useSettings";
import { ErrorBoundary } from "./src/components/common/ErrorBoundary";
import { ConnectionBanner } from "./src/components/common/ConnectionBanner";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { initFeedback } from "./src/lib/feedback";

function ThemedApp() {
  const { isDarkMode } = useSettings();

  return (
    <>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      <ConnectionBanner />
      <AppNavigator />
    </>
  );
}

export default function App() {
  useEffect(() => {
    initFeedback();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <SettingsProvider>
            <TaskProvider>
              <SyncProvider>
                <PomodoroProvider>
                  <TimeTrackingProvider>
                    <ThemedApp />
                  </TimeTrackingProvider>
                </PomodoroProvider>
              </SyncProvider>
            </TaskProvider>
          </SettingsProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
