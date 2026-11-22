/**
 * Offline play against the cats: the setup form until a game exists, then the
 * table. The game lives in soloStore (persisted), so this route is also where
 * a refresh lands back in the middle of a game.
 */
import { useNavigate } from 'react-router-dom';
import { CATS, CAT_UID_PREFIX } from '@/ai';
import { Avatar } from '@/components/avatar';
import { GameView } from '@/components/game-view';
import { RuleChoices } from '@/components/rule-choices';
import { Segmented } from '@/components/segmented';
import { useCatDriver } from '@/hooks/use-cat-driver';
import { useSettingsStore } from '@/store/settingsStore';
import { randomSeed } from '@/util/seed';
import { SOLO_UID, useSoloStore } from '@/store/soloStore';
import { MAX_NAME_LENGTH } from '@/util/seat';
import './screen.css';
import './home.css';

function Setup() {
  const navigate = useNavigate();
  const playerName = useSettingsStore((s) => s.playerName);
  const setPlayerName = useSettingsStore((s) => s.setPlayerName);
  const table = useSettingsStore((s) => s.table);
  const setTable = useSettingsStore((s) => s.setTable);
  const start = useSoloStore((s) => s.start);

  return (
    <main className="screen">
      <form
        className="screen__inner home"
        onSubmit={(e) => {
          e.preventDefault();
          start(playerName, table);
        }}
      >
        <h1 className="screen__title">Play the cats</h1>
        <p className="screen__subtitle">You and three computer cats, Hong Kong rules.</p>

        <div className="field">
          <label className="field__label" htmlFor="solo-name">
            Your name
          </label>
          <input
            id="solo-name"
            className="field__input"
            type="text"
            value={playerName}
            maxLength={MAX_NAME_LENGTH}
            placeholder="You"
            autoComplete="nickname"
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </div>

        <ul className="setup__cats" aria-label="Who is playing">
          {CATS.map((cat) => (
            <li key={cat.id} className="setup__cat" data-in="true">
              <Avatar uid={`${CAT_UID_PREFIX}${cat.id}`} name={cat.name} />
              <span className="setup__cat-text">
                <span className="setup__cat-name">{cat.name}</span>
                <span className="setup__cat-blurb">{cat.blurb}</span>
              </span>
            </li>
          ))}
        </ul>

        <RuleChoices />
        <Segmented
          label="How well the cats play"
          value={table.difficulty}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'medium', label: 'Medium' },
            { value: 'hard', label: 'Hard' },
          ]}
          onChange={(difficulty) => setTable({ difficulty })}
        />

        <div className="stack">
          <button type="submit" className="btn btn--primary btn--block">
            Start
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </form>
    </main>
  );
}

function SoloGame() {
  const game = useSoloStore((s) => s.game);
  const difficulty = useSoloStore((s) => s.difficulty);
  const thinkingSeat = useSoloStore((s) => s.thinkingSeat);
  const error = useSoloStore((s) => s.error);
  const send = useSoloStore((s) => s.send);
  const setThinking = useSoloStore((s) => s.setThinking);
  const clearError = useSoloStore((s) => s.clearError);
  const quit = useSoloStore((s) => s.quit);
  // Mounted only while a game exists, so the cats' timers start and stop
  // with the table itself.
  useCatDriver({
    state: game,
    difficulty,
    controls: () => true,
    send: (move, seat) => {
      const cur = useSoloStore.getState().game;
      if (cur) send(move, cur.players[seat].uid);
    },
    setThinking,
  });
  if (!game) return null;

  return (
    <GameView
      state={game}
      mySeat={0}
      thinkingSeat={thinkingSeat}
      error={error}
      onDismissError={clearError}
      onMove={(move) => send(move, SOLO_UID)}
      onNext={() => send(game.phase === 'gameover' ? { kind: 'rematch', seed: randomSeed() } : { kind: 'next', seed: randomSeed() }, SOLO_UID)}
      onLeave={quit}
      leaveLabel="New game"
    />
  );
}

export function SoloRoute() {
  const hasGame = useSoloStore((s) => s.game !== null);
  return hasGame ? <SoloGame /> : <Setup />;
}
