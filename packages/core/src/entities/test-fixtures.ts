// Valid sample data for every entity type, used by tests only. The mapped type
// makes the compiler fail if an entity is added without a fixture.
import type { EntityData, EntityType } from './registry';

const ID = '01J9ZQ4X2K8M3N5P6R7S8T9V0W';
const ID2 = '01J9ZQ4X2K8M3N5P6R7S8T9V0X';
const AT = '2026-10-09T10:15:00.000Z';
const LATER = '2026-10-09T11:15:00.000Z';
const HASH = 'a'.repeat(64);

export const FIXTURES: { [K in EntityType]: EntityData<K> } = {
  area: {
    name: 'Health',
    color: 'teal',
    icon: 'heart',
    targetWeight: 7,
    order: 'a0',
    archived: false,
  },
  tag: { name: 'family', color: 'amber' },
  link: { from: { type: 'note', id: ID }, to: { type: 'person', id: ID2 }, kind: 'mentions' },

  inboxItem: {
    text: 'Call the dentist',
    audioBlob: { hash: HASH, size: 1024, mime: 'audio/webm' },
    transcriptStatus: 'pending',
    source: 'voice',
  },
  project: { name: 'Move', status: 'active', notes: '', order: 'a0', areaId: ID },
  task: {
    title: 'Call mom',
    notes: 'Ask about the weekend',
    priority: 2,
    status: 'todo',
    dueDate: '2026-10-10',
    dueTime: '18:30',
    recurrence: {
      calendar: 'jalali',
      freq: 'monthly',
      interval: 1,
      byMonthDay: [-1],
      mode: 'fixed',
    },
    reminders: [{ offsetMinutes: -15, channel: 'notify' }],
    tags: [ID],
    order: 'a0',
  },
  goal: {
    title: 'Run 10k',
    why: 'Feel strong',
    status: 'active',
    progressMode: 'manual',
    manualProgress: 40,
  },
  milestone: { goalId: ID, title: '5k', dueDate: '2026-11-01', order: 'a0' },

  event: {
    title: 'Dinner',
    notes: '',
    start: AT,
    end: LATER,
    allDay: false,
    timeZone: 'Asia/Tehran',
    reminders: [],
    source: 'local',
  },
  timeBlock: { title: 'Deep work', start: AT, end: LATER, kind: 'focus', proposalId: ID },

  habit: {
    name: 'Water',
    icon: 'glass-water',
    color: 'blue',
    kind: 'count',
    target: 8,
    schedule: { kind: 'weekdays', days: [0, 2, 4] },
    startDate: '2026-10-01',
    archived: false,
  },
  habitLog: { habitId: ID, date: '2026-10-09', value: 6 },
  routine: {
    name: 'Morning',
    kind: 'morning',
    steps: [{ id: ID, title: 'Stretch', durationMin: 5, order: 'a0' }],
    reminderTime: '07:00',
  },
  routineRun: { routineId: ID, date: '2026-10-09', completedStepIds: [ID], startedAt: AT },
  weeklyReview: {
    weekStart: '2026-10-03',
    done: '- shipped',
    slipped: '',
    next: '- plan',
    statsSnapshot: { tasksDone: 12, focus: [1, 2, null] },
  },

  focusSession: {
    plannedMin: 25,
    start: AT,
    breaks: [{ start: AT, end: LATER }],
    interruptions: 0,
  },
  timeEntry: { start: AT, end: LATER, source: 'timer', taskId: ID },

  account: {
    name: 'Wallet',
    kind: 'cash',
    currency: 'IRR',
    openingBalance: { amount: 5_000_000, currency: 'IRR' },
    archived: false,
  },
  category: { name: 'Food', kind: 'expense', color: 'orange', icon: 'utensils' },
  transaction: {
    accountId: ID,
    date: '2026-10-09',
    amount: { amount: -1250, currency: 'EUR' },
    notes: '',
    tags: [],
    fxToBase: 1.08,
  },
  budget: {
    month: '1405-07',
    categoryId: ID,
    limit: { amount: 40000, currency: 'EUR' },
    alertAtPct: 80,
  },
  bill: {
    name: 'Phone',
    amount: { amount: 1999, currency: 'EUR' },
    recurrence: { calendar: 'gregorian', freq: 'monthly', interval: 1, mode: 'fixed', count: 12 },
    nextDue: '2026-11-01',
    autopay: true,
    kind: 'subscription',
    url: 'https://example.com/billing',
    reminders: [{ offsetMinutes: -1440, channel: 'notify' }],
  },
  savingsGoal: { name: 'Laptop', target: { amount: 150000, currency: 'EUR' } },
  fxRate: { date: '2026-10-09', from: 'EUR', to: 'USD', rate: 1.08, source: 'fetched' },

  healthLog: { date: '2026-10-08', metric: 'sleep', value: 7.5, unit: 'h', start: AT, end: LATER },
  metricDef: { key: 'steps', name: 'Steps', unit: 'steps', kind: 'number' },
  journalEntry: { date: '2026-10-09', body: 'A good day.', mood: 4, tags: [ID] },
  journalPrompt: { text: 'What went well?', schedule: 'daily', active: true },

  note: { title: 'Ideas', content: '# Ideas\n\n- one', tags: [], pinned: true },
  resource: {
    kind: 'book',
    title: 'Deep Work',
    status: 'doing',
    progress: { current: 120, total: 296, unit: 'pages' },
    notes: '',
    rating: 5,
  },
  deck: { name: 'Persian verbs' },
  card: {
    deckId: ID,
    front: 'رفتن',
    back: 'to go',
    fsrs: {
      due: AT,
      stability: 2.5,
      difficulty: 5.1,
      elapsedDays: 0,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 1,
    },
    suspended: false,
  },
  reviewLog: { cardId: ID, rating: 3, reviewedAt: AT, elapsedDays: 0, scheduledDays: 1, state: 1 },

  document: {
    kind: 'passport',
    title: 'Passport',
    expiryDate: '2030-01-31',
    files: [{ hash: HASH, size: 200_000, mime: 'image/jpeg', name: 'passport.jpg' }],
    remindDaysBefore: [90, 30, 7],
    notes: '',
  },
  shoppingList: { name: 'Groceries', store: 'Market' },
  shoppingItem: { listId: ID, name: 'Milk', qty: 2, unit: 'l', done: false, order: 'a0' },
  asset: { name: 'Car', kind: 'vehicle', purchaseDate: '2020-05-01', notes: '' },
  maintenancePlan: {
    assetId: ID,
    title: 'Oil change',
    recurrence: { calendar: 'gregorian', freq: 'monthly', interval: 6, mode: 'afterCompletion' },
    nextDue: '2027-01-01',
    notes: '',
  },

  person: {
    name: 'Sara',
    nativeName: 'سارا',
    emails: [{ label: 'home', value: 'sara@example.com' }],
    phones: [],
    addresses: [],
    socials: [{ kind: 'mastodon', handle: '@sara' }],
    relationshipKind: 'friend',
    tags: [],
    cadenceDays: 30,
    customFields: [{ key: 'Coffee', value: 'flat white' }],
    notes: '',
    archived: false,
  },
  importantDate: {
    personId: ID,
    kind: 'birthday',
    month: 7,
    day: 15,
    calendar: 'jalali',
    remindDaysBefore: [7, 1],
  },
  interaction: {
    date: AT,
    kind: 'call',
    personIds: [ID, ID2],
    summary: 'Caught up',
    notes: '',
    sentiment: 1,
    followUpTaskIds: [],
  },
  relationship: { aId: ID, bId: ID2, kind: 'sibling' },
  giftIdea: { personId: ID, idea: 'Book', given: false },

  planProposal: {
    range: { start: AT, end: LATER },
    blocks: [{ id: ID, title: 'Write', start: AT, end: LATER, kind: 'task', taskId: ID2 }],
    rationale: 'Mornings are your peak.',
    provider: 'claude',
    status: 'pending',
    acceptedBlockIds: [],
  },
  insight: {
    period: { start: '2026-10-03', end: '2026-10-09' },
    kind: 'weekly',
    payload: { score: 0.7 },
  },

  settings: {
    language: 'fa',
    calendar: 'jalali',
    weekStart: 6,
    digits: 'native',
    baseCurrency: 'IRR',
    theme: 'system',
    workingHours: [{ weekday: 6, start: '09:00', end: '17:00' }],
    energyProfile: [{ start: '08:00', end: '11:00', level: 'high' }],
    lifeWheelAreaIds: [ID],
    ai: { excludedModules: ['money', 'people', 'health', 'documents'] },
  },
};

export const SAMPLE = { ID, ID2, AT, LATER, HASH };
