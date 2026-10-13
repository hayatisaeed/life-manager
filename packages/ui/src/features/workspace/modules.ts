import type { EntityType, Envelope } from '@lm/core';
export interface Field {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'datetime-local';
  options?: string[];
  required?: boolean;
}
export interface Module {
  type: EntityType;
  title: string;
  fields: Field[];
  initial: (date: string) => Envelope['data'];
}
const title: Field = { key: 'title', label: 'title', required: true };
const name: Field = { key: 'name', label: 'name', required: true };
const notes: Field = { key: 'notes', label: 'notesField', kind: 'textarea' };
const status = (options: string[]): Field => ({
  key: 'status',
  label: 'status',
  kind: 'select',
  options,
});
export const modules: Record<string, Module> = {
  inbox: {
    type: 'inboxItem',
    title: 'inbox',
    fields: [{ key: 'text', label: 'text', kind: 'textarea', required: true }],
    initial: () => ({ text: '', transcriptStatus: 'none', source: 'quick' }),
  },
  tasks: {
    type: 'task',
    title: 'tasks',
    fields: [
      title,
      notes,
      { key: 'dueDate', label: 'dueDate', kind: 'date' },
      { key: 'priority', label: 'priority', kind: 'number' },
      status(['todo', 'doing', 'done', 'cancelled']),
    ],
    initial: () => ({
      title: '',
      notes: '',
      priority: 3,
      status: 'todo',
      reminders: [],
      tags: [],
      order: 'a0',
    }),
  },
  projects: {
    type: 'project',
    title: 'projects',
    fields: [name, notes, status(['active', 'onHold', 'done', 'archived'])],
    initial: () => ({ name: '', notes: '', status: 'active', order: 'a0' }),
  },
  planner: {
    type: 'event',
    title: 'planner',
    fields: [
      title,
      { key: 'start', label: 'start', kind: 'datetime-local', required: true },
      { key: 'end', label: 'end', kind: 'datetime-local', required: true },
      notes,
    ],
    initial: () => ({
      title: '',
      notes: '',
      start: '',
      end: '',
      allDay: false,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminders: [],
      source: 'local',
    }),
  },
  habits: {
    type: 'habit',
    title: 'habits',
    fields: [name],
    initial: (date) => ({
      name: '',
      icon: 'circle',
      color: 'accent',
      kind: 'boolean',
      target: 1,
      schedule: { kind: 'daily' },
      startDate: date,
      archived: false,
    }),
  },
  accounts: {
    type: 'account',
    title: 'accounts',
    fields: [
      name,
      {
        key: 'kind',
        label: 'kind',
        kind: 'select',
        options: ['cash', 'bank', 'card', 'savings', 'investment'],
      },
      { key: 'currency', label: 'currency', required: true },
    ],
    initial: () => ({
      name: '',
      kind: 'bank',
      currency: 'USD',
      openingBalance: { amount: 0, currency: 'USD' },
      archived: false,
    }),
  },
  money: {
    type: 'transaction',
    title: 'transactions',
    fields: [
      { key: 'amountInput', label: 'amount', kind: 'number', required: true },
      { key: 'accountId', label: 'account', kind: 'select', required: true },
      { key: 'date', label: 'date', kind: 'date', required: true },
      { key: 'payee', label: 'payee' },
      notes,
    ],
    initial: (date) => ({
      accountId: '',
      date,
      amount: { amount: 0, currency: 'USD' },
      notes: '',
      tags: [],
    }),
  },
  health: {
    type: 'healthLog',
    title: 'health',
    fields: [
      {
        key: 'metric',
        label: 'metric',
        kind: 'select',
        options: ['sleep', 'water', 'exercise', 'mood', 'energy', 'weight'],
      },
      { key: 'value', label: 'value', kind: 'number', required: true },
      { key: 'unit', label: 'unit', required: true },
      { key: 'date', label: 'date', kind: 'date', required: true },
    ],
    initial: (date) => ({ date, metric: 'water', value: 1, unit: '' }),
  },
  journal: {
    type: 'journalEntry',
    title: 'journal',
    fields: [
      { key: 'date', label: 'date', kind: 'date', required: true },
      { key: 'body', label: 'body', kind: 'textarea', required: true },
    ],
    initial: (date) => ({ date, body: '', tags: [] }),
  },
  notes: {
    type: 'note',
    title: 'notes',
    fields: [title, { key: 'content', label: 'content', kind: 'textarea' }],
    initial: () => ({ title: '', content: '', tags: [], pinned: false }),
  },
  people: {
    type: 'person',
    title: 'people',
    fields: [
      name,
      {
        key: 'relationshipKind',
        label: 'kind',
        kind: 'select',
        options: ['family', 'friend', 'colleague', 'acquaintance', 'professional', 'other'],
      },
      notes,
    ],
    initial: () => ({
      name: '',
      relationshipKind: 'friend',
      emails: [],
      phones: [],
      addresses: [],
      socials: [],
      tags: [],
      customFields: [],
      notes: '',
      archived: false,
    }),
  },
  library: {
    type: 'resource',
    title: 'library',
    fields: [
      title,
      {
        key: 'kind',
        label: 'kind',
        kind: 'select',
        options: ['book', 'course', 'article', 'video', 'podcast'],
      },
      status(['want', 'doing', 'done', 'dropped']),
      notes,
    ],
    initial: () => ({
      title: '',
      kind: 'book',
      status: 'want',
      progress: { current: 0, total: 0, unit: 'pages' },
      notes: '',
    }),
  },
  admin: {
    type: 'asset',
    title: 'assets',
    fields: [
      name,
      {
        key: 'kind',
        label: 'kind',
        kind: 'select',
        options: ['home', 'appliance', 'vehicle', 'device', 'other'],
      },
      notes,
    ],
    initial: () => ({ name: '', kind: 'home', notes: '' }),
  },
  goals: {
    type: 'goal',
    title: 'goals',
    fields: [
      title,
      { key: 'why', label: 'why', kind: 'textarea' },
      { key: 'targetDate', label: 'dueDate', kind: 'date' },
      status(['active', 'onHold', 'done', 'archived']),
      { key: 'manualProgress', label: 'goalProgress', kind: 'number' },
    ],
    initial: () => ({
      title: '',
      why: '',
      status: 'active',
      progressMode: 'manual',
      manualProgress: 0,
    }),
  },
};
