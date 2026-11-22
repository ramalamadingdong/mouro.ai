import { MIN_FAAN_CHOICES, ROUNDS_FOR, type Ruleset } from '@/engine';
import { Segmented } from '@/components/segmented';
import { useSettingsStore } from '@/store/settingsStore';

const RULESET_LABEL: Record<Ruleset, string> = { riichi: 'Japanese (Riichi)', hk: 'Hong Kong' };

function roundLabel(ruleset: Ruleset, rounds: number): string {
  if (ruleset === 'riichi') return rounds === 1 ? 'East only' : 'East + South';
  return rounds === 1 ? 'East round' : 'Full game';
}

/**
 * Rules, table size and game length. Shared by the solo setup and the lobby.
 * `seatsLocked` hides the 2/4 choice (online, when the number of people decides it).
 */
export function RuleChoices({ seatsNote, seatsLocked = false }: { seatsNote?: string; seatsLocked?: boolean }) {
  const table = useSettingsStore((s) => s.table);
  const setTable = useSettingsStore((s) => s.setTable);
  const hands = table.seats * table.rounds;
  return (
    <>
      <Segmented
        label="Rules"
        value={table.ruleset}
        options={(['riichi', 'hk'] as const).map((r) => ({ value: r, label: RULESET_LABEL[r] }))}
        onChange={(ruleset) => setTable({ ruleset, rounds: 1 })}
      />
      {!seatsLocked && (
        <Segmented
          label="Players"
          value={table.seats}
          options={[
            { value: 4, label: '4 players' },
            { value: 2, label: '2 players' },
          ]}
          onChange={(seats) => setTable({ seats })}
        />
      )}
      {seatsNote && <p className="field__hint">{seatsNote}</p>}
      {table.ruleset === 'hk' && (
        <Segmented
          label="Faan needed to win"
          value={table.minFaan}
          options={MIN_FAAN_CHOICES.map((n) => ({ value: n, label: n === 0 ? 'None' : String(n) }))}
          onChange={(minFaan) => setTable({ minFaan })}
        />
      )}
      <Segmented
        label="Length"
        value={table.rounds}
        options={ROUNDS_FOR[table.ruleset].map((n) => ({ value: n, label: roundLabel(table.ruleset, n) }))}
        onChange={(rounds) => setTable({ rounds })}
      />
      <p className="field__hint">
        At least {hands} hands.{' '}
        {table.ruleset === 'riichi'
          ? 'Everyone starts on 25,000 points; a winning hand needs at least one yaku. The game ends early if anyone drops below zero.'
          : table.minFaan === 0
            ? 'Any complete hand wins.'
            : `A winning hand needs ${table.minFaan} faan or more.`}
      </p>
      <label className="toggle">
        <input type="checkbox" checked={table.coach} onChange={(e) => setTable({ coach: e.target.checked })} />
        <span>
          <strong>Coach</strong> — suggest a move and explain why, while you play
        </span>
      </label>
    </>
  );
}
