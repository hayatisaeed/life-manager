// The entity registry: one place that knows each record type's schema version,
// data schema and merge field kinds (SYNC.md §6, DATA-MODEL.md §1).

import type { z } from 'zod';
import * as S from './schemas';

export interface EntityDef<D extends z.ZodType = z.ZodType> {
  /** Current schema version written by this app. */
  schema: number;
  data: D;
  /** Arrays merged as sets (SYNC.md §6). */
  sets?: readonly string[];
  /** Arrays of `{id, order, …}` merged by item id. */
  lists?: readonly string[];
  /** Long text merged with diff3. */
  texts?: readonly string[];
  /** Field used as the display title / for full-text search. */
  title?: string;
}

const def = <D extends z.ZodType>(d: EntityDef<D>): EntityDef<D> => d;

export const ENTITIES = {
  area: def({ schema: 1, data: S.AreaZ, title: 'name' }),
  tag: def({ schema: 1, data: S.TagZ, title: 'name' }),
  link: def({ schema: 1, data: S.LinkZ }),
  inboxItem: def({ schema: 1, data: S.InboxItemZ, title: 'text' }),
  project: def({ schema: 1, data: S.ProjectZ, texts: ['notes'], title: 'name' }),
  task: def({ schema: 1, data: S.TaskZ, sets: ['tags'], texts: ['notes'], title: 'title' }),
  goal: def({ schema: 1, data: S.GoalZ, texts: ['why'], title: 'title' }),
  milestone: def({ schema: 1, data: S.MilestoneZ, title: 'title' }),
  event: def({ schema: 1, data: S.EventZ, texts: ['notes'], title: 'title' }),
  timeBlock: def({ schema: 1, data: S.TimeBlockZ, title: 'title' }),
  habit: def({ schema: 1, data: S.HabitZ, title: 'name' }),
  habitLog: def({ schema: 1, data: S.HabitLogZ }),
  routine: def({ schema: 1, data: S.RoutineZ, lists: ['steps'], title: 'name' }),
  routineRun: def({ schema: 1, data: S.RoutineRunZ, sets: ['completedStepIds'] }),
  weeklyReview: def({
    schema: 1,
    data: S.WeeklyReviewZ,
    texts: ['done', 'slipped', 'next', 'highlights'],
  }),
  focusSession: def({ schema: 1, data: S.FocusSessionZ }),
  timeEntry: def({ schema: 1, data: S.TimeEntryZ }),
  account: def({ schema: 1, data: S.AccountZ, title: 'name' }),
  category: def({ schema: 1, data: S.CategoryZ, title: 'name' }),
  transaction: def({
    schema: 1,
    data: S.TransactionZ,
    sets: ['tags'],
    texts: ['notes'],
    title: 'payee',
  }),
  budget: def({ schema: 1, data: S.BudgetZ }),
  bill: def({ schema: 1, data: S.BillZ, title: 'name' }),
  savingsGoal: def({ schema: 1, data: S.SavingsGoalZ, title: 'name' }),
  fxRate: def({ schema: 1, data: S.FxRateZ }),
  healthLog: def({ schema: 1, data: S.HealthLogZ }),
  metricDef: def({ schema: 1, data: S.MetricDefZ, title: 'name' }),
  journalEntry: def({ schema: 1, data: S.JournalEntryZ, sets: ['tags'], texts: ['body'] }),
  journalPrompt: def({ schema: 1, data: S.JournalPromptZ, title: 'text' }),
  note: def({ schema: 1, data: S.NoteZ, sets: ['tags'], texts: ['content'], title: 'title' }),
  resource: def({ schema: 1, data: S.ResourceZ, texts: ['notes'], title: 'title' }),
  deck: def({ schema: 1, data: S.DeckZ, title: 'name' }),
  card: def({ schema: 1, data: S.CardZ, title: 'front' }),
  reviewLog: def({ schema: 1, data: S.ReviewLogZ }),
  document: def({
    schema: 1,
    data: S.DocumentZ,
    sets: ['files', 'remindDaysBefore'],
    texts: ['notes'],
    title: 'title',
  }),
  shoppingList: def({ schema: 1, data: S.ShoppingListZ, title: 'name' }),
  shoppingItem: def({ schema: 1, data: S.ShoppingItemZ, title: 'name' }),
  asset: def({ schema: 1, data: S.AssetZ, texts: ['notes'], title: 'name' }),
  maintenancePlan: def({ schema: 1, data: S.MaintenancePlanZ, texts: ['notes'], title: 'title' }),
  person: def({ schema: 1, data: S.PersonZ, sets: ['tags'], texts: ['notes'], title: 'name' }),
  importantDate: def({ schema: 1, data: S.ImportantDateZ, sets: ['remindDaysBefore'] }),
  interaction: def({
    schema: 1,
    data: S.InteractionZ,
    sets: ['personIds', 'followUpTaskIds'],
    texts: ['notes'],
    title: 'summary',
  }),
  relationship: def({ schema: 1, data: S.RelationshipZ }),
  giftIdea: def({ schema: 1, data: S.GiftIdeaZ, title: 'idea' }),
  planProposal: def({
    schema: 1,
    data: S.PlanProposalZ,
    sets: ['acceptedBlockIds'],
    texts: ['rationale'],
  }),
  insight: def({ schema: 1, data: S.InsightZ, texts: ['narrative'] }),
  settings: def({ schema: 1, data: S.SettingsZ }),
} as const;

export type EntityType = keyof typeof ENTITIES;
export type EntityData<T extends EntityType> = z.infer<(typeof ENTITIES)[T]['data']>;

export const ENTITY_TYPES = Object.keys(ENTITIES) as EntityType[];

export function isEntityType(t: string): t is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITIES, t);
}

export function entityDef(t: string): EntityDef | undefined {
  return isEntityType(t) ? ENTITIES[t] : undefined;
}

/** The well-known id of the single synced settings record (DATA-MODEL.md §14). */
export const SETTINGS_ID = 'SETTINGS';
