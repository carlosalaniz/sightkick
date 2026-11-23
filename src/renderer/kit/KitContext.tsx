import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import { usePersisted } from '../hooks/usePersisted';
import { DEFAULT_KITS } from './constants';
import { KitDefs } from './KitSvg';
import { KitState, parseKitState } from './storedKits';
import { Kit } from './types';

interface KitContextValue {
  kits: Kit[];
  /** The kit every kit screen uses. */
  kit: Kit;
  selectKit: (id: string) => void;
  /** Replaces the current kit (pass an updater for read-modify-write). */
  updateKit: (next: Kit | ((kit: Kit) => Kit)) => void;
  createKit: () => Kit;
  deleteKit: (id: string) => void;
}

const STORAGE_KEY = 'settings.kits';
const INITIAL: KitState = { kits: DEFAULT_KITS, currentId: DEFAULT_KITS[0].id };
const KitContext = createContext<KitContextValue | null>(null);

export function KitProvider({ children }: { children: ReactNode }) {
  const [state, setState] = usePersisted<KitState>(
    STORAGE_KEY,
    INITIAL,
    parseKitState,
  );
  const kits = state.kits.length > 0 ? state.kits : DEFAULT_KITS;
  const kit = kits.find((k) => k.id === state.currentId) ?? kits[0];
  const selectKit = useCallback(
    (id: string) => setState((s) => ({ ...s, currentId: id })),
    [setState],
  );
  const updateKit = useCallback(
    (next: Kit | ((k: Kit) => Kit)) =>
      setState((s) => {
        const list = s.kits.length > 0 ? s.kits : DEFAULT_KITS;
        const current = list.find((k) => k.id === s.currentId) ?? list[0];
        const updated = typeof next === 'function' ? next(current) : next;

        return {
          ...s,
          kits: list.map((k) => (k.id === current.id ? updated : k)),
        };
      }),
    [setState],
  );
  const createKit = useCallback(() => {
    const created: Kit = {
      id: `kit-${Date.now().toString(36)}`,
      name: 'New kit',
      kind: 'electronic',
      pieces: [],
      controls: {},
    };

    setState((s) => ({ kits: [...s.kits, created], currentId: created.id }));

    return created;
  }, [setState]);
  const deleteKit = useCallback(
    (id: string) =>
      setState((s) => {
        const remaining = s.kits.filter((k) => k.id !== id);
        const list = remaining.length > 0 ? remaining : DEFAULT_KITS;

        return {
          kits: list,
          currentId: s.currentId === id ? list[0].id : s.currentId,
        };
      }),
    [setState],
  );
  const value = useMemo(
    () => ({ kits, kit, selectKit, updateKit, createKit, deleteKit }),
    [kits, kit, selectKit, updateKit, createKit, deleteKit],
  );

  return (
    <KitContext.Provider value={value}>
      <KitDefs />
      {children}
    </KitContext.Provider>
  );
}

export function useKit(): KitContextValue {
  const ctx = useContext(KitContext);

  if (!ctx) {
    throw new Error('useKit must be used within KitProvider');
  }

  return ctx;
}
