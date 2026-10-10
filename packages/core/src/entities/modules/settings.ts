import { z } from 'zod';
import { defineEntity } from '../define';
import { calendarSystem, currency, localTime, ulid, weekday } from '../primitives';

// DATA-MODEL.md §14: the one synced settings record. Device settings never sync.

/**
 * The settings record always has this id, so two devices that create it
 * offline produce one record that merges, not two.
 */
export const SETTINGS_ID = '00000000000000000000000000';

const timeRange = { start: localTime, end: localTime };

export const settings = defineEntity({
  language: z.enum(['en', 'fa']),
  calendar: calendarSystem,
  weekStart: weekday,
  // `native` shows Persian digits in the fa locale.
  digits: z.enum(['latin', 'native']),
  baseCurrency: currency,
  theme: z.enum(['system', 'light', 'dark']),
  workingHours: z.array(z.strictObject({ weekday, ...timeRange })),
  energyProfile: z.array(
    z.strictObject({ ...timeRange, level: z.enum(['low', 'medium', 'high']) }),
  ),
  lifeWheelAreaIds: z.array(ulid),
  ai: z.strictObject({
    // Modules never sent to a remote provider (ARCHITECTURE.md §11).
    excludedModules: z.array(z.string().regex(/^[a-z][A-Za-z]{0,31}$/)),
  }),
});
