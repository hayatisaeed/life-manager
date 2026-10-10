export {
  defineEntity,
  type EntityDef,
  type MergeKind,
  type Upgrader,
  type UpgradeInput,
} from './define';
export {
  decodeRecord,
  envelopeSchema,
  parseEntityData,
  stashUnknownFields,
  type DecodeResult,
  type EntityRecord,
  type KeptReason,
  type RawEnvelope,
} from './envelope';
export * as schemas from './primitives';
export { ENTITIES, ENTITY_TYPES, isEntityType, type EntityData, type EntityType } from './registry';
export { SETTINGS_ID } from './modules/settings';
