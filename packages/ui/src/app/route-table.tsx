// Path → screen. Feature milestones replace the placeholders.

import type { ComponentType } from 'react';
import { SettingsPage } from '../features/settings/settings-page';
import { SyncSettingsPage } from '../features/settings/sync-settings';
import { Placeholder } from './placeholder';

const P = (key: string): ComponentType => () => <Placeholder navKey={key} />;

export const ROUTES: Record<string, ComponentType> = {
  '/today': P('today'),
  '/inbox': P('inbox'),
  '/planner': P('planner'),
  '/tasks': P('tasks'),
  '/habits': P('habits'),
  '/money': P('money'),
  '/health': P('health'),
  '/notes': P('notes'),
  '/people': P('people'),
  '/library': P('library'),
  '/admin': P('admin'),
  '/insights': P('insights'),
  '/settings': SettingsPage,
  '/settings/sync': SyncSettingsPage,
};
