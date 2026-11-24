import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { isOnlineConfigured } from '@/net/config';
import { retryAuth, useAuth } from '@/net/auth';
import { createRoom } from '@/net/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, felt, text } from '@/theme/colors';
import { mono } from '@/theme/typography';
import { isInstalledApp } from '@/util/app-hop';
import { extractCode, isRoomCode } from '@/util/room-code';

export default function Home() {
  const router = useRouter();
  const { uid, error: authError } = useAuth();

  const playerName = useSettingsStore((s) => s.playerName);
  const setPlayerName = useSettingsStore((s) => s.setPlayerName);
  const lastRoom = useSettingsStore((s) => s.lastRoom);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);
  const motion = useSettingsStore((s) => s.motion);
  const setMotion = useSettingsStore((s) => s.setMotion);
  const tapToMoveFast = useSettingsStore((s) => s.tapToMoveFast);
  const setTapToMoveFast = useSettingsStore((s) => s.setTapToMoveFast);
  const highlightLegal = useSettingsStore((s) => s.highlightLegal);
  const setHighlightLegal = useSettingsStore((s) => s.setHighlightLegal);
  const autoConfirm = useSettingsStore((s) => s.autoConfirm);
  const setAutoConfirm = useSettingsStore((s) => s.setAutoConfirm);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const nameFor = () => (playerName.trim().length > 0 ? playerName.trim() : 'Player');
  const online = isOnlineConfigured;
  const ready = online && !!uid;

  /*
   * The installed app's half of the iPhone invite hop (util/app-hop.ts): the
   * Safari tab copied the invite, this reads it back and opens it. Read in an
   * effect, not during render: `/` is prerendered in Node, where there is no
   * `window`, and the client's first pass has to match that HTML.
   */
  const [installed, setInstalled] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  useEffect(() => setInstalled(isInstalledApp()), []);

  const joinCopiedInvite = async (): Promise<void> => {
    setPasteNote(null);
    try {
      const code = extractCode(await navigator.clipboard.readText());
      if (isRoomCode(code)) {
        router.push(`/join/${code}`);
        return;
      }
      setPasteNote('No invite on the clipboard. Copy the invite link, then tap again.');
    } catch {
      setPasteNote('Couldn’t read the clipboard. Tap Join game and paste it there.');
    }
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const code = await createRoom(nameFor());
      setLastRoom({ code, role: 'host' });
      router.push(`/lobby/${code}`);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not create a game');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.hero}>
        <Text style={styles.title}>Backgammon</Text>
        <Text style={styles.subtitle}>Two-player online · or vs a computer cat</Text>
      </View>

      <View style={styles.nameBlock}>
        <Text style={styles.fieldLabel}>Your name</Text>
        <TextInput
          value={playerName}
          onChangeText={setPlayerName}
          placeholder="Player"
          placeholderTextColor={text.faint}
          maxLength={16}
          autoCapitalize="words"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Your name"
        />
      </View>

      {!online && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Online play isn’t configured</Text>
          <Text style={styles.noticeBody}>
            Copy <Text style={styles.code}>.env.example</Text> to{' '}
            <Text style={styles.code}>.env</Text> and add your Firebase config. Playing the
            computer cat works either way.
          </Text>
        </View>
      )}

      {online && !uid && !authError && (
        <View style={styles.connecting}>
          <ActivityIndicator size="small" color={accent.gold} />
          <Text style={styles.connectingText}>connecting…</Text>
        </View>
      )}

      {authError && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Couldn’t sign in</Text>
          <Text style={styles.noticeBody}>{authError}</Text>
          <Button
            title="Try again"
            variant="secondary"
            onPress={() => {
              retryAuth().catch(() => {});
            }}
            style={styles.retry}
          />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Button
          title={creating ? 'Creating…' : 'Create game'}
          onPress={handleCreate}
          loading={creating}
          disabled={!ready || creating}
          style={styles.action}
        />
        {installed && (
          <Button
            title="Join copied invite"
            variant="secondary"
            onPress={() => void joinCopiedInvite()}
            disabled={!ready}
            style={styles.action}
          />
        )}
        <Button
          title="Join game"
          variant="secondary"
          onPress={() => router.push('/join')}
          disabled={!ready}
          style={styles.action}
        />
        {pasteNote && (
          <Text style={styles.pasteNote} accessibilityLiveRegion="polite">
            {pasteNote}
          </Text>
        )}
        {/*
          Deliberately NOT gated on `ready`: solo play is entirely offline, so
          making it wait on Firebase auth would leave the one thing that always
          works greyed out on a bad connection.
        */}
        <Button
          title="Play the Professor (a cat)"
          variant="secondary"
          onPress={() => router.push('/solo')}
          style={styles.action}
        />
      </View>

      {lastRoom && (
        <View style={styles.resume}>
          <Pressable
            onPress={() => router.push(`/lobby/${lastRoom.code}`)}
            style={styles.resumeMain}
            accessibilityRole="button"
            accessibilityLabel={`Resume game ${lastRoom.code}`}
          >
            <Text style={styles.resumeLabel}>Resume</Text>
            <Text style={styles.resumeCode}>{lastRoom.code}</Text>
          </Pressable>
          <Pressable
            onPress={() => setLastRoom(null)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Forget this game"
          >
            <Text style={styles.resumeDismiss}>×</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={() => router.push('/rules')} style={styles.link}>
        <Text style={styles.linkText}>How to play</Text>
      </Pressable>

      <Pressable onPress={() => setShowSettings((v) => !v)} style={styles.link}>
        <Text style={styles.linkText}>{showSettings ? 'Hide settings' : 'Settings'}</Text>
      </Pressable>

      {showSettings && (
        <View style={styles.settings}>
          <SettingRow
            label="Board animation"
            hint="Checkers slide, dice tumble"
            value={motion}
            onChange={setMotion}
          />
          <SettingRow
            label="Highlight legal moves"
            hint="Ring the points a checker can reach"
            value={highlightLegal}
            onChange={setHighlightLegal}
          />
          <SettingRow
            label="Fast tap-to-move"
            hint="One legal destination? Just go."
            value={tapToMoveFast}
            onChange={setTapToMoveFast}
          />
          <SettingRow
            label="Auto-confirm turn"
            hint="Commit as soon as the last die is used"
            value={autoConfirm}
            onChange={setAutoConfirm}
          />
        </View>
      )}
    </Screen>
  );
}

function SettingRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: felt.tableDeep, true: accent.goldDim }}
        thumbColor={value ? accent.gold : text.faint}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: 24, marginBottom: 28 },
  title: { color: accent.gold, fontSize: 44, fontWeight: '800', letterSpacing: 0.5 },
  subtitle: { color: text.muted, fontSize: 15, marginTop: 6 },

  nameBlock: { width: '100%', maxWidth: 340, alignSelf: 'center' },
  fieldLabel: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    color: text.primary,
    fontSize: 17,
    paddingHorizontal: 16,
  },

  notice: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableRaised,
  },
  noticeTitle: { color: accent.gold, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  noticeBody: { color: text.hint, fontSize: 13, lineHeight: 19 },
  code: { fontFamily: mono, color: text.primary },
  retry: { marginTop: 14 },

  connecting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20, gap: 8 },
  connectingText: { color: text.hint, fontSize: 14 },

  error: { color: accent.bad, fontSize: 14, textAlign: 'center', marginTop: 16 },
  pasteNote: { color: text.hint, fontSize: 14, textAlign: 'center', marginTop: 12 },

  actions: { width: '100%', maxWidth: 340, alignSelf: 'center', marginTop: 28 },
  action: { marginTop: 12 },

  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 24,
    paddingLeft: 16,
    paddingRight: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: accent.goldDim,
    gap: 10,
  },
  resumeMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resumeLabel: { color: text.muted, fontSize: 13 },
  resumeCode: { color: accent.gold, fontSize: 16, fontWeight: '800', fontFamily: mono, letterSpacing: 2 },
  resumeDismiss: { color: text.faint, fontSize: 22, lineHeight: 24 },

  link: { alignSelf: 'center', marginTop: 20, padding: 6 },
  linkText: { color: text.hint, fontSize: 14, textDecorationLine: 'underline' },

  settings: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    paddingHorizontal: 14,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 12,
  },
  settingText: { flex: 1 },
  settingLabel: { color: text.primary, fontSize: 15, fontWeight: '600' },
  settingHint: { color: text.faint, fontSize: 12, marginTop: 2 },
});
