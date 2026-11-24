/**
 * The dealers as a row of cards: tap one to choose it. Solo, that is your
 * pick; in the lobby it is your vote, and each card shows who voted for it.
 */
import { Avatar } from '@/components/avatar';
import { DEALERS } from '@/dealers';
import './dealer-picker.css';

export interface DealerPickerProps {
  value: string | null;
  onChange: (id: string) => void;
  /** Lobby: dealer id → names of the players who voted for it. */
  voters?: Record<string, string[]>;
  /** Lobby: the dealer currently winning the vote. */
  leading?: string | null;
}

export function DealerPicker({ value, onChange, voters, leading }: DealerPickerProps) {
  return (
    <ul className="dealers" role="radiogroup" aria-label="Dealer">
      {DEALERS.map((d) => {
        const names = voters?.[d.id] ?? [];
        return (
          <li key={d.id}>
            <button
              type="button"
              role="radio"
              aria-checked={value === d.id}
              className="dealers__card"
              data-leading={leading === d.id ? 'true' : undefined}
              onClick={() => onChange(d.id)}
            >
              <span className="dealers__avatar">
                <Avatar uid={`cat-${d.id}`} name={d.name} />
              </span>
              <span className="dealers__text">
                <span className="dealers__name">
                  {d.name} <span className="dealers__style">· {d.style}</span>
                </span>
                <span className="dealers__blurb">{d.blurb}</span>
                {voters && (
                  <span className="dealers__votes">
                    {names.length === 0 ? 'No votes' : `${names.length} ${names.length === 1 ? 'vote' : 'votes'}: ${names.join(', ')}`}
                  </span>
                )}
              </span>
              {leading === d.id && <span className="dealers__crown" aria-label="Leading">👑</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
