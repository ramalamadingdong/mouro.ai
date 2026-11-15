/**
 * Offline play against the cats: the setup form until a game exists, then the
 * board. The game lives in soloStore (persisted), so this route is also where
 * a refresh lands back in the middle of a game.
 */
import { useNavigate } from 'react-router-dom';
import { CATS, CAT_UID_PREFIX } from '@/ai';
import { SIZE_CHOICES } from '@/engine';
import { Avatar } from '@/components/avatar';
import { GameView } from '@/components/game-view';
import { Segmented } from '@/components/segmented';
import { useSoloDriver } from '@/hooks/use-solo-driver';
import { OPPONENT_CHOICES, useSettingsStore } from '@/store/settingsStore';
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

        <Segmented
          label="Cats"
          value={table.opponents}
          options={OPPONENT_CHOICES.map((n) => ({ value: n, label: String(n) }))}
          onChange={(opponents) => setTable({ opponents })}
        />

        <ul className="setup__cats" aria-label="Who is playing">
          {CATS.map((cat, i) => (
            <li key={cat.id} className="setup__cat" data-in={i < table.opponents ? 'true' : 'false'}>
              <Avatar uid={`${CAT_UID_PREFIX}${cat.id}`} name={cat.name} />
              <span className="setup__cat-text">
                <span className="setup__cat-name">{cat.name}</span>
                <span className="setup__cat-blurb">{cat.blurb}</span>
              </span>
            </li>
          ))}
        </ul>

        <Segmented
          label="Quilt"
          value={table.size}
          options={SIZE_CHOICES.map((n) => ({ value: n, label: `${n}×${n}` }))}
          onChange={(size) => setTable({ size })}
        />
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
  // Mounted only while a game exists, so the driver's timers start and stop
  // with the board itself.
  useSoloDriver();
  const game = useSoloStore((s) => s.game);
  const thinkingSeat = useSoloStore((s) => s.thinkingSeat);
  const error = useSoloStore((s) => s.error);
  const send = useSoloStore((s) => s.send);
  const clearError = useSoloStore((s) => s.clearError);
  const quit = useSoloStore((s) => s.quit);
  if (!game) return null;

  return (
    <GameView
      state={game}
      mySeat={0}
      thinkingSeat={thinkingSeat}
      error={error}
      onDismissError={clearError}
      onPaw={(cell) => send({ kind: 'paw', cell }, SOLO_UID)}
      onRematch={() => send({ kind: 'rematch' }, SOLO_UID)}
      // Back to the setup form: "a different board" is the usual reason to leave.
      onLeave={quit}
      leaveLabel="New game"
    />
  );
}

export function SoloRoute() {
  const hasGame = useSoloStore((s) => s.game !== null);
  return hasGame ? <SoloGame /> : <Setup />;
}
