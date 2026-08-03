import { useEffect } from 'react';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// expo-router requires this import for its side effects. We never write
// worklets — every animation in this app is plain RN `Animated`.
import 'react-native-reanimated';

import { ensureAnonymousAuth } from '@/fb/auth';
import { felt } from '@/theme/colors';

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: felt.table, card: felt.tableDeep },
};

export default function RootLayout() {
  // Bootstrap the invisible anonymous account app-wide, regardless of which
  // route the app cold-starts into (e.g. resuming straight into a game). This is
  // single-flight, so the Home screen's useAuth() reuses the same sign-in.
  useEffect(() => {
    ensureAnonymousAuth().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: felt.table },
              animation: 'fade',
            }}
          />
          <StatusBar style="light" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
