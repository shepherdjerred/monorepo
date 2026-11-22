import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type AnnounceFn = (message: string) => void;

const LiveAnnouncerContext = createContext<AnnounceFn>(() => {
  // Default no-op outside provider
});

export function LiveAnnouncerProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [announcement, setAnnouncement] = useState("");

  const announce = useCallback((message: string) => {
    setAnnouncement((previous) =>
      previous === message ? `${message}\u{A0}` : message,
    );
  }, []);

  return (
    <LiveAnnouncerContext.Provider value={announce}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="visually-hidden"
      >
        {announcement}
      </div>
    </LiveAnnouncerContext.Provider>
  );
}

export function useAnnounce(): AnnounceFn {
  return useContext(LiveAnnouncerContext);
}
