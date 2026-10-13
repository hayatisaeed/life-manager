import { z } from 'zod';
import {
  idSchema as id,
  localDateSchema as date,
  instantSchema as instant,
  localTimeSchema as time,
  hlcSchema,
  moneySchema as money,
  currencySchema as currency,
  calendarSchema as calendar,
  recurrenceSchema as recurrence,
  reminderSchema,
  blobRefSchema as blob,
  habitScheduleSchema,
} from './shared';
export * from './shared';
const text = z.string();
const number = z.number().finite();
const positive = number.nonnegative();
const integer = z.number().int().nonnegative();
const bool = z.boolean();
const tags = z.array(text);
const refs = z.array(id);
const reminders = z.array(reminderSchema);
const order = text.min(1);
const status = z.enum(['active', 'onHold', 'done', 'archived']);
const endpoint = z.object({ type: text, id });
const labeled = z.array(z.object({ label: text, value: text }));
const block = {
  taskId: id.optional(),
  title: text,
  start: instant,
  end: instant,
  kind: z.enum(['task', 'focus', 'routine', 'buffer']),
  proposalId: id.optional(),
};
const json = z.json();
const data = <T extends z.ZodRawShape>(shape: T) =>
  z.looseObject({ ...shape, _unknown: z.record(text, json).optional() });
/** Canonical schemas for DATA-MODEL.md §§3–14. Unknown fields survive reads. */
export const entitySchemas = {
  area: data({
    name: text,
    color: text,
    icon: text,
    targetWeight: number.min(0).max(10),
    order,
    archived: bool,
  }),
  tag: data({ name: text, color: text }),
  link: data({
    from: endpoint,
    to: endpoint,
    kind: z.enum(['related', 'mentions', 'blocks', 'partOf', 'about']),
  }),
  inboxItem: data({
    text,
    audioBlob: blob.optional(),
    transcript: text.optional(),
    transcriptStatus: z.enum(['none', 'pending', 'done', 'failed']),
    source: z.enum(['quick', 'share', 'voice', 'import']),
    processedAt: instant.optional(),
  }),
  project: data({
    name: text,
    areaId: id.optional(),
    status,
    notes: text,
    color: text.optional(),
    order,
  }),
  task: data({
    title: text,
    notes: text,
    projectId: id.optional(),
    parentId: id.optional(),
    areaId: id.optional(),
    goalId: id.optional(),
    milestoneId: id.optional(),
    priority: z.number().int().min(1).max(4),
    status: z.enum(['todo', 'doing', 'done', 'cancelled']),
    dueDate: date.optional(),
    dueTime: time.optional(),
    scheduledAt: instant.optional(),
    estimateMin: positive.optional(),
    recurrence: recurrence.optional(),
    reminders,
    tags,
    completedAt: instant.optional(),
    recurrenceOf: id.optional(),
    order,
  }),
  goal: data({
    title: text,
    why: text,
    areaId: id.optional(),
    targetDate: date.optional(),
    status,
    progressMode: z.enum(['milestones', 'tasks', 'manual']),
    manualProgress: number.min(0).max(1).optional(),
  }),
  milestone: data({
    goalId: id,
    title: text,
    dueDate: date.optional(),
    doneAt: instant.optional(),
    order,
  }),
  event: data({
    title: text,
    notes: text,
    start: instant,
    end: instant,
    allDay: bool,
    timeZone: text.min(1),
    location: text.optional(),
    recurrence: recurrence.optional(),
    reminders,
    source: z.literal('local'),
  }).refine((v) => v.end > v.start),
  timeBlock: data(block).refine((v) => v.end > v.start),
  habit: data({
    name: text,
    areaId: id.optional(),
    icon: text,
    color: text,
    kind: z.enum(['boolean', 'count', 'duration']),
    target: positive.optional(),
    schedule: habitScheduleSchema,
    reminderTime: time.optional(),
    startDate: date,
    archived: bool,
  }),
  habitLog: data({ habitId: id, date, value: number, note: text.optional() }),
  routine: data({
    name: text,
    kind: z.enum(['morning', 'evening', 'custom']),
    steps: z.array(
      z.object({
        id,
        title: text,
        habitId: id.optional(),
        durationMin: positive.optional(),
        order,
      }),
    ),
    reminderTime: time.optional(),
  }),
  routineRun: data({
    routineId: id,
    date,
    completedStepIds: refs,
    startedAt: instant.optional(),
    finishedAt: instant.optional(),
  }),
  weeklyReview: data({
    weekStart: date,
    done: text,
    slipped: text,
    next: text,
    highlights: text.optional(),
    statsSnapshot: json,
  }),
  focusSession: data({
    taskId: id.optional(),
    plannedMin: positive,
    start: instant,
    end: instant.optional(),
    breaks: z.array(z.object({ start: instant, end: instant })),
    interruptions: integer,
    note: text.optional(),
  }),
  timeEntry: data({
    taskId: id.optional(),
    projectId: id.optional(),
    areaId: id.optional(),
    start: instant,
    end: instant,
    source: z.enum(['timer', 'manual', 'block', 'focus']),
    note: text.optional(),
  }).refine((v) => v.end > v.start),
  account: data({
    name: text,
    kind: z.enum(['cash', 'bank', 'card', 'savings', 'investment']),
    currency,
    openingBalance: money,
    archived: bool,
  }).refine((v) => v.currency === v.openingBalance.currency),
  category: data({
    name: text,
    kind: z.enum(['expense', 'income']),
    parentId: id.optional(),
    color: text,
    icon: text,
  }),
  transaction: data({
    accountId: id,
    date,
    amount: money,
    categoryId: id.optional(),
    payee: text.optional(),
    notes: text,
    tags,
    fxToBase: number.positive().optional(),
    transferId: id.optional(),
    billId: id.optional(),
  }),
  budget: data({
    month: text.regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    categoryId: id,
    limit: money,
    alertAtPct: number.min(0).max(100),
  }),
  bill: data({
    name: text,
    amount: money,
    recurrence,
    nextDue: date,
    accountId: id.optional(),
    categoryId: id.optional(),
    autopay: bool,
    kind: z.enum(['bill', 'subscription']),
    url: z.url().optional(),
    reminders,
  }),
  savingsGoal: data({
    name: text,
    target: money,
    accountId: id.optional(),
    targetDate: date.optional(),
    manualSaved: money.optional(),
  }),
  fxRate: data({
    date,
    from: currency,
    to: currency,
    rate: number.positive(),
    source: z.enum(['manual', 'fetched']),
  }),
  healthLog: data({
    date,
    metric: z.union([
      z.enum(['sleep', 'water', 'exercise', 'mood', 'energy', 'weight']),
      text.regex(/^custom:.+$/),
    ]),
    value: number,
    unit: text,
    start: instant.optional(),
    end: instant.optional(),
    note: text.optional(),
  }).refine(
    (v) =>
      !['mood', 'energy'].includes(v.metric) ||
      (Number.isInteger(v.value) && v.value >= 1 && v.value <= 5),
  ),
  metricDef: data({
    key: text.min(1),
    name: text,
    unit: text,
    kind: z.enum(['number', 'scale5', 'boolean']),
  }),
  journalEntry: data({
    date,
    body: text,
    promptId: id.optional(),
    mood: number.int().min(1).max(5).optional(),
    tags,
  }),
  journalPrompt: data({
    text,
    schedule: z.enum(['daily', 'weekly', 'random']).optional(),
    active: bool,
  }),
  note: data({ title: text, content: text, tags, pinned: bool, folder: text.optional() }),
  resource: data({
    kind: z.enum(['book', 'course', 'article', 'video', 'podcast']),
    title: text,
    author: text.optional(),
    url: z.url().optional(),
    status: z.enum(['want', 'doing', 'done', 'dropped']),
    progress: z.object({
      current: positive,
      total: positive,
      unit: z.enum(['pages', 'percent', 'lessons']),
    }),
    rating: number.min(1).max(5).optional(),
    startedAt: instant.optional(),
    finishedAt: instant.optional(),
    notes: text,
  }),
  deck: data({ name: text, description: text.optional() }),
  card: data({
    deckId: id,
    front: text,
    back: text,
    sourceNoteId: id.optional(),
    fsrs: z.object({
      due: instant,
      stability: positive,
      difficulty: positive,
      elapsedDays: positive,
      scheduledDays: positive,
      reps: integer,
      lapses: integer,
      state: number.int().min(0).max(3),
      lastReview: instant.optional(),
    }),
    suspended: bool,
  }),
  reviewLog: data({
    cardId: id,
    rating: number.int().min(1).max(4),
    reviewedAt: instant,
    elapsedDays: positive,
    scheduledDays: positive,
    state: number.int().min(0).max(3),
  }),
  document: data({
    kind: z.enum([
      'id',
      'passport',
      'license',
      'warranty',
      'contract',
      'insurance',
      'medical',
      'other',
    ]),
    title: text,
    number: text.optional(),
    issuer: text.optional(),
    issueDate: date.optional(),
    expiryDate: date.optional(),
    files: z.array(blob),
    remindDaysBefore: z.array(integer),
    personId: id.optional(),
    assetId: id.optional(),
    notes: text,
  }),
  shoppingList: data({ name: text, store: text.optional() }),
  shoppingItem: data({
    listId: id,
    name: text,
    qty: positive.optional(),
    unit: text.optional(),
    done: bool,
    order,
    category: text.optional(),
  }),
  asset: data({
    name: text,
    kind: z.enum(['home', 'appliance', 'vehicle', 'device', 'other']),
    purchaseDate: date.optional(),
    warrantyDocId: id.optional(),
    notes: text,
  }),
  maintenancePlan: data({
    assetId: id.optional(),
    title: text,
    recurrence,
    lastDone: date.optional(),
    nextDue: date,
    notes: text,
  }),
  person: data({
    name: text,
    nativeName: text.optional(),
    nickname: text.optional(),
    pronouns: text.optional(),
    photo: blob.optional(),
    emails: labeled,
    phones: labeled,
    addresses: labeled,
    socials: z.array(z.object({ kind: text, handle: text })),
    company: text.optional(),
    role: text.optional(),
    howWeMet: text.optional(),
    relationshipKind: z.enum([
      'family',
      'friend',
      'colleague',
      'acquaintance',
      'professional',
      'other',
    ]),
    circle: text.optional(),
    tags,
    cadenceDays: integer.positive().optional(),
    customFields: z.array(z.object({ key: text, value: text })),
    notes: text,
    archived: bool,
  }),
  importantDate: data({
    personId: id,
    kind: z.enum(['birthday', 'anniversary', 'other']),
    label: text.optional(),
    month: number.int().min(1).max(12),
    day: number.int().min(1).max(31),
    year: number.int().positive().optional(),
    calendar,
    remindDaysBefore: z.array(integer),
  }),
  interaction: data({
    date: instant,
    kind: z.enum(['call', 'meeting', 'message', 'email', 'inPerson', 'other']),
    personIds: refs,
    summary: text,
    notes: text,
    sentiment: number.int().min(-2).max(2).optional(),
    followUpTaskIds: refs,
  }),
  relationship: data({
    aId: id,
    bId: id,
    kind: z.enum([
      'spouse',
      'partner',
      'parent',
      'child',
      'sibling',
      'colleague',
      'introducedBy',
      'custom',
    ]),
    label: text.optional(),
  }),
  giftIdea: data({
    personId: id,
    idea: text,
    occasion: text.optional(),
    url: z.url().optional(),
    given: bool,
  }),
  planProposal: data({
    range: z.object({ start: date, end: date }),
    blocks: z.array(z.object(block).omit({ proposalId: true })),
    rationale: text,
    provider: z.enum(['claude', 'ollama']),
    status: z.enum(['pending', 'accepted', 'discarded']),
    acceptedBlockIds: refs,
  }),
  insight: data({
    period: z.object({ start: date, end: date }),
    kind: z.enum(['weekly', 'correlation', 'wheel']),
    payload: json,
    narrative: text.optional(),
  }),
} as const;
export type EntityType = keyof typeof entitySchemas;
export type EntityData<T extends EntityType> = z.infer<(typeof entitySchemas)[T]>;
export const envelopeSchema = z.looseObject({
  id,
  type: text,
  schema: z.number().int().positive(),
  hlc: hlcSchema,
  fieldHlc: z.record(text, hlcSchema),
  textVersions: z
    .record(
      text,
      z.array(z.looseObject({ clock: hlcSchema, value: text, parents: z.array(hlcSchema) })),
    )
    .optional(),
  deletedAt: instant.nullable(),
  createdAt: instant,
  data: z.record(text, json),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type ParsedRecord =
  | { kind: 'known'; record: Envelope }
  | { kind: 'preserved'; record: Envelope; reason: 'unknown-type' | 'newer-schema' };
export function parseRecord(input: unknown): ParsedRecord {
  const record = envelopeSchema.parse(input);
  if (!Object.hasOwn(entitySchemas, record.type))
    return { kind: 'preserved', record, reason: 'unknown-type' };
  if (record.schema > 1) return { kind: 'preserved', record, reason: 'newer-schema' };
  const type = record.type as EntityType;
  entitySchemas[type].parse(record.data);
  // Validation must not replace the source with zod's stripped nested objects.
  return { kind: 'known', record };
}
export type Upgrader = (
  data: Record<string, z.infer<typeof json>>,
) => Record<string, z.infer<typeof json>>;
export function upgradeRecord(
  record: Envelope,
  target: number,
  upgraders: ReadonlyMap<number, Upgrader>,
): Envelope {
  if (record.schema > target) throw new Error('Cannot downgrade record');
  let result = record;
  while (result.schema < target) {
    const upgrade = upgraders.get(result.schema);
    if (!upgrade) throw new Error('Missing schema upgrader');
    const next = upgrade(z.record(text, json).parse(JSON.parse(JSON.stringify(result.data))));
    const unknown = {
      ...(result.data._unknown as Record<string, z.infer<typeof json>> | undefined),
    };
    for (const [key, value] of Object.entries(result.data))
      if (!(key in next) && key !== '_unknown')
        Object.defineProperty(unknown, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
    result = {
      ...result,
      schema: result.schema + 1,
      data: {
        ...next,
        _unknown: {
          ...unknown,
          ...(next._unknown as Record<string, z.infer<typeof json>> | undefined),
        },
      },
    };
  }
  return result;
}
