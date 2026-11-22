import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ShellFrame, type ThemeStore } from "@shepherdjerred/console-ui";
import {
  normalizeShortSlug,
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
import { ShortcutsSection, type KindFilter } from "./directory-sections.tsx";
import {
  DeleteConfirmDialog,
  LinkFormDialog,
  MissingSlugBanner,
  showModalFromFocus,
  type FormMode,
} from "./link-dialogs.tsx";
import { LinksTable } from "./links-table.tsx";
import { GolinkHeader, MobileBar, SourcesSidebar } from "./shell.tsx";
import {
  bindFormValidation,
  focusFirstInvalidField,
  resetFormValidationState,
  syncShortInputValidity,
  syncTargetInputValidity,
} from "./validation.ts";

const INITIAL_SHORT_ERROR = "Enter a short link name, such as docs or ha.";
const INITIAL_TARGET_ERROR = "Enter an http:// or https:// destination URL.";

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
      <div className="golink-banner" data-sev="error" role="alert">
        <span>{loadError}</span>
        <button type="button" className="ui-btn" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (isInitialLoading) {
    return (
      <p className="golink-loading ui-muted" role="status" aria-live="polite">
        Loading shortlink directory…
      </p>
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

export function App({ theme }: { theme: ThemeStore }) {
  const initialMissing = useMemo(() => extractInitialMissingSlug(), []);

  const [directory, setDirectory] = useState<LinksDirectoryResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [missingSlug, setMissingSlug] = useState<string | null>(initialMissing);
  const [formMode, setFormMode] = useState<FormMode>({ kind: "create" });
  const [shortValue, setShortValue] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [shortErrorText, setShortErrorText] = useState(INITIAL_SHORT_ERROR);
  const [targetErrorText, setTargetErrorText] = useState(INITIAL_TARGET_ERROR);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [copiedShort, setCopiedShort] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LinkItem | null>(null);
  const [deletingShort, setDeletingShort] = useState<string | null>(null);

  const formElementRef = useRef<HTMLFormElement | null>(null);
  const shortInputRef = useRef<HTMLInputElement | null>(null);
  const targetInputRef = useRef<HTMLInputElement | null>(null);
  const formDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
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

  const openDialog = (mode: FormMode, short: string, target: string): void => {
    setFormMode(mode);
    setShortValue(short);
    setTargetValue(target);
    setShortErrorText(INITIAL_SHORT_ERROR);
    setTargetErrorText(INITIAL_TARGET_ERROR);
    setMutationError(null);
    setStatusMessage(null);
    setActionError(null);
    if (formElementRef.current !== null) {
      resetFormValidationState(formElementRef.current);
    }
    showModalFromFocus(formDialogRef.current);
    // The values above land on the next render; select once they have.
    globalThis.setTimeout(() => {
      const field =
        short === "" && mode.kind === "create"
          ? shortInputRef.current
          : targetInputRef.current;
      field?.focus();
      field?.select();
    }, 0);
  };

  const handleNewLink = (prefill = ""): void => {
    openDialog({ kind: "create" }, prefill, "");
  };

  const handleEditLink = (item: LinkItem): void => {
    openDialog({ kind: "edit", short: item.short }, item.short, item.targetUrl);
  };

  const handleOverrideLink = (item: LinkItem): void => {
    if (item.kind === "manual") {
      handleEditLink(item);
      return;
    }
    openDialog(
      {
        kind: "override",
        short: item.short,
        dynamicKind: item.kind,
        previousTargetUrl: item.targetUrl,
      },
      item.short,
      item.targetUrl,
    );
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
      isEditableElement(event.target) ||
      (event.target instanceof Element &&
        event.target.closest("dialog") !== null);
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
      formDialogRef.current?.close();
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

  const confirmDelete = async (): Promise<void> => {
    const item = pendingDelete;
    if (item === null || deletingShort !== null || !writesEnabled) {
      return;
    }
    setDeletingShort(item.short);
    setActionError(null);
    setStatusMessage(null);
    try {
      await deleteManualLink(item.short);
      setStatusMessage(`Deleted manual link go/${item.short}.`);
      await reloadDirectory();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : `Unable to delete go/${item.short}.`,
      );
    } finally {
      setDeletingShort(null);
      deleteDialogRef.current?.close();
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

  return (
    <div ref={shellRef} onKeyDownCapture={handleShellKeyDown}>
      <ShellFrame
        sidebar={
          <SourcesSidebar
            counts={counts}
            shortcutCount={shortcuts.length}
            kindFilter={kindFilter}
            theme={theme}
            onKindFilterChange={setKindFilter}
          />
        }
      >
        <MobileBar
          kindFilter={kindFilter}
          counts={counts}
          onKindFilterChange={setKindFilter}
        />

        <GolinkHeader
          query={query}
          searchInputRef={searchInputRef}
          viewerLogin={directory?.viewer.login ?? null}
          writesEnabled={writesEnabled}
          onQueryChange={setQuery}
          onNewLink={() => {
            handleNewLink();
          }}
        />
        <main>
          {activeMissingSlug !== null && (
            <MissingSlugBanner
              slug={activeMissingSlug}
              writesEnabled={writesEnabled}
              onCreate={() => {
                handleNewLink(activeMissingSlug);
              }}
              onDismiss={() => {
                setMissingSlug(null);
                clearUrlPathToRoot();
              }}
            />
          )}

          {actionError !== null && (
            <p className="golink-banner" data-sev="error" role="alert">
              {actionError}
            </p>
          )}
          <p
            role="status"
            aria-live="polite"
            className={statusMessage === null ? "ui-sr-only" : "golink-banner"}
            data-sev={statusMessage === null ? undefined : "ok"}
          >
            {statusMessage ?? ""}
          </p>

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
              setPendingDelete(item);
              showModalFromFocus(deleteDialogRef.current);
            }}
          />

          <ShortcutsSection shortcuts={shortcuts} />
        </main>
      </ShellFrame>

      <LinkFormDialog
        dialogRef={formDialogRef}
        formMode={formMode}
        writesEnabled={writesEnabled}
        shortValue={shortValue}
        targetValue={targetValue}
        shortErrorText={shortErrorText}
        targetErrorText={targetErrorText}
        isSubmitting={isSubmitting}
        mutationError={mutationError}
        formRef={formRef}
        shortInputRef={shortInputRef}
        targetInputRef={targetInputRef}
        onShortValueChange={setShortValue}
        onTargetValueChange={setTargetValue}
        onShortErrorChange={setShortErrorText}
        onTargetErrorChange={setTargetErrorText}
        onSubmit={() => {
          void submitUpsertForm();
        }}
      />
      <DeleteConfirmDialog
        dialogRef={deleteDialogRef}
        item={pendingDelete}
        isDeleting={deletingShort !== null}
        onConfirm={() => {
          void confirmDelete();
        }}
        onClose={() => {
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
