import { useEffect, useRef, useState } from 'react';
import {
  Inbox,
  CheckSquare,
  CalendarDays,
  Circle,
  Timer,
  Wallet,
  Heart,
  FileText,
  Users,
  BookOpen,
  House,
  Target,
  Settings,
  Sun,
  Plus,
  Search,
  Pencil,
  Trash2,
  Check,
  ArrowUpRight,
  Folder,
  Leaf,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Envelope } from '@lm/core';
import { createRepository, createWebDriver } from '@lm/db';
import type { Repository } from '@lm/db';
import i18n, {
  useTranslation,
  formatDate,
  formatNumber,
  formatMoney,
  localDateAt,
  formatInstant,
} from '@lm/i18n';
import type { FormatSettings } from '@lm/i18n';
import { modules } from '../features/workspace/modules';
import type { Module } from '../features/workspace/modules';
import { Editor } from '../features/workspace/Editor';
import { Focus } from '../features/workspace/Focus';
import { generateId, text, titleOf } from '../features/workspace/runtime';
import '../theme/tokens.css';
interface Preferences extends FormatSettings {
  theme: 'system' | 'light' | 'dark';
}
const defaultPreferences: Preferences = {
  language: 'en',
  calendar: 'gregorian',
  digits: 'latin',
  theme: 'system',
};
function preferences(): Preferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('lm.preferences') ?? '{}');
    if (value && typeof value === 'object') {
      const saved = value as Record<string, unknown>;
      return {
        language: saved.language === 'fa' ? 'fa' : 'en',
        calendar: saved.calendar === 'jalali' ? 'jalali' : 'gregorian',
        digits: saved.digits === 'persian' ? 'persian' : 'latin',
        theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : 'system',
      };
    }
  } catch {
    return defaultPreferences;
  }
  return defaultPreferences;
}

let workspace: Promise<Repository> | undefined;
function openWorkspace(): Promise<Repository> {
  workspace ??= (async () => {
    const deviceId = localStorage.getItem('lm.deviceId') ?? generateId(Date.now());
    localStorage.setItem('lm.deviceId', deviceId);
    return createRepository(await createWebDriver(), { deviceId, now: Date.now });
  })();
  return workspace;
}
const navigation: { key: string; icon: LucideIcon }[] = [
  { key: 'today', icon: Sun },
  { key: 'inbox', icon: Inbox },
  { key: 'tasks', icon: CheckSquare },
  { key: 'projects', icon: Folder },
  { key: 'planner', icon: CalendarDays },
  { key: 'habits', icon: Circle },
  { key: 'focus', icon: Timer },
  { key: 'money', icon: Wallet },
  { key: 'health', icon: Heart },
  { key: 'notes', icon: FileText },
  { key: 'people', icon: Users },
  { key: 'library', icon: BookOpen },
  { key: 'admin', icon: House },
  { key: 'goals', icon: Target },
  { key: 'settings', icon: Settings },
];

export function App({
  initialPreferences,
  repository,
}: { initialPreferences?: Preferences; repository?: Repository } = {}) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState(initialPreferences ?? preferences);
  const [started, setStarted] = useState(
    () => Boolean(repository) || localStorage.getItem('lm.started') === 'true',
  );
  const [repo, setRepo] = useState<Repository | null>(repository ?? null);
  const [records, setRecords] = useState<Envelope[]>([]);
  const [storageFailed, setStorageFailed] = useState(false);
  const [page, setPage] = useState('today');
  const [query, setQuery] = useState('');
  const [capture, setCapture] = useState('');
  const [editor, setEditor] = useState<{ module: Module; record?: Envelope } | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ key: string; deletedId?: string } | null>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [today, setToday] = useState(() => localDateAt(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setToday(localDateAt(Date.now())), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    void i18n.changeLanguage(prefs.language);
    document.documentElement.lang = prefs.language;
    document.documentElement.dir = prefs.language === 'fa' ? 'rtl' : 'ltr';
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        prefs.theme === 'system' ? (media.matches ? 'dark' : 'light') : prefs.theme;
    };
    apply();
    media.addEventListener('change', apply);
    localStorage.setItem('lm.preferences', JSON.stringify(prefs));
    return () => media.removeEventListener('change', apply);
  }, [prefs]);
  useEffect(() => {
    if (!started) return;
    let alive = true,
      unsubscribe: (() => void) | undefined;
    void (repository ? Promise.resolve(repository) : openWorkspace())
      .then((opened) => {
        if (!alive) return;
        setRepo(opened);
        const refresh = () => {
          void opened
            .list()
            .then((rows) => {
              if (alive) setRecords(rows);
            })
            .catch(() => {
              if (alive) setError('storageError');
            });
        };
        unsubscribe = opened.subscribe(refresh);
        refresh();
      })
      .catch(() => {
        if (alive) setStorageFailed(true);
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [started, repository]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPage('inbox');
        captureRef.current?.focus();
      }
      if (event.key === 'Escape') setEditor(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  async function action(run: () => Promise<unknown>) {
    setError('');
    try {
      await run();
    } catch {
      setError('error');
    }
  }
  async function quickCapture(event: React.FormEvent) {
    event.preventDefault();
    if (!repo || !capture.trim()) return;
    await action(async () => {
      await repo.put('inboxItem', generateId(Date.now()), {
        text: capture.trim(),
        source: 'quick',
        transcriptStatus: 'none',
      });
      setCapture('');
    });
  }
  const tasks = records.filter(
    (record) => record.type === 'task' && !['done', 'cancelled'].includes(text(record, 'status')),
  );
  const moneyRecords = records.filter((record) => record.type === 'account');
  const module = modules[page];
  const visible = records
    .filter((record) =>
      module
        ? record.type === module.type
        : page === 'today'
          ? record.type === 'task' &&
            text(record, 'status') !== 'done' &&
            text(record, 'status') !== 'cancelled' &&
            (!record.data.dueDate || text(record, 'dueDate') <= today)
          : false,
    )
    .filter((record) =>
      JSON.stringify(record.data).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
  async function complete(record: Envelope) {
    if (!repo) return;
    await action(async () => {
      if (record.type === 'task') {
        const reopening = text(record, 'status') === 'done';
        const data = { ...record.data, status: reopening ? 'todo' : 'done' };
        await repo.put(
          'task',
          record.id,
          reopening
            ? Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'completedAt'))
            : { ...data, completedAt: new Date(Date.now()).toISOString() },
          reopening ? ['completedAt'] : [],
        );
      } else if (record.type === 'inboxItem') {
        const task = modules.tasks;
        if (!task) return;
        await repo.put('task', generateId(Date.now()), {
          ...task.initial(today),
          title: text(record, 'text'),
        });
        await repo.remove(record.id);
      } else if (record.type === 'habit') {
        const old = records.find(
          (item) =>
            item.type === 'habitLog' && item.data.habitId === record.id && item.data.date === today,
        );
        if (old) return;
        await repo.put('habitLog', generateId(Date.now()), {
          habitId: record.id,
          date: today,
          value: 1,
        });
      }
    });
  }
  const captureForm = (
    <form
      className="capture"
      onSubmit={(event) => {
        void quickCapture(event);
      }}
    >
      <input
        ref={captureRef}
        aria-label={t('capture')}
        placeholder={t('captureHint')}
        value={capture}
        onChange={(event) => setCapture(event.target.value)}
      />
      <button className="primary button-icon" disabled={!repo || !capture.trim()}>
        <Plus size={18} />
        {t('add')}
      </button>
    </form>
  );
  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <Leaf className="brand-mark" size={24} />
          <h1>{t('app')}</h1>
        </div>
        <nav aria-label={t('app')}>
          {navigation.map(({ key, icon: Icon }) => (
            <button
              key={key}
              aria-current={page === key ? 'page' : undefined}
              onClick={() => {
                setPage(key);
                setEditor(null);
                setQuery('');
                setError('');
              }}
            >
              <Icon size={18} strokeWidth={1.5} />
              {t(key)}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="local-status">
            <span className="status-dot" />
            {t('local')}
          </div>
          <small>{t('version')}</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="date-label">{formatDate(today, prefs)}</div>
          <input
            aria-label={t('search')}
            placeholder={t('search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </header>
        {!started ? (
          <section className="onboarding">
            <Leaf size={36} className="brand-mark" />
            <h2>{t('welcome')}</h2>
            <p>{t('privacyIntro')}</p>
            <p className="notice">{t('backupReminder')}</p>
            <button
              className="primary"
              onClick={() => {
                localStorage.setItem('lm.started', 'true');
                setStarted(true);
              }}
            >
              {t('startLocal')}
            </button>
            <small>{t('syncUnavailable')}</small>
          </section>
        ) : (
          <div className="content">
            <div className="page-header">
              <div>
                <h2>
                  {t(page === 'accounts' ? 'accounts' : page === 'journal' ? 'journal' : page)}
                </h2>
                <p>
                  {t(page === 'today' ? 'overview' : page === 'habits' ? 'habitHelp' : 'tagline')}
                </p>
              </div>
              {module && (
                <button
                  className="primary button-icon"
                  disabled={!repo}
                  onClick={() => setEditor({ module })}
                >
                  <Plus size={18} />
                  {t('add')}
                </button>
              )}
            </div>
            {storageFailed ? (
              <div role="alert" className="notice">
                <p>{t('storageError')}</p>
                <button onClick={() => location.reload()}>{t('retry')}</button>
              </div>
            ) : !repo ? (
              <p role="status">{t('loading')}</p>
            ) : null}
            {error && (
              <p role="alert" className="error">
                {t(error)}
              </p>
            )}
            {(page === 'today' || page === 'inbox') && captureForm}
            {page === 'today' && (
              <>
                <div className="stats">
                  {[
                    ['openTasks', tasks.length],
                    ['captured', records.filter((item) => item.type === 'inboxItem').length],
                    [
                      'habitCount',
                      records.filter((item) => item.type === 'habit' && !item.data.archived).length,
                    ],
                    ['noteCount', records.filter((item) => item.type === 'note').length],
                  ].map(([label, value]) => (
                    <div className="stat" key={String(label)}>
                      <small>{t(String(label))}</small>
                      <strong>{formatNumber(Number(value), prefs)}</strong>
                    </div>
                  ))}
                </div>
                <div className="section-header">
                  <h3>{t('nextSteps')}</h3>
                  <button className="muted-button button-icon" onClick={() => setPage('tasks')}>
                    {t('allTasks')} <ArrowUpRight size={14} />
                  </button>
                </div>
              </>
            )}
            {(page === 'money' || page === 'accounts') && (
              <div className="tabs">
                {['money', 'accounts'].map((key) => (
                  <button
                    key={key}
                    aria-pressed={page === key}
                    onClick={() => {
                      setPage(key);
                      setEditor(null);
                    }}
                  >
                    {t(key === 'money' ? 'transactions' : key)}
                  </button>
                ))}
              </div>
            )}
            {(page === 'health' || page === 'journal') && (
              <div className="tabs">
                {['health', 'journal'].map((key) => (
                  <button
                    key={key}
                    aria-pressed={page === key}
                    onClick={() => {
                      setPage(key);
                      setEditor(null);
                    }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
            {editor && repo && (
              <Editor
                module={editor.module}
                record={editor.record}
                repo={repo}
                accounts={moneyRecords}
                today={today}
                onClose={() => setEditor(null)}
                onError={() => setError('error')}
              />
            )}
            {(module || page === 'today') && (
              <div className="list">
                {visible.length ? (
                  visible.map((record) => (
                    <article className="row" key={record.id}>
                      {record.type === 'task' && (
                        <button
                          className="icon-button"
                          aria-label={t('completed')}
                          aria-pressed={text(record, 'status') === 'done'}
                          onClick={() => {
                            void complete(record);
                          }}
                        >
                          {text(record, 'status') === 'done' ? (
                            <Check size={18} />
                          ) : (
                            <Circle size={18} />
                          )}
                        </button>
                      )}
                      <div className="row-body">
                        <div
                          dir="auto"
                          className={`row-title ${text(record, 'status') === 'done' ? 'done-text' : ''}`}
                        >
                          {record.type === 'healthLog'
                            ? `${t(text(record, 'metric'))} · ${formatNumber(Number(record.data.value), prefs)} ${text(record, 'unit')}`
                            : record.type === 'transaction' &&
                                record.data.amount &&
                                typeof record.data.amount === 'object' &&
                                !Array.isArray(record.data.amount)
                              ? `${titleOf(record)} · ${formatMoney(Number(record.data.amount.amount), String(record.data.amount.currency), prefs)}`
                              : titleOf(record)}
                        </div>
                        {record.type === 'event' && (
                          <small>
                            {formatInstant(text(record, 'start'), prefs)} —{' '}
                            {formatInstant(text(record, 'end'), prefs)}
                          </small>
                        )}
                        {(record.data.dueDate || record.data.date) && (
                          <small>
                            {formatDate(text(record, 'dueDate') || text(record, 'date'), prefs)}
                          </small>
                        )}
                        <p dir="auto" className="row-details">
                          {text(record, 'content') ||
                            text(record, 'body') ||
                            text(record, 'notes') ||
                            text(record, 'why')}
                        </p>
                      </div>
                      <div className="row-actions">
                        {record.type === 'inboxItem' && (
                          <button
                            onClick={() => {
                              void complete(record);
                            }}
                          >
                            {t('convert')}
                          </button>
                        )}
                        {record.type === 'habit' && (
                          <button
                            disabled={records.some(
                              (item) =>
                                item.type === 'habitLog' &&
                                item.data.habitId === record.id &&
                                item.data.date === today,
                            )}
                            onClick={() => {
                              void complete(record);
                            }}
                          >
                            {t(
                              records.some(
                                (item) =>
                                  item.type === 'habitLog' &&
                                  item.data.habitId === record.id &&
                                  item.data.date === today,
                              )
                                ? 'habitLogged'
                                : 'habitDone',
                            )}
                          </button>
                        )}
                        <button
                          className="icon-button muted-button"
                          aria-label={t('edit')}
                          onClick={() => {
                            const selected = module ?? modules.tasks;
                            if (selected) setEditor({ module: selected, record });
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button muted-button"
                          aria-label={t('remove')}
                          onClick={() => {
                            if (repo)
                              void action(async () => {
                                await repo.remove(record.id);
                                setToast({ key: 'deleted', deletedId: record.id });
                              });
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty">
                    <Search size={30} strokeWidth={1.5} />
                    <h3>{t(query ? 'noResults' : 'empty')}</h3>
                    <p>{t('emptyHelp')}</p>
                  </div>
                )}
              </div>
            )}
            {page === 'settings' && (
              <section className="settings-grid">
                {(['language', 'calendar', 'digits', 'theme'] as const).map((key) => (
                  <label className="field" key={key}>
                    {t(key)}
                    <select
                      aria-label={t(key)}
                      value={prefs[key]}
                      onChange={(event) => setPrefs({ ...prefs, [key]: event.target.value })}
                    >
                      {(key === 'language'
                        ? ['en', 'fa']
                        : key === 'calendar'
                          ? ['gregorian', 'jalali']
                          : key === 'digits'
                            ? ['latin', 'persian']
                            : ['system', 'light', 'dark']
                      ).map((value) => (
                        <option key={value} value={value}>
                          {value === 'en'
                            ? t('english')
                            : value === 'fa'
                              ? t('persianLanguage')
                              : t(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="notice">
                  <h3>{t('about')}</h3>
                  <p>{t('localHelp')}</p>
                  <p>{t('syncUnavailable')}</p>
                </div>
                <div>
                  <p className="notice">{t('exportHelp')}</p>
                  <button
                    onClick={() => {
                      if (repo)
                        void action(async () => {
                          const blob = new Blob([await repo.export()], {
                            type: 'application/json',
                          });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `life-manager-${today}.json`;
                          link.click();
                          URL.revokeObjectURL(url);
                        });
                    }}
                  >
                    {t('export')}
                  </button>
                </div>
              </section>
            )}
            {page === 'focus' && repo && (
              <Focus
                repo={repo}
                tasks={tasks}
                onError={() => setError('error')}
                onSaved={() => setToast({ key: 'focusDone' })}
                prefs={prefs}
              />
            )}
          </div>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          {t(toast.key)}
          {toast.deletedId && (
            <button
              onClick={() => {
                if (repo && toast.deletedId)
                  void action(async () => {
                    await repo.restore(toast.deletedId ?? '');
                    setToast(null);
                  });
              }}
            >
              {t('undo')}
            </button>
          )}
          <button aria-label={t('cancel')} className="muted-button" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
