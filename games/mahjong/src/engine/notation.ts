/**
 * Standard mahjong shorthand → tile strings, for examples and lessons:
 * digits then a suit letter — `m` characters (man), `p` dots (pin),
 * `s` bamboo (sou), `z` honours (1–4 East South West North, 5 white,
 * 6 green, 7 red dragon), `f` flowers 1–4, `y` seasons 1–4.
 * Spaces are ignored: `t('123m 456p 789s 11z')`.
 */
import { DRAGON_RED, FLOWER_FIRST, SEASON_FIRST, WIND_EAST, tileOf } from './tiles';

const HONOR = [WIND_EAST, WIND_EAST + 1, WIND_EAST + 2, WIND_EAST + 3, DRAGON_RED + 2, DRAGON_RED + 1, DRAGON_RED];

export function t(notation: string): string {
  let out = '';
  let digits: number[] = [];
  for (const ch of notation) {
    if (ch >= '0' && ch <= '9') digits.push(Number(ch));
    else if ('mpszfy'.includes(ch)) {
      for (const d of digits) {
        if (ch === 'm') out += tileOf(d - 1);
        else if (ch === 'p') out += tileOf(8 + d);
        else if (ch === 's') out += tileOf(17 + d);
        else if (ch === 'z') out += tileOf(HONOR[d - 1]);
        else if (ch === 'f') out += tileOf(FLOWER_FIRST + d - 1);
        else out += tileOf(SEASON_FIRST + d - 1);
      }
      digits = [];
    }
  }
  return out;
}
