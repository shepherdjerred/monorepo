import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { UndoToast } from "../components/common/UndoToast";
import { activeUndoEntry, undoStackReducer } from "../domain/undo-stack";

type UndoRequest = {
  message: string;
  onUndo: () => Promise<boolean>;
};

type UndoContextValue = {
  /** Pushes a request onto the transient completion-undo stack. */
  showUndo: (request: UndoRequest) => void;
  active: ReturnType<typeof activeUndoEntry>;
  depth: number;
  undoInFlight: boolean;
  dismiss: () => void;
  handleUndo: () => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const parent = useContext(UndoContext);
  if (parent !== null) {
    return <UndoHost value={parent}>{children}</UndoHost>;
  }
  return <UndoStateProvider>{children}</UndoStateProvider>;
}

function UndoStateProvider({ children }: { children: React.ReactNode }) {
  const [stack, dispatch] = useReducer(undoStackReducer, []);
  const [undoInFlight, setUndoInFlight] = useState(false);
  const nextId = useRef(0);
  const active = activeUndoEntry(stack);

  const showUndo = useCallback((request: UndoRequest) => {
    nextId.current += 1;
    dispatch({
      type: "push",
      entry: { id: nextId.current, ...request },
    });
  }, []);

  const dismiss = useCallback(() => {
    dispatch({ type: "clear" });
  }, []);

  const handleUndo = useCallback(() => {
    if (active === null || undoInFlight) return;
    const entry = active;
    setUndoInFlight(true);
    void (async () => {
      try {
        if (await entry.onUndo()) {
          dispatch({ type: "remove", id: entry.id });
        }
      } finally {
        setUndoInFlight(false);
      }
    })();
  }, [active, undoInFlight]);

  const value = useMemo(
    () => ({
      showUndo,
      active,
      depth: stack.length,
      undoInFlight,
      dismiss,
      handleUndo,
    }),
    [active, dismiss, handleUndo, showUndo, stack.length, undoInFlight],
  );

  return (
    <UndoContext.Provider value={value}>
      <UndoHost value={value}>{children}</UndoHost>
    </UndoContext.Provider>
  );
}

function UndoHost({
  children,
  value,
}: {
  readonly children: React.ReactNode;
  readonly value: UndoContextValue;
}) {
  return (
    <View style={styles.host}>
      {children}
      <UndoToast
        visible={value.active !== null}
        requestId={value.active?.id ?? null}
        depth={value.depth}
        message={value.active?.message ?? ""}
        undoInFlight={value.undoInFlight}
        onUndo={value.handleUndo}
        onDismiss={value.dismiss}
      />
    </View>
  );
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    throw new Error("useUndo must be used within UndoProvider");
  }
  return ctx;
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
});
