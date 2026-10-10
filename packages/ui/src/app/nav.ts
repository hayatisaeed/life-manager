import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Folder,
  HeartPulse,
  Inbox,
  NotebookPen,
  Repeat,
  Settings,
  Sun,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  to: string;
  key: string; // i18n key under nav.*
  icon: LucideIcon;
}

/** Sidebar order from DESIGN.md §5. */
export const NAV: NavItem[] = [
  { to: '/today', key: 'today', icon: Sun },
  { to: '/inbox', key: 'inbox', icon: Inbox },
  { to: '/planner', key: 'planner', icon: CalendarDays },
  { to: '/tasks', key: 'tasks', icon: CheckSquare },
  { to: '/habits', key: 'habits', icon: Repeat },
  { to: '/money', key: 'money', icon: Wallet },
  { to: '/health', key: 'health', icon: HeartPulse },
  { to: '/notes', key: 'notes', icon: NotebookPen },
  { to: '/people', key: 'people', icon: Users },
  { to: '/library', key: 'library', icon: BookOpen },
  { to: '/admin', key: 'admin', icon: Folder },
  { to: '/insights', key: 'insights', icon: BarChart3 },
];

export const SETTINGS_NAV: NavItem = { to: '/settings', key: 'settings', icon: Settings };
