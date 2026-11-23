/**
 * Seat avatars. The cats (and Duchess, the dealer) are inline SVG faces in
 * each cat's colouring; human players in online rooms get
 * their initial on a brass disc. No external images, no emoji.
 */
import './avatar.css';

interface Coat {
  fur: string;
  /** Inner ear and nose. */
  pink: string;
  eye: string;
}

const COATS: Record<string, Coat> = {
  shadow: { fur: '#26242b', pink: '#8a5a66', eye: '#e3c64a' },
  marmalade: { fur: '#e2913f', pink: '#f3b6a6', eye: '#5f8f3a' },
  tiger: { fur: '#8f9299', pink: '#e7a9a3', eye: '#d9a53a' },
  professor: { fur: '#2a282d', pink: '#e9a7a7', eye: '#7fb069' },
  patches: { fur: '#f6efe2', pink: '#f0a9a4', eye: '#b98a3a' },
  smokey: { fur: '#6f7b8b', pink: '#c99aa3', eye: '#a6cf5f' },
  biscuit: { fur: '#efe3c9', pink: '#b98679', eye: '#6aa9e0' },
  duchess: { fur: '#fbf8f2', pink: '#f2b3b0', eye: '#4f8fd6' },
};

/** Markings drawn over the base head, under the face. All clipped to the head. */
function Markings({ id }: { id: string }) {
  switch (id) {
    case 'marmalade':
      // Tabby "M" and cheek stripes, a shade darker than the coat.
      return (
        <g stroke="#b4662a" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M26 20v7M32 18v9M38 20v7" />
          <path d="M11 34l7 2M11 41l7-1M53 34l-7 2M53 41l-7-1" />
        </g>
      );
    case 'tiger':
      return (
        <g stroke="#565a62" strokeWidth="2.6" strokeLinecap="round" fill="none">
          <path d="M26 20v7M32 18v9M38 20v7" />
          <path d="M11 33l7 2M11 40l7-1M53 33l-7 2M53 40l-7-1" />
        </g>
      );
    case 'professor':
      // Tuxedo: white blaze up the nose, white muzzle and chin.
      return (
        <g fill="#f6f1e7">
          <path d="M32 24c3 4 4 9 4 13h-8c0-4 1-9 4-13z" />
          <ellipse cx="32" cy="46" rx="11.5" ry="9" />
        </g>
      );
    case 'patches':
      // Calico: one orange patch, one black, over a white coat.
      return (
        <g>
          <path fill="#dd8a3a" d="M8 44C6 30 12 20 22 16l8 4c2 8-1 17-8 22-5 3-10 4-14 2z" />
          <path fill="#2b2930" d="M56 40c1-12-4-21-13-24l-6 5c-1 7 3 14 9 18 4 2 7 2 10 1z" />
        </g>
      );
    case 'biscuit':
      // Colourpoint: a dark mask over the muzzle.
      return <ellipse fill="#6b4f3d" cx="32" cy="45" rx="13" ry="10.5" />;
    default:
      return null;
  }
}

function CatFace({ id }: { id: string }) {
  const coat = COATS[id] ?? COATS.tiger;
  const clip = `cat-head-${id}`;
  // Ears take the colour of the patch on their side for the calico.
  const leftEar = id === 'patches' ? '#dd8a3a' : id === 'biscuit' ? '#6b4f3d' : coat.fur;
  const rightEar = id === 'patches' ? '#2b2930' : id === 'biscuit' ? '#6b4f3d' : coat.fur;
  return (
    <svg className="avatar__art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          <ellipse cx="32" cy="38" rx="24" ry="20" />
        </clipPath>
      </defs>
      <path fill={leftEar} d="M9 30 12 6l17 13z" />
      <path fill={rightEar} d="M55 30 52 6 35 19z" />
      <path fill={coat.pink} d="M14.5 22 16 11.500l8 9z" />
      <path fill={coat.pink} d="M49.5 22 48 11.500l-8 9z" />
      <ellipse cx="32" cy="38" rx="24" ry="20" fill={coat.fur} />
      <g clipPath={`url(#${clip})`}>
        <Markings id={id} />
      </g>
      {/* Eyes: coloured iris, slit pupil, a catch-light. */}
      <ellipse cx="22.5" cy="36" rx="4.8" ry="5.4" fill={coat.eye} />
      <ellipse cx="41.5" cy="36" rx="4.8" ry="5.4" fill={coat.eye} />
      <ellipse cx="22.5" cy="36" rx="1.7" ry="4.4" fill="#141216" />
      <ellipse cx="41.5" cy="36" rx="1.7" ry="4.4" fill="#141216" />
      <circle cx="24" cy="34" r="1.1" fill="#fff" />
      <circle cx="43" cy="34" r="1.1" fill="#fff" />
      <path fill={coat.pink} d="M29 43.500h6l-3 3.600z" />
      <path
        d="M32 47v2.500m0 0c-1.5 2-4 2-5.5.5m5.5-.5c1.5 2 4 2 5.5.5"
        stroke={id === 'shadow' ? '#6d6875' : '#3a2b25'}
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
      <g stroke={id === 'shadow' ? '#8d8894' : '#fff8'} strokeWidth="0.9" strokeLinecap="round">
        <path d="M20 46 8 44M20 48.5 9 50M44 46l12-2M44 48.5 55 50" />
      </g>
      {id === 'duchess' && (
        // The dealer's green eyeshade.
        <g>
          <path fill="#1f7a4d" d="M10 27c6-6 14-9 22-9s16 3 22 9l-3 3c-5-4-12-6-19-6s-14 2-19 6z" />
          <path fill="#2fa36a" d="M12 26.5c5-4.5 12-7 20-7s15 2.5 20 7" opacity="0.6" />
        </g>
      )}
      {id === 'professor' && (
        // Round wire spectacles.
        <g stroke="#d9b45a" strokeWidth="1.7" fill="rgb(255 255 255 / 0.12)">
          <circle cx="22.5" cy="36" r="7.2" />
          <circle cx="41.5" cy="36" r="7.2" />
          <path d="M29.7 36h4.600M15.3 35 9 32M48.7 35 55 32" fill="none" />
        </g>
      )}
    </svg>
  );
}

export interface AvatarProps {
  /** Player uid: `cat-<id>` draws that cat, anything else draws initials. */
  uid: string;
  name: string;
}

export function Avatar({ uid, name }: AvatarProps) {
  if (uid.startsWith('cat-')) {
    return (
      <span className="avatar avatar--cat">
        <CatFace id={uid.slice(4)} />
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
