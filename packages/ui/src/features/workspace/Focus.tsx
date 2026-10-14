import { useEffect, useRef, useState } from 'react';
import type { Envelope } from '@lm/core';
import type { Repository } from '@lm/db';
import { useTranslation, formatNumber } from '@lm/i18n';
import type { FormatSettings } from '@lm/i18n';
import { generateId, titleOf } from './runtime';

export function Focus({
  repo,
  tasks,
  onError,
  onSaved,
  prefs,
  onActiveChange,
}: {
  repo: Repository;
  tasks: Envelope[];
  onError: () => void;
  onSaved: () => void;
  prefs: FormatSettings;
  onActiveChange: (active: boolean) => void;
}) {
  const { t } = useTranslation();
  const [taskId, setTaskId] = useState('');
  const [minutes, setMinutes] = useState(25);
  const [started, setStarted] = useState<number | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(25 * 60);
  const [pauses, setPauses] = useState<{ start: string; end: string }[]>([]);
  const [pauseStart, setPauseStart] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    if (deadline === null) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);
  async function finish() {
    if (started === null || sessionId === null || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const now = Date.now();
      const breaks =
        pauseStart === null
          ? pauses
          : [
              ...pauses,
              { start: new Date(pauseStart).toISOString(), end: new Date(now).toISOString() },
            ];
      await repo.put('focusSession', sessionId, {
        ...(taskId ? { taskId } : {}),
        plannedMin: minutes,
        start: new Date(started).toISOString(),
        end: new Date(now).toISOString(),
        breaks,
        interruptions: breaks.length,
      });
      setStarted(null);
      setDeadline(null);
      setPauseStart(null);
      setPauses([]);
      setRemaining(minutes * 60);
      setSessionId(null);
      onActiveChange(false);
      onSaved();
    } catch {
      onError();
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <section>
      <p>{t('focusHelp')}</p>
      <p className="notice">{t('focusContinuity')}</p>
      {started === null && (
        <div className="fields" style={{ marginBlockStart: 24 }}>
          <label className="field">
            {t('tasks')}
            <select
              aria-label={t('tasks')}
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">{t('focus')}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {titleOf(task)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('minutes')}
            <input
              type="number"
              min={1}
              max={240}
              value={minutes}
              onChange={(event) => {
                const value = Number(event.target.value);
                setMinutes(value);
                setRemaining(value * 60);
              }}
            />
          </label>
        </div>
      )}
      <div className="timer" role="timer" aria-label={t('timerRemaining')}>
        {formatNumber(Math.floor(remaining / 60), prefs)}:
        {formatNumber(remaining % 60, prefs).padStart(2, prefs.digits === 'persian' ? '۰' : '0')}
      </div>
      <div className="form-actions">
        {started === null ? (
          <button
            className="primary"
            disabled={!Number.isInteger(minutes) || minutes < 1 || minutes > 240}
            onClick={() => {
              const now = Date.now();
              setSessionId(generateId(now));
              onActiveChange(true);
              setStarted(now);
              setDeadline(now + minutes * 60000);
            }}
          >
            {t('begin')}
          </button>
        ) : (
          <>
            <button
              disabled={saving}
              onClick={() => {
                if (deadline !== null) {
                  setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
                  setDeadline(null);
                  setPauseStart(Date.now());
                } else {
                  const now = Date.now();
                  if (pauseStart !== null)
                    setPauses([
                      ...pauses,
                      {
                        start: new Date(pauseStart).toISOString(),
                        end: new Date(now).toISOString(),
                      },
                    ]);
                  setPauseStart(null);
                  setDeadline(now + remaining * 1000);
                }
              }}
            >
              {t(deadline === null ? 'resume' : 'pause')}
            </button>
            <button
              className="primary"
              disabled={saving}
              onClick={() => {
                void finish();
              }}
            >
              {t('finish')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
