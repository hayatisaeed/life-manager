import { useEffect, useRef, useState } from 'react';
import type { Envelope } from '@lm/core';
import type { Repository } from '@lm/db';
import { useTranslation, instantInput } from '@lm/i18n';
import type { Module } from './modules';
import { generateId, text } from './runtime';
export interface EditorDraft {
  id: string;
  values: Envelope['data'];
  base: Envelope['data'] | null;
  edited: string[];
}

export function Editor({
  module,
  record,
  repo,
  accounts,
  today,
  onClose,
  onError,
  draft,
  onDraft,
  onSaved,
  onDiscard,
}: {
  module: Module;
  record: Envelope | undefined;
  repo: Repository;
  accounts: Envelope[];
  today: string;
  onClose: () => void;
  onError: () => void;
  draft: EditorDraft | undefined;
  onDraft: (draft: EditorDraft) => void;
  onSaved: (saved: Envelope, submitted: EditorDraft) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [id] = useState(() => draft?.id ?? record?.id ?? generateId(Date.now()));
  const [initialBase] = useState(() => draft?.base ?? record?.data ?? null);
  const base = draft?.base ?? initialBase;
  const formRef = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [initialValues] = useState<Envelope['data']>(() => {
    if (draft) return { ...draft.values };
    const initial = { ...(record?.data ?? module.initial(today)) };
    const amount = initial.amount;
    if (amount && typeof amount === 'object' && !Array.isArray(amount))
      initial.amountInput = amount.amount ?? 0;
    return initial;
  });
  const values = draft?.values ?? initialValues;
  const edited = draft?.edited ?? [];
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input:not([disabled]),textarea,select')?.focus();
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const data = { ...values };
      const unset: string[] = [];
      if (module.type === 'account') {
        data.currency = String(data.currency).toUpperCase();
        const balance = record?.data.openingBalance;
        data.openingBalance = {
          amount:
            balance && typeof balance === 'object' && !Array.isArray(balance)
              ? Number(balance.amount)
              : 0,
          currency: String(data.currency),
        };
      }
      if (module.type === 'transaction') {
        const account = accounts.find((item) => item.id === data.accountId);
        if (!account) throw new Error('Account required');
        data.amount = { amount: Number(data.amountInput), currency: String(account.data.currency) };
        delete data.amountInput;
      }
      for (const field of module.fields) {
        if (field.kind === 'datetime-local' && typeof data[field.key] === 'string')
          data[field.key] = new Date(String(data[field.key])).toISOString();
        if (!field.required && data[field.key] === '' && field.kind === 'date') {
          Reflect.deleteProperty(data, field.key);
          unset.push(field.key);
        }
      }
      // A draft changes only edited fields; hidden or remotely updated fields keep their current values.
      const fields = new Set(edited);
      if (module.type === 'transaction' && (fields.has('amountInput') || fields.has('accountId')))
        fields.add('amount');
      const changed =
        base === null
          ? data
          : Object.fromEntries(Object.entries(data).filter(([key]) => fields.has(key)));
      const saved = await repo.put(
        module.type,
        id,
        changed,
        base === null ? unset : unset.filter((key) => fields.has(key)),
      );
      onSaved(saved, { id, values, base, edited });
    } catch {
      onError();
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }
  return (
    <form
      className="editor"
      ref={formRef}
      aria-label={t(record ? 'edit' : 'create')}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <p className="notice">{t(draft ? 'draftRestored' : 'draftHelp')}</p>
      <div className="fields">
        {module.fields.map((field) => {
          const value = values[field.key];
          const display = typeof value === 'string' || typeof value === 'number' ? value : '';
          const set = (input: string) => {
            const next = {
              ...values,
              [field.key]:
                field.kind === 'number' || field.key === 'priority'
                  ? input === ''
                    ? ''
                    : Number(input)
                  : input,
            };
            onDraft({ id, values: next, base, edited: [...new Set([...edited, field.key])] });
          };
          return (
            <label
              className={`field ${field.kind === 'textarea' ? 'field-wide' : ''}`}
              key={field.key}
            >
              {t(field.label)}
              {field.kind === 'textarea' ? (
                <textarea
                  dir="auto"
                  aria-label={t(field.label)}
                  value={display}
                  required={field.required}
                  onChange={(event) => set(event.target.value)}
                />
              ) : field.kind === 'select' ? (
                <select
                  aria-label={t(field.label)}
                  value={display}
                  required={field.required}
                  onChange={(event) => set(event.target.value)}
                >
                  {field.key === 'accountId' ? (
                    <>
                      <option value="">{t('choose')}</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {text(account, 'name')}
                        </option>
                      ))}
                    </>
                  ) : (
                    field.options?.map((option) => (
                      <option key={option} value={option}>
                        {t(field.key === 'priority' ? `priority${option}` : option)}
                      </option>
                    ))
                  )}
                </select>
              ) : (
                <input
                  dir={field.kind === 'date' || field.kind === 'datetime-local' ? 'ltr' : 'auto'}
                  type={field.kind ?? 'text'}
                  disabled={field.key === 'currency' && Boolean(record)}
                  value={
                    field.kind === 'datetime-local' &&
                    typeof display === 'string' &&
                    display.endsWith('Z')
                      ? instantInput(display)
                      : display
                  }
                  required={field.required}
                  step={field.kind === 'number' ? 'any' : undefined}
                  onChange={(event) => set(event.target.value)}
                />
              )}
            </label>
          );
        })}
      </div>
      {module.type === 'transaction' && accounts.length === 0 && (
        <p className="error">{t('noAccount')}</p>
      )}
      {module.fields.some((field) => field.kind === 'date') && <small>{t('dateInputHint')}</small>}
      <div className="form-actions">
        <button
          className="primary"
          disabled={saving || (module.type === 'transaction' && accounts.length === 0)}
        >
          {t('save')}
        </button>
        <button type="button" disabled={saving} onClick={onClose}>
          {t('keepDraft')}
        </button>
        <button type="button" disabled={saving} onClick={onDiscard}>
          {t('discardDraft')}
        </button>
      </div>
    </form>
  );
}
