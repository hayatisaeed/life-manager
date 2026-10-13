import { useState } from 'react';
import type { Envelope } from '@lm/core';
import type { Repository } from '@lm/db';
import { useTranslation, instantInput } from '@lm/i18n';
import type { Module } from './modules';
import { generateId, text } from './runtime';

export function Editor({
  module,
  record,
  repo,
  accounts,
  today,
  onClose,
  onError,
}: {
  module: Module;
  record: Envelope | undefined;
  repo: Repository;
  accounts: Envelope[];
  today: string;
  onClose: () => void;
  onError: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Envelope['data']>(() => {
    const initial = { ...(record?.data ?? module.initial(today)) };
    const amount = initial.amount;
    if (amount && typeof amount === 'object' && !Array.isArray(amount))
      initial.amountInput = amount.amount ?? 0;
    return initial;
  });
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
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
      await repo.put(module.type, record?.id ?? generateId(Date.now()), data, unset);
      onClose();
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="editor"
      aria-label={t(record ? 'edit' : 'create')}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="fields">
        {module.fields.map((field) => {
          const value = values[field.key];
          const display = typeof value === 'string' || typeof value === 'number' ? value : '';
          const set = (input: string) =>
            setValues({
              ...values,
              [field.key]: field.kind === 'number' ? (input === '' ? '' : Number(input)) : input,
            });
          return (
            <label
              className={`field ${field.kind === 'textarea' ? 'field-wide' : ''}`}
              key={field.key}
            >
              {t(field.label)}
              {field.kind === 'textarea' ? (
                <textarea
                  dir="auto"
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
                        {t(option)}
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
        <button type="button" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}
