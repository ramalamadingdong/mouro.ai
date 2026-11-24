/** The "On your Wi-Fi" list on the home and join screens. Renders nothing when empty. */
import { useNearbyRooms } from '@/net/nearby';
import './nearby-rooms.css';

export function NearbyRooms({ enabled, onJoin }: { enabled: boolean; onJoin: (code: string) => void }) {
  const rooms = useNearbyRooms(enabled);
  if (rooms.length === 0) return null;
  return (
    <section className="panel nearby" aria-labelledby="nearby-heading">
      <h2 className="panel__heading" id="nearby-heading">
        On your Wi-Fi
      </h2>
      <ul className="nearby__list">
        {rooms.map((room) => (
          <li key={room.code} className="nearby__room">
            <span>
              <strong>{room.name ? `${room.name}’s game` : `Room ${room.code}`}</strong>
              <small>
                {room.players} {room.players === 1 ? 'player' : 'players'}
              </small>
            </span>
            <button type="button" className="btn btn--primary btn--small" onClick={() => onJoin(room.code)}>
              Join
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
