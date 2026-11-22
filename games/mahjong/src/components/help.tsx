/**
 * The reference: "How to play" for the ruleset at hand, an illustrated tile
 * guide, and the scoring (Riichi's yaku list with example hands, or Hong
 * Kong's faan). A modal with tabs, reachable from every screen. The guided
 * lessons live at /learn.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LIMIT_FAAN, t, type Ruleset } from '@/engine';
import { Modal } from '@/components/modal';
import { TileRow } from '@/components/tile';
import './help.css';

type Tab = 'rules' | 'tiles' | 'scoring';

function Hand({ notation }: { notation: string }) {
  return (
    <span className="help__hand">
      <TileRow tiles={t(notation)} size="xs" />
    </span>
  );
}

function RiichiRules() {
  return (
    <>
      <p>
        Japanese mahjong for four (or two heads-up), 136 tiles, no flowers. Make a hand of <strong>four sets and a pair</strong>{' '}
        — 14 tiles — that has at least one <strong>yaku</strong> (a scoring pattern). Everyone starts on 25,000 points.
      </p>
      <h3 className="help__heading">Sets</h3>
      <ul className="help__tips">
        <li>
          <strong>Chi</strong> — a run of three in one suit <Hand notation="345p" />
        </li>
        <li>
          <strong>Pon</strong> — three the same <Hand notation="777z" />
        </li>
        <li>
          <strong>Kan</strong> — four the same; you draw a replacement and a new dora is turned over.
        </li>
      </ul>
      <h3 className="help__heading">A turn</h3>
      <p>
        You draw a tile, then throw one: tap it, then tap it again. If your 14 tiles make a winning hand with a yaku, press{' '}
        <strong>Tsumo!</strong>
      </p>
      <h3 className="help__heading">Calling a thrown tile</h3>
      <ul className="help__tips">
        <li>
          <strong>Ron</strong> — it completes your hand. Beats every other call.
        </li>
        <li>
          <strong>Pon / Kan</strong> — anyone holding two (or three) of it.
        </li>
        <li>
          <strong>Chi</strong> — only the player after the one who threw it.
        </li>
        <li>
          Calling opens your hand: you can no longer riichi, and many yaku are lost or worth less. You are only asked when you
          could call.
        </li>
      </ul>
      <h3 className="help__heading">Riichi</h3>
      <p>
        With a <strong>closed</strong> hand (no calls) that is one tile from winning, you may declare <strong>riichi</strong>{' '}
        as you throw: put down a 1,000-point stick and from then on throw every tile you draw unless it wins. Riichi is a yaku
        by itself, so it is the easy way to make any closed hand winnable — and winning within a turn adds{' '}
        <strong>ippatsu</strong>, and the hidden <strong>ura dora</strong> are turned over.
      </p>
      <h3 className="help__heading">Furiten</h3>
      <p>
        If a tile you are waiting on is in <strong>your own</strong> discards, or you let one go by since your last throw, you
        cannot win by Ron — only by drawing it yourself (Tsumo). The game warns you.
      </p>
      <h3 className="help__heading">Dora</h3>
      <p>
        The tile shown by the dead wall is the dora <em>indicator</em>; the <strong>next</strong> tile in order is the dora{' '}
        <Hand notation="4m" /> → <Hand notation="5m" />. Each dora in your winning hand adds a han — but dora are not a yaku.
      </p>
      <h3 className="help__heading">The deal</h3>
      <p>
        The dealer (East) scores 1.5× and keeps the deal on a win or when ready at a draw. When the wall runs out, players who
        were not ready pay those who were. A short game is the East round; a full one adds the South round. It ends early if
        anyone drops below zero.
      </p>
      <h3 className="help__heading">Two players</h3>
      <p>
        Heads-up uses the full rules: your opponent is the only one who can throw to you, so you may Chi every tile they
        throw. A win by Tsumo is paid in full by your opponent.
      </p>
    </>
  );
}

function HkRules() {
  return (
    <>
      <p>
        Hong Kong mahjong for four (or two heads-up), 144 tiles. Make a hand of <strong>four sets and a pair</strong>: 14
        tiles. A set is a <strong>chow</strong> (a run of three in one suit, <Hand notation="345p" />
        ), a <strong>pung</strong> (three the same, <Hand notation="777z" />) or a <strong>kong</strong> (four the same).
      </p>
      <h3 className="help__heading">Your turn</h3>
      <p>
        You draw a tile automatically, then throw one: tap it, then tap it again (or use the Throw button). If your 14 tiles
        make a winning hand, press <strong>Mahjong!</strong> Four the same in your hand can be declared as a kong; you then
        draw a replacement.
      </p>
      <h3 className="help__heading">Calling a thrown tile</h3>
      <ul className="help__tips">
        <li>
          <strong>Pung</strong> or <strong>kong</strong>: anyone holding two (or three) of it.
        </li>
        <li>
          <strong>Chow</strong>: only the next player after the one who threw it.
        </li>
        <li>
          <strong>Mahjong</strong> beats every other call. Called sets go face up on the table.
        </li>
      </ul>
      <h3 className="help__heading">Flowers and seasons</h3>
      <p>
        The eight bonus tiles <Hand notation="1f1y" /> are set aside as soon as they arrive and replaced. Your own flower and
        season (East 1, South 2, West 3, North 4) each score a faan.
      </p>
      <h3 className="help__heading">The deal</h3>
      <p>
        The dealer is East. If the dealer wins, or the hand is a draw, they deal again; otherwise the deal passes on. The East
        round is one trip round the table; a full game is four.
      </p>
    </>
  );
}

function TileGuide() {
  return (
    <>
      <p>Three suits of 1–9, four of each tile:</p>
      <dl className="help__tiles">
        <dt>Characters (man)</dt>
        <dd>
          <Hand notation="123456789m" />
        </dd>
        <dt>Dots (pin)</dt>
        <dd>
          <Hand notation="123456789p" />
        </dd>
        <dt>Bamboo (sou) — the 1 is a bird</dt>
        <dd>
          <Hand notation="123456789s" />
        </dd>
      </dl>
      <p>
        <strong>Honours</strong> make no runs, only pons and pairs:
      </p>
      <dl className="help__tiles">
        <dt>Winds: East, South, West, North</dt>
        <dd>
          <Hand notation="1234z" />
        </dd>
        <dt>Dragons: white, green, red</dt>
        <dd>
          <Hand notation="567z" />
        </dd>
      </dl>
      <p>
        <strong>Terminals</strong> are the 1s and 9s; terminals and honours together decide several yaku. The 2–8s are{' '}
        <strong>simples</strong>.
      </p>
      <dl className="help__tiles">
        <dt>Hong Kong only: flowers and seasons</dt>
        <dd>
          <Hand notation="1234f1234y" />
        </dd>
      </dl>
    </>
  );
}

interface Yaku {
  name: string;
  han: string;
  what: string;
  example?: string;
}

const YAKU: Yaku[] = [
  { name: 'Riichi', han: '1', what: 'Declare riichi with a closed, ready hand.' },
  { name: 'Menzen tsumo', han: '1', what: 'Win on your own draw with a closed hand.' },
  { name: 'Ippatsu', han: '1', what: 'Win within one go-round of riichi, with no calls in between.' },
  { name: 'Tanyao (all simples)', han: '1', what: 'No 1s, 9s or honours anywhere.', example: '234m 567p 345s 678s 55p' },
  { name: 'Pinfu', han: '1', what: 'Closed, four runs, a non-scoring pair, won on a two-sided wait (here 2 or 5 bamboo).', example: '123m 456m 789p 99p 34s' },
  { name: 'Yakuhai', han: '1 each', what: 'A pon of dragons, your seat wind or the round wind.', example: '777z' },
  { name: 'Iipeikou', han: '1', what: 'Closed: two identical runs.', example: '223344m' },
  { name: 'Haitei / Houtei', han: '1', what: 'Win on the very last tile, drawn or thrown.' },
  { name: 'Rinshan kaihou', han: '1', what: 'Win on the replacement tile after a kan.' },
  { name: 'Chankan', han: '1', what: 'Win on the tile someone adds to make a kan.' },
  { name: 'Double riichi', han: '2', what: 'Riichi on your very first throw.' },
  { name: 'Chiitoitsu (seven pairs)', han: '2', what: 'Seven different pairs. Always 25 fu.', example: '11m 33m 55p 77p 22s 88s 11z' },
  { name: 'Toitoi', han: '2', what: 'Four pons (or kans) and a pair.', example: '111m 999p 444s 222z 55z' },
  { name: 'Sanankou', han: '2', what: 'Three pons you did not call.' },
  { name: 'Sanshoku doujun', han: '2 (1 open)', what: 'The same run in all three suits.', example: '123m 123p 123s' },
  { name: 'Ittsu', han: '2 (1 open)', what: '1-2-3, 4-5-6, 7-8-9 in one suit.', example: '123456789s' },
  { name: 'Chanta', han: '2 (1 open)', what: 'Every set and the pair has a terminal or honour.', example: '123m 789p 111z 999s 99m' },
  { name: 'Sanshoku doukou', han: '2', what: 'The same pon in all three suits.' },
  { name: 'Sankantsu', han: '2', what: 'Three kans.' },
  { name: 'Honroutou', han: '2', what: 'Only terminals and honours.' },
  { name: 'Shousangen', han: '2', what: 'Two dragon pons and a dragon pair.' },
  { name: 'Honitsu (half flush)', han: '3 (2 open)', what: 'One suit plus honours.', example: '123456m 789m 111z 55z' },
  { name: 'Junchan', han: '3 (2 open)', what: 'Every set and the pair has a 1 or 9; no honours.' },
  { name: 'Ryanpeikou', han: '3', what: 'Closed: two pairs of identical runs.' },
  { name: 'Chinitsu (full flush)', han: '6 (5 open)', what: 'One suit only.', example: '11123455678999p' },
  { name: 'Yakuman', han: 'limit', what: 'Kokushi (thirteen orphans), suuankou, daisangen, shousuushii, daisuushii, tsuuiisou, chinroutou, ryuuiisou, chuuren poutou, suukantsu, tenhou, chiihou.' },
];

function RiichiScoring() {
  return (
    <>
      <p>
        A winning hand needs <strong>at least one yaku</strong>. Its value is <strong>han</strong> (yaku + dora) and{' '}
        <strong>fu</strong> (points for the shape: closed sets, pairs of scoring tiles, awkward waits, closed Ron, Tsumo — 30
        fu is typical). The game adds it all up for you.
      </p>
      <table className="help__table">
        <thead>
          <tr>
            <th>Yaku</th>
            <th>Han</th>
          </tr>
        </thead>
        <tbody>
          {YAKU.map((y) => (
            <tr key={y.name}>
              <td>
                <strong>{y.name}</strong>
                <br />
                {y.what}
                {y.example && (
                  <>
                    <br />
                    <Hand notation={y.example} />
                  </>
                )}
              </td>
              <td>{y.han}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="help__heading">Limits</h3>
      <ul className="help__tips">
        <li>5 han (or 4 han 40 fu, 3 han 70 fu): Mangan — 8,000 (dealer 12,000)</li>
        <li>6–7 han: Haneman — 12,000 (18,000)</li>
        <li>8–10 han: Baiman — 16,000 (24,000)</li>
        <li>11–12 han: Sanbaiman — 24,000 (36,000)</li>
        <li>13+ han or a yakuman: 32,000 (48,000)</li>
      </ul>
      <p>
        On a Ron the thrower pays it all. On a Tsumo everyone pays a share (the dealer pays double). Each honba adds 300; riichi
        sticks on the table go to the next winner.
      </p>
    </>
  );
}

function HkScoring() {
  return (
    <>
      <p>
        A winning hand scores <strong>faan</strong>; the table can ask for a minimum. Some of them:
      </p>
      <ul className="help__tips">
        <li>Self-drawn, concealed hand (no calls), no flowers, all chows: 1 each</li>
        <li>Pung of dragons, of your seat wind, or of the round wind: 1 each</li>
        <li>Own flower, own season: 1 each; all four flowers or seasons: 2</li>
        <li>All pungs 3, mixed one suit (one suit + honours) 3, pure one suit 7</li>
        <li>Small three dragons 5</li>
        <li>
          Great three dragons, great four winds, all honours, thirteen orphans, four concealed pungs, four kongs: the limit (
          {LIMIT_FAAN})
        </li>
      </ul>
      <p>
        A thrown winning tile is paid double by whoever threw it and single by the others; a self-drawn win is paid double by
        all. When the wall runs out the hand is a draw.
      </p>
    </>
  );
}

export function HelpModal({ open, onClose, ruleset = 'riichi' }: { open: boolean; onClose: () => void; ruleset?: Ruleset }) {
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<Ruleset>(ruleset);
  return (
    <Modal open={open} title="How to play" onClose={onClose}>
      <div className="help">
        <div className="help__switch" role="tablist" aria-label="Rules">
          {(['riichi', 'hk'] as const).map((r) => (
            <button key={r} type="button" role="tab" aria-selected={rules === r} onClick={() => setRules(r)}>
              {r === 'riichi' ? 'Japanese' : 'Hong Kong'}
            </button>
          ))}
        </div>
        <div className="help__tabs" role="tablist" aria-label="Section">
          {(
            [
              ['rules', 'Rules'],
              ['tiles', 'Tiles'],
              ['scoring', rules === 'riichi' ? 'Yaku & scoring' : 'Scoring'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'rules' && (rules === 'riichi' ? <RiichiRules /> : <HkRules />)}
        {tab === 'tiles' && <TileGuide />}
        {tab === 'scoring' && (rules === 'riichi' ? <RiichiScoring /> : <HkScoring />)}
        <p className="help__learn">
          New to mahjong?{' '}
          <Link to="/learn" onClick={onClose}>
            Take the guided lessons
          </Link>{' '}
          — about ten minutes, with practice hands.
        </p>
      </div>
    </Modal>
  );
}
