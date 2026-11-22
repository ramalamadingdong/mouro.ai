/**
 * Guided lessons: short steps that explain one idea, then ask you to tap a
 * tile or pick an answer, with feedback either way. Japanese rules first
 * (they are the ones this app defaults to), Hong Kong's differences last,
 * then a practice game against easy cats with the coach on.
 *
 * The lessons themselves are data in `src/learn/lessons.tsx`.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, tileName } from '@/engine';
import { Tile } from '@/components/tile';
import { LESSONS, type Step } from '@/learn/lessons';
import { useSettingsStore } from '@/store/settingsStore';
import { useSoloStore } from '@/store/soloStore';
import './screen.css';
import './learn.css';

function StepView({ step, onDone }: { step: Step; onDone: () => void }) {
  const [answer, setAnswer] = useState<{ right: boolean; text: string } | null>(null);
  const [tapped, setTapped] = useState<number | null>(null);

  if (step.kind === 'read') {
    return (
      <div className="learn__step">
        <div className="learn__body">{step.body}</div>
        <button type="button" className="btn btn--primary btn--block" onClick={onDone}>
          Next
        </button>
      </div>
    );
  }

  const solved = answer?.right === true;
  return (
    <div className="learn__step">
      <div className="learn__prompt">{step.prompt}</div>
      {step.kind === 'pick' ? (
        <div className="learn__tiles" role="group" aria-label="Tap a tile">
          {Array.from(t(step.tiles)).map((tile, i) => (
            <button
              key={i}
              type="button"
              className="learn__tile"
              data-state={tapped === i ? (answer?.right ? 'right' : 'wrong') : undefined}
              disabled={solved}
              aria-label={tileName(tile)}
              onClick={() => {
                setTapped(i);
                const right = step.right(tile);
                setAnswer({ right, text: right ? step.why : step.hint(tile) });
              }}
            >
              <Tile tile={tile} size="lg" />
            </button>
          ))}
        </div>
      ) : (
        <div className="learn__options">
          {step.options.map((o, i) => (
            <button
              key={i}
              type="button"
              className="btn btn--secondary btn--block"
              data-state={tapped === i ? (o.right ? 'right' : 'wrong') : undefined}
              disabled={solved}
              onClick={() => {
                setTapped(i);
                setAnswer({ right: o.right, text: o.why });
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {answer && (
        <p className={`notice ${answer.right ? 'notice--good' : 'notice--bad'} learn__feedback`} role="status">
          <strong>{answer.right ? 'Yes! ' : 'Not quite. '}</strong>
          {answer.text}
        </p>
      )}
      <button type="button" className="btn btn--primary btn--block" disabled={!solved} onClick={onDone}>
        Next
      </button>
    </div>
  );
}

export function LearnRoute() {
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const setTable = useSettingsStore((s) => s.setTable);
  const playerName = useSettingsStore((s) => s.playerName);
  const start = useSoloStore((s) => s.start);

  function practice(): void {
    setTable({ ruleset: 'riichi', seats: 4, rounds: 1, difficulty: 'easy', coach: true });
    start(playerName, useSettingsStore.getState().table);
    navigate('/solo');
  }

  if (lesson === null) {
    return (
      <main className="screen">
        <div className="screen__inner learn">
          <h1 className="screen__title">Learn to play</h1>
          <p className="screen__subtitle">
            Eight short lessons with practice questions, then a game against easy cats with the coach helping you.
          </p>
          <ol className="learn__list">
            {LESSONS.map((l, i) => (
              <li key={l.title}>
                <button
                  type="button"
                  className="btn btn--secondary btn--block learn__item"
                  onClick={() => {
                    setLesson(i);
                    setStep(0);
                  }}
                >
                  <span className="learn__num">{i + 1}</span>
                  {l.title}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn--primary btn--block" onClick={practice}>
            Practice game with the coach
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate('/')}>
            Back
          </button>
        </div>
      </main>
    );
  }

  const current = LESSONS[lesson];
  const last = step === current.steps.length - 1;
  return (
    <main className="screen">
      <div className="screen__inner learn">
        <header className="learn__head">
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setLesson(null)}>
            All lessons
          </button>
          <span className="learn__progress" aria-label={`Step ${step + 1} of ${current.steps.length}`}>
            {current.steps.map((_, i) => (
              <span key={i} data-done={i <= step ? 'true' : 'false'} />
            ))}
          </span>
        </header>
        <h1 className="screen__title">
          {lesson + 1}. {current.title}
        </h1>
        <StepView
          key={`${lesson}-${step}`}
          step={current.steps[step]}
          onDone={() => {
            if (!last) setStep(step + 1);
            else if (lesson + 1 < LESSONS.length) {
              setLesson(lesson + 1);
              setStep(0);
            } else setLesson(null);
          }}
        />
        {last && lesson + 1 === LESSONS.length && (
          <button type="button" className="btn btn--secondary btn--block" onClick={practice}>
            Finish with a practice game
          </button>
        )}
      </div>
    </main>
  );
}
