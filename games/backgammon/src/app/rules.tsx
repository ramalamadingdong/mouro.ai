import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { accent, felt, text } from '@/theme/colors';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {children}
    </View>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}

/**
 * A short rules reference. Backgammon needs one in a way a card game doesn't —
 * bearing off and scoring are where new players actually get stuck, and this
 * is cheaper than a tutorial nobody finishes.
 */
export default function RulesScreen() {
  const router = useRouter();
  return (
    <Screen scroll>
      <Text style={styles.title}>How to play Tawleh</Text>

      <Section title="The goal">
        <P>
          Move all fifteen of your checkers into your home board — the bottom-right quadrant on
          your screen — then bear them off. First to take all fifteen off wins the game.
        </P>
      </Section>

      <Section title="Moving">
        <P>
          Each player rolls one die to start; ties roll again. The higher roll goes first — and
          rolls both dice again for that first turn. After that you roll two dice on your turn.
        </P>
        <P>
          Your checkers always move toward your home board, one die per move — you can move one
          checker with both dice by tapping where it lands. You must play both
          dice if there is any legal way to do so, and if only one can be played it must be the
          larger. Roll a double and you play that number four times.
        </P>
        <P>
          You may land on a point that is empty, one of yours, or one holding a single enemy
          checker. A point with two or more enemy checkers is closed to you.
        </P>
      </Section>

      <Section title="Hitting and the bar">
        <P>
          Landing on a lone enemy checker — a blot — sends it to the bar. A player with a checker
          on the bar must bring it back into their opponent&apos;s home board before moving anything
          else. If every entry point is closed, the turn is lost.
        </P>
      </Section>

      <Section title="Bearing off">
        <P>
          Once all fifteen of your checkers are home, you can start taking them off. A 6 bears off
          from your 6 point, a 5 from your 5 point, and so on. If you roll a number higher than any
          point you still occupy, you may bear off from your highest occupied point.
        </P>
        <P>Get hit while bearing off and you must bring that checker all the way round again.</P>
      </Section>

      <Section title="Scoring: mars">
        <P>
          A win is worth 1 point. Bear everything off before your opponent has taken a single
          checker off and it is a mars — worth 2. That is the most a game can be worth: there is
          no triple game and no doubling cube.
        </P>
      </Section>

      <Section title="Matches">
        <P>A match is played to a set number of points; the first player to reach it wins.</P>
      </Section>

      <Section title="On this board">
        <P>
          Tap a point to pick a checker up; legal destinations light up. Tap one to move there. If a
          checker has only one legal move, tapping it just plays it. Undo as often as you like —
          nothing is sent until you tap Confirm.
        </P>
      </Section>

      <Button
        title="Back"
        variant="secondary"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={styles.back}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: accent.gold,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  section: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
  },
  heading: {
    color: accent.gold,
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  body: { color: text.hint, fontSize: 14, lineHeight: 21, marginTop: 6 },
  back: { marginTop: 28, alignSelf: 'center', width: '100%', maxWidth: 380 },
});
