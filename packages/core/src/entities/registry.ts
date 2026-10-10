import type { z } from 'zod';
import type { EntityDef } from './define';
import * as ai from './modules/ai';
import * as admin from './modules/admin';
import * as calendar from './modules/calendar';
import * as habits from './modules/habits';
import * as health from './modules/health';
import * as learning from './modules/learning';
import * as money from './modules/money';
import * as people from './modules/people';
import * as planning from './modules/planning';
import * as settings from './modules/settings';
import * as structure from './modules/structure';
import * as time from './modules/time';

/**
 * Every synced entity, keyed by the `type` string stored in the envelope.
 * These names are part of the encrypted record format: never rename one.
 */
export const ENTITIES = {
  area: structure.area,
  tag: structure.tag,
  link: structure.link,

  inboxItem: planning.inboxItem,
  project: planning.project,
  task: planning.task,
  goal: planning.goal,
  milestone: planning.milestone,

  event: calendar.event,
  timeBlock: calendar.timeBlock,

  habit: habits.habit,
  habitLog: habits.habitLog,
  routine: habits.routine,
  routineRun: habits.routineRun,
  weeklyReview: habits.weeklyReview,

  focusSession: time.focusSession,
  timeEntry: time.timeEntry,

  account: money.account,
  category: money.category,
  transaction: money.transaction,
  budget: money.budget,
  bill: money.bill,
  savingsGoal: money.savingsGoal,
  fxRate: money.fxRate,

  healthLog: health.healthLog,
  metricDef: health.metricDef,
  journalEntry: health.journalEntry,
  journalPrompt: health.journalPrompt,

  note: learning.note,
  resource: learning.resource,
  deck: learning.deck,
  card: learning.card,
  reviewLog: learning.reviewLog,

  document: admin.document,
  shoppingList: admin.shoppingList,
  shoppingItem: admin.shoppingItem,
  asset: admin.asset,
  maintenancePlan: admin.maintenancePlan,

  person: people.person,
  importantDate: people.importantDate,
  interaction: people.interaction,
  relationship: people.relationship,
  giftIdea: people.giftIdea,

  planProposal: ai.planProposal,
  insight: ai.insight,

  settings: settings.settings,
} as const satisfies Record<string, EntityDef>;

export type EntityType = keyof typeof ENTITIES;

/** The validated `data` of an entity at its current schema version. */
export type EntityData<T extends EntityType> = z.output<(typeof ENTITIES)[T]['data']>;

export const ENTITY_TYPES = Object.keys(ENTITIES) as EntityType[];

export function isEntityType(value: string): value is EntityType {
  return Object.hasOwn(ENTITIES, value);
}
