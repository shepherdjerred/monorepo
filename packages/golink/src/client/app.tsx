import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  normalizeShortSlug,
  validateShortSlug,
  type LinkItem,
  type LinksDirectoryResponse,
} from "#shared/contract.ts";
import {
  deleteManualLink,
  fetchLinksDirectory,
  saveManualLink,
} from "./api.ts";
import {
  clearUrlPathToRoot,
  computeKindCounts,
  extractInitialMissingSlug,
  isEditableElement,
  matchesSearchAndKind,
} from "./directory-filters.ts";
import {
  DirectoryHeader,
  SearchFilterBar,
  ShortcutsSection,
  type KindFilter,
} from "./directory-sections.tsx";
import { LinksTable } from "./links-table.tsx";
import {
  MissingSlugBanner,
  UpsertFormCard,
  type FormMode,
} from "./upsert-form-card.tsx";
import {
  bindFormValidation,
  focusFirstInvalidField,
  resetFormValidationState,
  syncShortInputValidity,
  syncTargetInputValidity,
} from "./validation.ts";

function DirectoryBody({
  loadError,
  isInitialLoading,
  items,
  totalCount,
  writesEnabled,
  copiedShort,
  deletingShort,
  onRetry,
  onCopy,
  onEdit,
  onOverride,
  onDelete,
}: {
  loadError: string | null;
  isInitialLoading: boolean;
  items: readonly LinkItem[];
  totalCount: number;
  writesEnabled: boolean;
  copiedShort: string | null;
  deletingShort: string | null;
  onRetry: () => void;
  onCopy: (short: string) => void;
  onEdit: (item: LinkItem) => void;
  onOverride: (item: LinkItem) => void;
  onDelete: (item: LinkItem) => void;
}) {
  if (loadError !== null) {
    return (
      <div className="feedback-banner feedback-error" role="alert">
        <span>{loadError}</span>
        <button
          type="button"
          className="btn btn-secondary btn-row"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    );
  }
  if (isInitialLoading) {
    return (
      <div className="loading-card" role="status" aria-live="polite">
        Loading shortlink directory…
      </div>
    );
  }
  return (
    <LinksTable
      items={items}
      totalCount={totalCount}
      writesEnabled={writesEnabled}
      copiedShort={copiedShort}
      deletingShort={deletingShort}
      onCopy={onCopy}
      onEdit={onEdit}
      onOverride={onOverride}
      onDelete={onDelete}
    />
  );
}

export function App() {
  const initialMissing = useMemo(() => extractInitialMissingSlug(), []);

  const [directory, setDirectory] = useState<LinksDirectoryResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [missingSlug, setMissingSlug] = useState<string | null>(initialMissing);
  const [formMode, setFormMode] = useState<FormMode>({ kind: "create" });
  const [shortValue, setShortValue] = useState<string>(() =>
    initialMissing !== null && validateShortSlug(initialMissing) === null
      ? initialMissing
      : "",
  );
  const [targetValue, setTargetValue] = useState("");
  const [shortErrorText, setShortErrorText] = useState(
    "Enter a short link name, such as docs or ha.",
  );
  const [targetErrorText, setTargetErrorText] = useState(
    "Enter an http:// or https:// destination URL.",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [copiedShort, setCopiedShort] = useState<string | null>(null);
  const [deletingShort, setDeletingShort] = useState<string | null>(null);

  const formElementRef = useRef<HTMLFormElement | null>(null);
  const shortInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasAutoFocusedMissingRef = useRef(false);
  const copyResetTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(undefined);

  const reloadDirectory = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const response = await fetchLinksDirectory(signal);
      setDirectory(response);
      setIsLoading(false);
    } catch (error) {
      if (signal?.aborted === true) {
        return;
      }
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to load shortlink directory.",
      );
      setIsLoading(false);
    }
  }, []);

  const shellRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        return;
      }
      const controller = new AbortController();
      void reloadDirectory(controller.signal);

      return () => {
        controller.abort();
        if (copyResetTimerRef.current !== undefined) {
          globalThis.clearTimeout(copyResetTimerRef.current);
        }
      };
    },
    [reloadDirectory],
  );

  const formRef = useCallback((node: HTMLFormElement | null) => {
    formElementRef.current = node;
    if (node === null) {
      return;
    }
    return bindFormValidation(node);
  }, []);

  const targetRefCallback = useCallback(
    (node: HTMLInputElement | null) => {
      targetInputRef.current = node;
      if (
        node !== null &&
        initialMissing !== null &&
        !hasAutoFocusedMissingRef.current &&
        !node.disabled
      ) {
        hasAutoFocusedMissingRef.current = true;
        node.focus();
      }
    },
    [initialMissing],
  );

  const writesEnabled = directory?.writesEnabled ?? true;
  const links = useMemo(() => directory?.links ?? [], [directory]);
  const shortcuts = directory?.shortcuts ?? [];
  const counts = useMemo(() => computeKindCounts(links), [links]);

  const activeMissingSlug = useMemo(() => {
    return missingSlug === null ||
      links.some((item) => item.short === missingSlug)
      ? null
      : missingSlug;
  }, [links, missingSlug]);

  const filteredLinks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return links.filter((item) =>
      matchesSearchAndKind(item, normalizedQuery, kindFilter),
    );
  }, [kindFilter, links, query]);

  const resetFormToCreate = (): void => {
    setFormMode({ kind: "create" });
    setShortValue("");
    setTargetValue("");
    setMutationError(null);
    if (formElementRef.current !== null) {
      resetFormValidationState(formElementRef.current);
    }
  };

  const scrollAndFocusTarget = (): void => {
    if (formElementRef.current !== null) {
      resetFormValidationState(formElementRef.current);
      formElementRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
    globalThis.setTimeout(() => {
      targetInputRef.current?.focus();
      targetInputRef.current?.select();
    }, 0);
  };

  const handleShellKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void => {
    const shouldIgnore =
      event.key !== "/" ||
      event.nativeEvent.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isEditableElement(event.target);
    if (shouldIgnore) {
      return;
    }
    event.preventDefault();
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };

  const submitUpsertForm = async (): Promise<void> => {
    const form = formElementRef.current;
    if (form === null || isSubmitting || !writesEnabled) {
      return;
    }
    if (shortInputRef.current !== null) {
      setShortErrorText(syncShortInputValidity(shortInputRef.current));
    }
    if (targetInputRef.current !== null) {
      setTargetErrorText(syncTargetInputValidity(targetInputRef.current));
    }
    if (!form.checkValidity()) {
      focusFirstInvalidField(form);
      return;
    }

    setIsSubmitting(true);
    setMutationError(null);
    setStatusMessage(null);

    try {
      const saved = await saveManualLink({
        short: normalizeShortSlug(shortValue),
        targetUrl: targetValue.trim(),
      });
      setMissingSlug(null);
      clearUrlPathToRoot();
      resetFormToCreate();
      setStatusMessage(`Saved go/${saved.short} → ${saved.targetUrl}`);
      await reloadDirectory();
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "Unable to save shortlink.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditLink = (item: LinkItem): void => {
    setMutationError(null);
    setStatusMessage(null);
    setFormMode({ kind: "edit", short: item.short });
    setShortValue(item.short);
    setTargetValue(item.targetUrl);
    scrollAndFocusTarget();
  };

  const handleOverrideLink = (item: LinkItem): void => {
    if (item.kind === "manual") {
      handleEditLink(item);
      return;
    }
    setMutationError(null);
    setStatusMessage(null);
    setFormMode({
      kind: "override",
      short: item.short,
      dynamicKind: item.kind,
      previousTargetUrl: item.targetUrl,
    });
    setShortValue(item.short);
    setTargetValue(item.targetUrl);
    scrollAndFocusTarget();
  };

  const handleDeleteLink = async (item: LinkItem): Promise<void> => {
    if (deletingShort !== null || !writesEnabled) {
      return;
    }
    setDeletingShort(item.short);
    setMutationError(null);
    setStatusMessage(null);
    try {
      await deleteManualLink(item.short);
      if (formMode.kind !== "create" && formMode.short === item.short) {
        resetFormToCreate();
      }
      setStatusMessage(`Deleted manual link go/${item.short}.`);
      await reloadDirectory();
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : `Unable to delete go/${item.short}.`,
      );
    } finally {
      setDeletingShort(null);
    }
  };

  const handleCopyLink = async (short: string): Promise<void> => {
    const shareUrl = new URL(
      `/${encodeURIComponent(short)}`,
      globalThis.location.origin,
    ).href;
    try {
      await globalThis.navigator.clipboard.writeText(shareUrl);
      setCopiedShort(short);
      if (copyResetTimerRef.current !== undefined) {
        globalThis.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = globalThis.setTimeout(() => {
        setCopiedShort(null);
      }, 1800);
    } catch {
      setStatusMessage(`Shortlink URL: ${shareUrl}`);
    }
  };

  const showCancelButton =
    formMode.kind !== "create" ||
    activeMissingSlug !== null ||
    shortValue.length > 0 ||
    targetValue.length > 0;

  return (
    <div
      ref={shellRef}
      className="golink-page"
      onKeyDownCapture={handleShellKeyDown}
    >
      <DirectoryHeader
        manualCount={counts.manual}
        dynamicCount={counts.all - counts.manual}
        shortcutCount={shortcuts.length}
        viewer={directory?.viewer ?? null}
        writesEnabled={writesEnabled}
      />

      <main className="golink-main">
        {activeMissingSlug !== null && (
          <MissingSlugBanner
            slug={activeMissingSlug}
            onDismiss={() => {
              setMissingSlug(null);
              clearUrlPathToRoot();
            }}
          />
        )}

        <UpsertFormCard
          formMode={formMode}
          writesEnabled={writesEnabled}
          shortValue={shortValue}
          targetValue={targetValue}
          shortErrorText={shortErrorText}
          targetErrorText={targetErrorText}
          isSubmitting={isSubmitting}
          showCancelButton={showCancelButton}
          mutationError={mutationError}
          statusMessage={statusMessage}
          formRef={formRef}
          shortInputRef={shortInputRef}
          targetRefCallback={targetRefCallback}
          onShortValueChange={setShortValue}
          onTargetValueChange={setTargetValue}
          onShortErrorChange={setShortErrorText}
          onTargetErrorChange={setTargetErrorText}
          onSubmit={() => {
            void submitUpsertForm();
          }}
          onCancel={() => {
            setMissingSlug(null);
            clearUrlPathToRoot();
            resetFormToCreate();
          }}
        />

        <SearchFilterBar
          query={query}
          kindFilter={kindFilter}
          counts={counts}
          searchInputRef={searchInputRef}
          onQueryChange={setQuery}
          onKindFilterChange={setKindFilter}
        />

        <DirectoryBody
          loadError={loadError}
          isInitialLoading={isLoading && directory === null}
          items={filteredLinks}
          totalCount={links.length}
          writesEnabled={writesEnabled}
          copiedShort={copiedShort}
          deletingShort={deletingShort}
          onRetry={() => {
            setIsLoading(true);
            void reloadDirectory();
          }}
          onCopy={(short) => {
            void handleCopyLink(short);
          }}
          onEdit={handleEditLink}
          onOverride={handleOverrideLink}
          onDelete={(item) => {
            void handleDeleteLink(item);
          }}
        />

        <ShortcutsSection shortcuts={shortcuts} />
      </main>
    </div>
  );
}
