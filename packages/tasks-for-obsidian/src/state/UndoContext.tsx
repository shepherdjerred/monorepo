import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { UndoToast } from "../components/common/UndoToast";

type UndoRequest = {
  message: string;
  onUndo: () => void;
};

type UndoContextValue = {
  /** Replaces any currently-showing toast. */
  showUndo: (request: UndoRequest) => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<UndoRequest | null>(null);
  // A monotonically increasing key so a replacement toast restarts the
  // UndoToast timer effect even when `visible` never flips false.
  const generation = useRef(0);

  const showUndo = useCallback((request: UndoRequest) => {
    generation.current += 1;
    setActive(request);
  }, []);

  const dismiss = useCallback(() => {
    setActive(null);
  }, []);

  const handleUndo = useCallback(() => {
    active?.onUndo();
    setActive(null);
  }, [active]);

  const value = useMemo(() => ({ showUndo }), [showUndo]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      <UndoToast
        key={generation.current}
        visible={active !== null}
        message={active?.message ?? ""}
        onUndo={handleUndo}
        onDismiss={dismiss}
      />
    </UndoContext.Provider>
  );
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    throw new Error("useUndo must be used within UndoProvider");
  }
  return ctx;
}
