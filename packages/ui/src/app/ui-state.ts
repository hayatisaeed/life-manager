// Transient UI state (Zustand). Data lives in SQLite via live queries.

import { create } from 'zustand';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  moreOpen: boolean;
  setMoreOpen: (v: boolean) => void;
  captureOpen: boolean;
  captureText: string;
  openCapture: (text?: string) => void;
  closeCapture: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  moreOpen: false,
  setMoreOpen: (v) => set({ moreOpen: v }),
  captureOpen: false,
  captureText: '',
  openCapture: (text = '') => set({ captureOpen: true, captureText: text }),
  closeCapture: () => set({ captureOpen: false, captureText: '' }),
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),
}));
