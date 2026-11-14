import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { felt } from '@/theme/colors';

export type ScreenProps = {
  children: ReactNode;
  /** Center content on both axes. */
  center?: boolean;
  /** Wrap content in a vertical ScrollView. */
  scroll?: boolean;
  /** Drop the standard padding — the board wants the full width. */
  flush?: boolean;
};

/**
 * The felt-backed page wrapper. Provides safe-area insets, standard padding,
 * and optional centering / scrolling. Every screen renders inside one.
 */
export function Screen({ children, center = false, scroll = false, flush = false }: ScreenProps) {
  const pad = flush ? styles.flush : styles.content;

  if (scroll) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView
          contentContainerStyle={[pad, center && styles.centered]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[pad, styles.flex, center && styles.centered]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: felt.table },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 20 },
  flush: { flexGrow: 1, paddingHorizontal: 8, paddingVertical: 6 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
