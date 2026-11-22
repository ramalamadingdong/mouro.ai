import { MIN_FAAN_CHOICES, ROUND_CHOICES } from '@/engine';
import { Segmented } from '@/components/segmented';
import { useSettingsStore } from '@/store/settingsStore';

/** Minimum faan and game length. Shared with the lobby. */
export function RuleChoices() {
  const table = useSettingsStore((s) => s.table);
  const setTable = useSettingsStore((s) => s.setTable);
  return (
    <>
      <Segmented
        label="Faan needed to win"
        value={table.minFaan}
        options={MIN_FAAN_CHOICES.map((n) => ({ value: n, label: n === 0 ? 'None' : String(n) }))}
        onChange={(minFaan) => setTable({ minFaan })}
      />
      <Segmented
        label="Length"
        value={table.rounds}
        options={ROUND_CHOICES.map((n) => ({ value: n, label: n === 1 ? 'East round' : 'Full game' }))}
        onChange={(rounds) => setTable({ rounds })}
      />
      <p className="field__hint">
        {table.rounds === 1 ? 'At least four hands, about 20–30 minutes.' : 'At least sixteen hands, a long evening.'}{' '}
        {table.minFaan === 0 ? 'Any complete hand wins.' : `A winning hand needs ${table.minFaan} faan or more.`}
      </p>
    </>
  );
}

