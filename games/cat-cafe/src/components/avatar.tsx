/**
 * Seat avatars. The computer cats get their face, drawn by the same code that
 * draws the cats on the floor; human players get their initial on a disc in
 * their seat colour. No external images, no emoji.
 */
import { catById } from '@/ai';
import { face } from '@/components/draw';
import './avatar.css';

export interface AvatarProps {
  /** Player uid: `cat-<id>` draws that cat, anything else draws initials. */
  uid: string;
  name: string;
}

export function Avatar({ uid, name }: AvatarProps) {
  const cat = uid.startsWith('cat-') ? catById(uid.slice(4)) : undefined;
  if (cat) {
    return (
      <span className="avatar avatar--cat">
        <svg
          className="avatar__art"
          viewBox="10 6 80 80"
          aria-hidden="true"
          focusable="false"
          dangerouslySetInnerHTML={{ __html: face(50, 46, cat.coat, 'awake') }}
        />
      </span>
    );
  }
  // First visible character, by code point so an emoji or accent is not halved.
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  return (
    <span className="avatar avatar--human" aria-hidden="true">
      {initial}
    </span>
  );
}
