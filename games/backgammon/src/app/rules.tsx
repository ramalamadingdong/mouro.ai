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
 * bearing off and the cube are where new players actually get stuck, and this
 * is cheaper than a tutorial nobody finishes.
 */
export default function RulesScreen() {
  const router = useRouter();
  return (
    <Screen scroll>
      <Text style={styles.title}>How to play</Text>

      <Section title="The goal">
        <P>
          Move all fifteen of your checkers into your home board — the bottom-right quadrant on
          your screen — then bear them off. First to take all fifteen off wins the game.
        </P>
      </Section>

      <Section title="Moving">
        <P>
          Each player rolls one die to start; the higher roll goes first and plays those two
          numbers. After that you roll two dice on your turn.
        </P>
        <P>
          Your checkers always move toward your home board, one die per move. You must play both
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
          on the bar must bring it back into their opponent's home board before moving anything
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

      <Section title="Gammons and backgammons">
        <P>
          Win while your opponent has borne off at least one checker and you score the value of the
          cube. Win before they have borne off any and it is a gammon — double. Win while they
          still have a checker on the bar or in your home board and it is a backgammon — triple.
        </P>
      </Section>

      <Section title="The doubling cube">
        <P>
          Before rolling, you may offer to double the stakes. Your opponent either takes — the game
          is now worth twice as much, and the cube becomes theirs to turn next — or drops, ending
          the game immediately and giving you the value the cube was on before you offered.
        </P>
        <P>Only the player who last accepted a double may offer the next one.</P>
      </Section>

      <Section title="Matches and the Crawford rule">
        <P>
          A match is played to a set number of points. When either player gets to one point short
          of the match, the very next game is the Crawford game and no doubling is allowed in it.
          After that game, doubling is back on.
        </P>
        <P>In a one-point match there is no doubling at all.</P>
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
