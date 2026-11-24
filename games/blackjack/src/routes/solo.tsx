/**
 * Offline play against the cats: the setup form until a game exists, then the
 * table. The game lives in soloStore (persisted), so this route is also where
 * a refresh lands back in the middle of a hand.
 */
import { useNavigate } from 'react-router-dom';
import { CATS } from '@/ai';
import { Avatar } from '@/components/avatar';
import { DealerPicker } from '@/components/dealer-picker';
import { Segmented } from '@/components/segmented';
import { Table } from '@/components/table';
import { useSoloDriver } from '@/hooks/use-solo-driver';
import { ROUND_CHOICES, STACK_CHOICES, useSettingsStore } from '@/store/settingsStore';
import { SOLO_UID, useSoloStore } from '@/store/soloStore';
import { MAX_NAME_LENGTH } from '@/util/seat';
import { randomSeed } from '@/util/seed';
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
        <h1 className="screen__title">Set up the table</h1>

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

        <div className="field">
          <div className="setup__cats-head">
            <span className="field__label">
              Cats at the table <span className="setup__count">{table.cats.length} of {CATS.length}</span>
            </span>
            <span className="setup__cats-all">
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setTable({ cats: CATS.map((c) => c.id) })}>
                All
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setTable({ cats: [] })}>
                None
              </button>
            </span>
          </div>
          <p className="field__hint">Tap a cat to seat it or send it home. None at all is fine — just you and Duchess.</p>
          <ul className="setup__cats" aria-label="Who is at the table">
            {CATS.map((cat) => {
              const seated = table.cats.includes(cat.id);
              return (
                <li key={cat.id}>
                  <button
                    type="button"
                    className="setup__cat"
                    aria-pressed={seated}
                    data-in={seated ? 'true' : 'false'}
                    onClick={() =>
                      setTable({ cats: seated ? table.cats.filter((id) => id !== cat.id) : [...table.cats, cat.id] })
                    }
                  >
                    <Avatar uid={`cat-${cat.id}`} name={cat.name} />
                    <span className="setup__cat-text">
                      <span>
                        <span className="setup__cat-name">{cat.name}</span>{' '}
                        <span className="setup__cat-style">· {cat.style}</span>
                      </span>
                      <span className="setup__cat-blurb">{cat.blurb}</span>
                    </span>
                    <span className="setup__cat-check" aria-hidden="true">
                      {seated ? '✓' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="field">
          <span className="field__label">Your dealer</span>
          <DealerPicker value={table.dealer} onChange={(dealer) => setTable({ dealer })} />
        </div>

        <Segmented
          label="Starting chips"
          value={table.startingStack}
          options={STACK_CHOICES.map((n) => ({ value: n, label: n.toLocaleString('en-US') }))}
          onChange={(startingStack) => setTable({ startingStack })}
        />
        <Segmented
          label="Rounds"
          value={table.rounds}
          options={ROUND_CHOICES.map((n) => ({ value: n, label: String(n) }))}
          onChange={(rounds) => setTable({ rounds })}
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

function SoloTable() {
  // Mounted only while a game exists, so the driver's timers start and stop
  // with the table itself.
  useSoloDriver();
  const game = useSoloStore((s) => s.game);
  const thinkingSeat = useSoloStore((s) => s.thinkingSeat);
  const skipAhead = useSoloStore((s) => s.skipAhead);
  const error = useSoloStore((s) => s.error);
  const send = useSoloStore((s) => s.send);
  const setSkipAhead = useSoloStore((s) => s.setSkipAhead);
  const clearError = useSoloStore((s) => s.clearError);
  const quit = useSoloStore((s) => s.quit);
  if (!game) return null;

  return (
    <Table
      state={game}
      mySeat={0}
      thinkingSeat={thinkingSeat}
      error={error}
      onDismissError={clearError}
      onSkipAhead={skipAhead ? null : () => setSkipAhead(true)}
      onMove={(move) => send(move, SOLO_UID)}
      onDeal={() => send({ kind: 'deal', seed: randomSeed() }, SOLO_UID)}
      onRematch={() => send({ kind: 'rematch', seed: randomSeed() }, SOLO_UID)}
      // Back to the setup form, not the home screen: "new game" is the usual
      // reason to leave a table of cats.
      onLeave={quit}
      leaveLabel="Leave table"
    />
  );
}

export function SoloRoute() {
  const hasGame = useSoloStore((s) => s.game !== null);
  return hasGame ? <SoloTable /> : <Setup />;
}
