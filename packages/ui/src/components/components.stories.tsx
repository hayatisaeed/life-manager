import type { Story } from '@ladle/react';
import { useState } from 'react';
import { SyncPill } from '../layout/SyncPill';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { SegmentedControl } from './SegmentedControl';
import { Select } from './Select';
import { Switch } from './Switch';

// Use Ladle's toolbar to check every story in light/dark and LTR/RTL (DESIGN.md §6).

export const Buttons: Story = () => (
  <div className="flex flex-wrap gap-3">
    <Button variant="primary">Save</Button>
    <Button>Cancel</Button>
    <Button variant="ghost">More</Button>
    <Button disabled>Disabled</Button>
  </div>
);

export const Toggle: Story = () => {
  const [on, setOn] = useState(true);
  return (
    <div className="max-w-sm">
      <Switch label="Daily digest" checked={on} onCheckedChange={setOn} />
    </div>
  );
};

export const Segmented: Story = () => {
  const [v, setV] = useState<'system' | 'light' | 'dark'>('system');
  return (
    <SegmentedControl
      label="Theme"
      value={v}
      onValueChange={setV}
      options={[
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]}
    />
  );
};

export const Dropdown: Story = () => {
  const [v, setV] = useState<'en' | 'fa'>('en');
  return (
    <Select
      label="Language"
      value={v}
      onValueChange={setV}
      options={[
        { value: 'en', label: 'English' },
        { value: 'fa', label: 'فارسی' },
      ]}
    />
  );
};

export const Empty: Story = () => (
  <EmptyState
    title="A calm start"
    body="Your tasks, events and habits for the day will appear here."
    action={<Button>Add a task</Button>}
  />
);

export const SyncStatuses: Story = () => (
  <div className="flex flex-wrap gap-2">
    <SyncPill status="local" />
    <SyncPill status="synced" />
    <SyncPill status="syncing" />
    <SyncPill status="offline" />
    <SyncPill status="error" />
  </div>
);
