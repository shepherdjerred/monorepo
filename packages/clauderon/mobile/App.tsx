import React, { useState } from 'react';
import { StatusBar, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { SessionProvider } from './src/contexts/SessionContext';
import { PreferencesProvider, usePreferences } from './src/contexts/PreferencesContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { FREModal } from './src/components/FREModal';
import { SENTRY_DSN } from './src/config';

// Initialize Sentry for error reporting
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
  });
}

function ThemedApp(): React.JSX.Element {
  const { isDark, colors } = useTheme();
  const { shouldShowFirstRun, completeFirstRun } = usePreferences();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const handleFREComplete = () => {
    completeFirstRun();
  };

  const handleFRESkip = () => {
    completeFirstRun();
  };

  const handleFRECreateSession = () => {
    // This would navigate to create session screen
    // For now, just mark FRE complete
    completeFirstRun();
    // TODO: Navigate to CreateSessionScreen
  };

  return (
    <SessionProvider>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        backgroundColor={colors.primary}
      />
      <AppNavigator />
      <FREModal
        visible={shouldShowFirstRun}
        onComplete={handleFREComplete}
        onSkip={handleFRESkip}
        onCreateSession={handleFRECreateSession}
      />
    </SessionProvider>
  );
}

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Sentry.ErrorBoundary
        fallback={({ error }) => (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
              An error occurred
            </Text>
            <Text style={{ color: '#666' }}>{error.message}</Text>
          </View>
        )}
      >
        <SafeAreaProvider>
          <ThemeProvider>
            <PreferencesProvider>
              <ThemedApp />
            </PreferencesProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </Sentry.ErrorBoundary>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
