// Entity `data` schemas, the code side of DATA-MODEL.md §3–14. Keep the two in
// sync in the same PR.
//
// Objects are `looseObject` so fields written by a newer app version survive a
// round trip through an older one (SYNC.md §10, "never lose user data").

import { z } from 'zod';
import {
  BlobRefZ,
  CalendarSystemZ,
  ColorZ,
  CurrencyZ,
  EntityRefZ,
  IdZ,
  InstantZ,
  LabeledValueZ,
  LocalDateZ,
  LocalTimeZ,
  MoneyZ,
  OrderZ,
  PriorityZ,
  RecurrenceZ,
  ReminderZ,
} from './common';

const o = z.looseObject;
const opt = <T extends z.ZodType>(t: T) => t.optional();
const Tags = z.array(z.string().max(100));

// --- §3 Structure ---
export const AreaZ = o({
  name: z.string().min(1).max(200),
  color: ColorZ,
  icon: z.string().max(64),
  targetWeight: z.number().min(0).max(10),
  order: OrderZ,
  archived: z.boolean(),
});
export const TagZ = o({ name: z.string().min(1).max(100), color: ColorZ });
export const LinkZ = o({
  from: EntityRefZ,
  to: EntityRefZ,
  kind: z.enum(['related', 'mentions', 'blocks', 'partOf', 'about']),
});

// --- §4 Planning ---
export const InboxItemZ = o({
  text: z.string(),
  audioBlob: opt(BlobRefZ),
  transcript: opt(z.string()),
  transcriptStatus: z.enum(['none', 'pending', 'done', 'failed']),
  source: z.enum(['quick', 'share', 'voice', 'import']),
  processedAt: opt(InstantZ),
});
export const ProjectZ = o({
  name: z.string().min(1).max(300),
  areaId: opt(IdZ),
  status: z.enum(['active', 'onHold', 'done', 'archived']),
  notes: z.string(),
  color: opt(ColorZ),
  order: OrderZ,
});
export const TaskZ = o({
  title: z.string().min(1).max(1000),
  notes: z.string(),
  projectId: opt(IdZ),
  parentId: opt(IdZ),
  areaId: opt(IdZ),
  goalId: opt(IdZ),
  milestoneId: opt(IdZ),
  priority: PriorityZ,
  status: z.enum(['todo', 'doing', 'done', 'cancelled']),
  dueDate: opt(LocalDateZ),
  dueTime: opt(LocalTimeZ),
  scheduledAt: opt(InstantZ),
  estimateMin: opt(z.number().int().min(0)),
  recurrence: opt(RecurrenceZ),
  /** Set on instances created by completing a recurring task (DATA-MODEL.md §4). */
  recurrenceOf: opt(IdZ),
  reminders: z.array(ReminderZ),
  tags: Tags,
  completedAt: opt(InstantZ),
  order: OrderZ,
});
export const GoalZ = o({
  title: z.string().min(1).max(500),
  why: z.string(),
  areaId: opt(IdZ),
  targetDate: opt(LocalDateZ),
  status: z.enum(['active', 'onHold', 'achieved', 'dropped']),
  progressMode: z.enum(['milestones', 'tasks', 'manual']),
  manualProgress: opt(z.number().min(0).max(1)),
});
export const MilestoneZ = o({
  goalId: IdZ,
  title: z.string().min(1).max(500),
  dueDate: opt(LocalDateZ),
  doneAt: opt(InstantZ),
  order: OrderZ,
});

// --- §5 Calendar ---
export const EventZ = o({
  title: z.string().min(1).max(500),
  notes: z.string(),
  start: InstantZ,
  end: InstantZ,
  allDay: z.boolean(),
  timeZone: z.string(),
  location: opt(z.string()),
  recurrence: opt(RecurrenceZ),
  reminders: z.array(ReminderZ),
  source: z.literal('local'),
});
export const TimeBlockZ = o({
  taskId: opt(IdZ),
  title: z.string().max(500),
  start: InstantZ,
  end: InstantZ,
  kind: z.enum(['task', 'focus', 'routine', 'buffer']),
  proposalId: opt(IdZ),
});

// --- §6 Habits & routines ---
export const HabitScheduleZ = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  z.object({ kind: z.literal('weekdays'), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  z.object({
    kind: z.literal('timesPer'),
    times: z.number().int().min(1).max(31),
    period: z.enum(['week', 'month']),
  }),
  z.object({ kind: z.literal('everyNDays'), n: z.number().int().min(1).max(365) }),
]);
export type HabitSchedule = z.infer<typeof HabitScheduleZ>;
export const HabitZ = o({
  name: z.string().min(1).max(200),
  areaId: opt(IdZ),
  icon: z.string().max(64),
  color: ColorZ,
  kind: z.enum(['boolean', 'count', 'duration']),
  target: opt(z.number().min(0)),
  schedule: HabitScheduleZ,
  reminderTime: opt(LocalTimeZ),
  startDate: LocalDateZ,
  archived: z.boolean(),
});
export const HabitLogZ = o({
  habitId: IdZ,
  date: LocalDateZ,
  value: z.number().min(0),
  note: opt(z.string()),
  /** A skip token: keeps the streak without counting as done (DATA-MODEL.md §6). */
  skip: opt(z.boolean()),
});
export const RoutineStepZ = z.object({
  id: IdZ,
  title: z.string().min(1).max(300),
  habitId: opt(IdZ),
  durationMin: opt(z.number().int().min(0)),
  order: OrderZ,
});
export const RoutineZ = o({
  name: z.string().min(1).max(200),
  kind: z.enum(['morning', 'evening', 'custom']),
  steps: z.array(RoutineStepZ),
  reminderTime: opt(LocalTimeZ),
});
export const RoutineRunZ = o({
  routineId: IdZ,
  date: LocalDateZ,
  completedStepIds: z.array(IdZ),
  startedAt: opt(InstantZ),
  finishedAt: opt(InstantZ),
});
export const WeeklyReviewZ = o({
  weekStart: LocalDateZ,
  done: z.string(),
  slipped: z.string(),
  next: z.string(),
  highlights: opt(z.string()),
  statsSnapshot: z.record(z.string(), z.unknown()),
});

// --- §7 Time & focus ---
export const FocusSessionZ = o({
  taskId: opt(IdZ),
  plannedMin: z.number().int().min(1),
  start: InstantZ,
  end: opt(InstantZ),
  breaks: z.array(z.object({ start: InstantZ, end: opt(InstantZ) })),
  interruptions: z.number().int().min(0),
  note: opt(z.string()),
});
export const TimeEntryZ = o({
  taskId: opt(IdZ),
  projectId: opt(IdZ),
  areaId: opt(IdZ),
  start: InstantZ,
  end: InstantZ,
  source: z.enum(['timer', 'manual', 'block', 'focus']),
  note: opt(z.string()),
});

// --- §8 Money ---
export const AccountZ = o({
  name: z.string().min(1).max(200),
  kind: z.enum(['cash', 'bank', 'card', 'savings', 'investment']),
  currency: CurrencyZ,
  openingBalance: MoneyZ,
  archived: z.boolean(),
});
export const CategoryZ = o({
  name: z.string().min(1).max(200),
  kind: z.enum(['expense', 'income']),
  parentId: opt(IdZ),
  color: ColorZ,
  icon: z.string().max(64),
});
export const TransactionZ = o({
  accountId: IdZ,
  date: LocalDateZ,
  amount: MoneyZ,
  categoryId: opt(IdZ),
  payee: opt(z.string().max(300)),
  notes: z.string(),
  tags: Tags,
  /** Rate to convert `amount` into the base currency (a float rate is fine; amounts stay integers). */
  fxToBase: opt(z.number().positive()),
  transferId: opt(IdZ),
  billId: opt(IdZ),
});
export const BudgetZ = o({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  categoryId: IdZ,
  limit: MoneyZ,
  alertAtPct: z.number().int().min(1).max(1000),
});
export const BillZ = o({
  name: z.string().min(1).max(200),
  amount: MoneyZ,
  recurrence: RecurrenceZ,
  nextDue: LocalDateZ,
  accountId: opt(IdZ),
  categoryId: opt(IdZ),
  autopay: z.boolean(),
  kind: z.enum(['bill', 'subscription']),
  url: opt(z.string().max(2000)),
  reminders: z.array(ReminderZ),
});
export const SavingsGoalZ = o({
  name: z.string().min(1).max(200),
  target: MoneyZ,
  accountId: opt(IdZ),
  targetDate: opt(LocalDateZ),
  manualSaved: opt(MoneyZ),
});
export const FxRateZ = o({
  date: LocalDateZ,
  from: CurrencyZ,
  to: CurrencyZ,
  rate: z.number().positive(),
  source: z.enum(['manual', 'fetched']),
});

// --- §9 Health & journal ---
export const HealthMetricZ = z.union([
  z.enum(['sleep', 'water', 'exercise', 'mood', 'energy', 'weight']),
  z.string().regex(/^custom:[a-z0-9_-]{1,40}$/),
]);
export const HealthLogZ = o({
  date: LocalDateZ,
  metric: HealthMetricZ,
  value: z.number(),
  unit: z.string().max(20),
  start: opt(InstantZ),
  end: opt(InstantZ),
  note: opt(z.string()),
});
export const MetricDefZ = o({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().min(1).max(100),
  unit: z.string().max(20),
  kind: z.enum(['number', 'scale5', 'boolean']),
});
export const JournalEntryZ = o({
  date: LocalDateZ,
  body: z.string(),
  promptId: opt(IdZ),
  mood: opt(z.number().int().min(1).max(5)),
  tags: Tags,
});
export const JournalPromptZ = o({
  text: z.string().min(1).max(1000),
  schedule: opt(z.enum(['daily', 'weekly', 'random'])),
  active: z.boolean(),
});

// --- §10 Learning & knowledge ---
export const NoteZ = o({
  title: z.string().max(500),
  content: z.string(),
  tags: Tags,
  pinned: z.boolean(),
  folder: opt(z.string().max(300)),
});
export const ResourceZ = o({
  kind: z.enum(['book', 'course', 'article', 'video', 'podcast']),
  title: z.string().min(1).max(500),
  author: opt(z.string().max(300)),
  url: opt(z.string().max(2000)),
  status: z.enum(['want', 'doing', 'done', 'dropped']),
  progress: z.object({
    current: z.number().min(0),
    total: z.number().min(0),
    unit: z.enum(['pages', 'percent', 'lessons']),
  }),
  rating: opt(z.number().int().min(1).max(5)),
  startedAt: opt(LocalDateZ),
  finishedAt: opt(LocalDateZ),
  notes: z.string(),
});
export const DeckZ = o({ name: z.string().min(1).max(200), description: opt(z.string()) });
export const FsrsStateZ = z.object({
  due: InstantZ,
  stability: z.number(),
  difficulty: z.number(),
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  learningSteps: z.number().optional(),
  reps: z.number().int(),
  lapses: z.number().int(),
  state: z.number().int().min(0).max(3),
  lastReview: opt(InstantZ),
});
export type FsrsState = z.infer<typeof FsrsStateZ>;
export const CardZ = o({
  deckId: IdZ,
  front: z.string(),
  back: z.string(),
  sourceNoteId: opt(IdZ),
  fsrs: FsrsStateZ,
  suspended: z.boolean(),
});
export const ReviewLogZ = o({
  cardId: IdZ,
  rating: z.number().int().min(1).max(4),
  reviewedAt: InstantZ,
  elapsedDays: z.number(),
  scheduledDays: z.number(),
  state: z.number().int().min(0).max(3),
});

// --- §11 Life admin ---
export const DocumentZ = o({
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
  title: z.string().min(1).max(300),
  number: opt(z.string().max(200)),
  issuer: opt(z.string().max(300)),
  issueDate: opt(LocalDateZ),
  expiryDate: opt(LocalDateZ),
  files: z.array(BlobRefZ),
  remindDaysBefore: z.array(z.number().int().min(0)),
  personId: opt(IdZ),
  assetId: opt(IdZ),
  notes: z.string(),
});
export const ShoppingListZ = o({ name: z.string().min(1).max(200), store: opt(z.string()) });
export const ShoppingItemZ = o({
  listId: IdZ,
  name: z.string().min(1).max(300),
  qty: opt(z.number().min(0)),
  unit: opt(z.string().max(20)),
  done: z.boolean(),
  order: OrderZ,
  category: opt(z.string().max(100)),
});
export const AssetZ = o({
  name: z.string().min(1).max(300),
  kind: z.enum(['home', 'appliance', 'vehicle', 'device', 'other']),
  purchaseDate: opt(LocalDateZ),
  warrantyDocId: opt(IdZ),
  notes: z.string(),
});
export const MaintenancePlanZ = o({
  assetId: opt(IdZ),
  title: z.string().min(1).max(300),
  recurrence: RecurrenceZ,
  lastDone: opt(LocalDateZ),
  nextDue: LocalDateZ,
  notes: z.string(),
});

// --- §12 People ---
export const PersonZ = o({
  name: z.string().min(1).max(300),
  nativeName: opt(z.string().max(300)),
  nickname: opt(z.string().max(100)),
  pronouns: opt(z.string().max(50)),
  photo: opt(BlobRefZ),
  emails: z.array(LabeledValueZ),
  phones: z.array(LabeledValueZ),
  addresses: z.array(LabeledValueZ),
  socials: z.array(z.object({ kind: z.string(), handle: z.string() })),
  company: opt(z.string().max(300)),
  role: opt(z.string().max(300)),
  howWeMet: opt(z.string()),
  relationshipKind: z.enum([
    'family',
    'friend',
    'colleague',
    'acquaintance',
    'professional',
    'other',
  ]),
  circle: opt(z.string().max(100)),
  tags: Tags,
  cadenceDays: opt(z.number().int().min(1)),
  customFields: z.array(z.object({ key: z.string(), value: z.string() })),
  notes: z.string(),
  archived: z.boolean(),
});
export const ImportantDateZ = o({
  personId: IdZ,
  kind: z.enum(['birthday', 'anniversary', 'other']),
  label: opt(z.string().max(200)),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: opt(z.number().int()),
  calendar: CalendarSystemZ,
  remindDaysBefore: z.array(z.number().int().min(0)),
});
export const InteractionZ = o({
  date: InstantZ,
  kind: z.enum(['call', 'meeting', 'message', 'email', 'inPerson', 'other']),
  personIds: z.array(IdZ),
  summary: z.string().max(1000),
  notes: z.string(),
  sentiment: opt(z.number().int().min(-2).max(2)),
  followUpTaskIds: z.array(IdZ),
});
export const RelationshipZ = o({
  aId: IdZ,
  bId: IdZ,
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
  label: opt(z.string().max(100)),
});
export const GiftIdeaZ = o({
  personId: IdZ,
  idea: z.string().min(1).max(500),
  occasion: opt(z.string().max(200)),
  url: opt(z.string().max(2000)),
  given: z.boolean(),
});

// --- §13 AI & insights ---
export const ProposedBlockZ = z.object({
  taskId: opt(IdZ),
  title: z.string().max(500),
  start: InstantZ,
  end: InstantZ,
  kind: z.enum(['task', 'focus', 'routine', 'buffer']),
});
export const PlanProposalZ = o({
  range: z.object({ start: LocalDateZ, end: LocalDateZ }),
  blocks: z.array(ProposedBlockZ),
  rationale: z.string(),
  provider: z.string(),
  status: z.enum(['pending', 'accepted', 'discarded']),
  acceptedBlockIds: z.array(IdZ),
});
export const InsightZ = o({
  period: z.object({ start: LocalDateZ, end: LocalDateZ }),
  kind: z.enum(['weekly', 'correlation', 'wheel']),
  payload: z.record(z.string(), z.unknown()),
  narrative: opt(z.string()),
});

// --- §14 Settings (one synced record) ---
export const AI_MODULES = [
  'tasks',
  'calendar',
  'habits',
  'notes',
  'journal',
  'money',
  'people',
  'health',
  'documents',
] as const;
export type AiModule = (typeof AI_MODULES)[number];

export const SettingsZ = o({
  language: z.enum(['en', 'fa']),
  calendar: CalendarSystemZ,
  weekStart: z.number().int().min(0).max(6),
  digits: z.enum(['latin', 'persian']),
  baseCurrency: CurrencyZ,
  tomanDisplay: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  timeZone: z.string(),
  workingHours: z.object({
    start: LocalTimeZ,
    end: LocalTimeZ,
    days: z.array(z.number().int().min(0).max(6)),
  }),
  energyProfile: z.enum(['morning', 'afternoon', 'evening']),
  lifeWheelTargets: z.record(z.string(), z.number().min(0).max(10)),
  /** Modules whose data may be sent to a *remote* AI provider (ARCHITECTURE.md §11). */
  aiAllowedModules: z.array(z.enum(AI_MODULES)),
  dailyDigestTime: opt(LocalTimeZ),
  quietHours: opt(z.object({ start: LocalTimeZ, end: LocalTimeZ })),
});
