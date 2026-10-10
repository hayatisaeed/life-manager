import { createContext, useContext } from 'react';
import type { Services } from './services';

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices outside <ServicesContext>');
  return s;
}
