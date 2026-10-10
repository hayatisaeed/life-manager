// Collects each feature's i18n keys (AGENTS.md §5 "Feature folders").

import * as onboarding from './onboarding/i18n';
import * as settings from './settings/i18n';

export const FEATURE_CATALOGS: { en: object; fa: object }[] = [onboarding, settings];
