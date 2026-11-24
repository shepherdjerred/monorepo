import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabDescriptor<K extends string> = {
  readonly id: K;
  readonly tabDomId: string;
  readonly label: string;
  readonly badge?: string | undefined;
};

export function TabListBar<K extends string>({
  ariaLabel,
  tabs,
  activeTab,
  onSelect,
}: {
  readonly ariaLabel: string;
  readonly tabs: readonly TabDescriptor<K>[];
  readonly activeTab: K;
  readonly onSelect: (tabId: K) => void;
}) {
  const buttonRefs = useRef(new Map<K, HTMLButtonElement>());

  function moveFocusAndSelect(targetIndex: number): void {
    const wrappedIndex =
      ((targetIndex % tabs.length) + tabs.length) % tabs.length;
    const target = tabs[wrappedIndex];
    if (target === undefined) {
      return;
    }
    onSelect(target.id);
    const btn = buttonRefs.current.get(target.id);
    if (btn !== undefined) {
      btn.focus();
      btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocusAndSelect(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocusAndSelect(index - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocusAndSelect(0);
        break;
      case "End":
        event.preventDefault();
        moveFocusAndSelect(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="tablist-bar">
      {tabs.map((tab, index) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node === null) {
                buttonRefs.current.delete(tab.id);
              } else {
                buttonRefs.current.set(tab.id, node);
              }
            }}
            type="button"
            role="tab"
            id={tab.tabDomId}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={(event) => {
              onSelect(tab.id);
              event.currentTarget.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              });
            }}
            onKeyDown={(event) => {
              handleKeyDown(event, index);
            }}
          >
            <span>{tab.label}</span>
            {tab.badge === undefined ? null : (
              <span className="pill pill-neutral">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function SearchableTabPanel({
  tabDomId,
  active,
  children,
}: {
  readonly tabDomId: string;
  readonly active: boolean;
  readonly onBeforeMatchActivate?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      aria-labelledby={tabDomId}
      hidden={active ? undefined : true}
    >
      <div className="tabpanel-inner">{children}</div>
    </div>
  );
}
