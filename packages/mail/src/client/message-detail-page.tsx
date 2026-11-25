import {
  Button,
  HeaderBar,
  Tabs,
  type TabOption,
} from "@shepherdjerred/console-ui";
import {
  formatMailClientLabel,
  type AdminMessageDetail,
} from "@shepherdjerred/mail/shared/contract.ts";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import {
  MailApiError,
  useAdminMessageDetail,
  useRetryMessageMutation,
} from "./api.ts";
import {
  defaultDetailTab,
  detailDocumentTitle,
  formatBytes,
  syncDocumentTitle,
  type DetailTab,
} from "./format.ts";
import {
  AttemptsTable,
  HeadersTable,
  MessageMetaGrid,
} from "./message-detail-parts.tsx";

function describeDetailError(error: unknown): {
  readonly isNotFound: boolean;
  readonly message: string;
} {
  if (error instanceof MailApiError) {
    return {
      isNotFound: error.status === 404,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      isNotFound: false,
      message: error.message,
    };
  }
  return {
    isNotFound: false,
    message: "Unable to load message details.",
  };
}

export function MessageDetailView({
  detail,
  isRetrying,
  retryNotice,
  retryError,
  initialTab,
  onRetry,
}: {
  readonly detail: AdminMessageDetail;
  readonly isRetrying: boolean;
  readonly retryNotice: string | null;
  readonly retryError: string | null;
  readonly initialTab?: DetailTab;
  readonly onRetry: () => void;
}): React.JSX.Element {
  const fallbackTab = defaultDetailTab(detail);
  const [selectedTab, setSelectedTab] = useState<DetailTab | undefined>(
    initialTab,
  );
  const activeTab = selectedTab ?? fallbackTab;

  const canRetry = detail.status === "failed" || detail.status === "retrying";
  const headerMeta = `${formatMailClientLabel(detail.clientId)} · ${detail.protocol.toUpperCase()} · ${formatBytes(detail.sizeBytes)}`;
  const subjectText =
    detail.subject.length > 0 ? detail.subject : "(no subject)";

  const tabOptions: readonly TabOption<DetailTab>[] = useMemo(
    () => [
      { value: "plain", label: "Plain text" },
      { value: "html", label: "HTML preview" },
      {
        value: "diagnostics",
        label: "Headers & attempts",
        count: detail.attempts.length,
      },
    ],
    [detail.attempts.length],
  );

  return (
    <>
      <div className="mail-back-bar">
        <Link className="mail-back-link" to="/">
          ← Outbox
        </Link>
      </div>

      <HeaderBar
        title={subjectText}
        meta={headerMeta}
        actions={
          canRetry ? (
            <Button variant="primary" disabled={isRetrying} onClick={onRetry}>
              {isRetrying ? "Queueing retry…" : "Retry delivery"}
            </Button>
          ) : undefined
        }
      />

      <p
        role="status"
        aria-live="polite"
        className={retryNotice === null ? "ui-sr-only" : "mail-banner"}
        data-sev={retryNotice === null ? undefined : "ok"}
      >
        {retryNotice ?? ""}
      </p>

      {retryError === null ? null : (
        <div className="mail-banner" data-sev="error" role="alert">
          <span>{retryError}</span>
        </div>
      )}

      <MessageMetaGrid detail={detail} />

      <section
        className="mail-inspector"
        aria-label="Message payload and diagnostics"
      >
        <div className="mail-tabs-bar">
          <Tabs
            label="Message payload and diagnostics"
            options={tabOptions}
            value={activeTab}
            onChange={setSelectedTab}
          />
        </div>

        <div
          role="tabpanel"
          aria-label="Plain text"
          hidden={activeTab !== "plain"}
        >
          <div className="mail-tabpanel-body">
            {detail.plainBody !== null && detail.plainBody.length > 0 ? (
              <pre className="mail-plain-body">{detail.plainBody}</pre>
            ) : (
              <p className="ui-muted">
                No plain-text body was submitted for this message.
              </p>
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          aria-label="HTML preview"
          hidden={activeTab !== "html"}
        >
          <div className="mail-tabpanel-body">
            {detail.htmlBody !== null && detail.htmlBody.length > 0 ? (
              <iframe
                className="mail-html-preview"
                title={`HTML email preview: ${subjectText}`}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={detail.htmlBody}
              />
            ) : (
              <p className="ui-muted">
                No HTML body was submitted for this message.
              </p>
            )}
          </div>
        </div>

        <div
          role="tabpanel"
          aria-label="Headers & attempts"
          hidden={activeTab !== "diagnostics"}
        >
          <div className="mail-tabpanel-body mail-diagnostics-stack">
            <AttemptsTable attempts={detail.attempts} />
            <HeadersTable headers={detail.headers} />
          </div>
        </div>
      </section>
    </>
  );
}

export function MessageDetailPage(): React.JSX.Element {
  const { id = "" } = useParams();
  const detailQuery = useAdminMessageDetail(id);
  const retryMutation = useRetryMessageMutation(id);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const pageTitle = detailDocumentTitle(detailQuery.data?.subject);
  syncDocumentTitle(pageTitle);

  const handleRetry = (): void => {
    setRetryNotice(null);
    retryMutation.mutate(undefined, {
      onSuccess: (response) => {
        setRetryNotice(
          `Queued message ${response.message.id} for immediate delivery retry.`,
        );
      },
    });
  };

  const retryError =
    retryMutation.error instanceof Error
      ? retryMutation.error.message
      : retryMutation.isError
        ? "Unable to retry message delivery."
        : null;

  if (detailQuery.isError) {
    const described = describeDetailError(detailQuery.error);
    return (
      <main className="mail-page">
        <title>{pageTitle}</title>
        <div className="mail-back-bar">
          <Link className="mail-back-link" to="/">
            ← Outbox
          </Link>
        </div>
        <HeaderBar
          title={
            described.isNotFound ? "Message not found" : "Message unavailable"
          }
        />
        <div className="mail-banner" data-sev="error" role="alert">
          <span>{described.message}</span>
          {described.isNotFound ? null : (
            <Button
              onClick={() => {
                void detailQuery.refetch();
              }}
            >
              Retry
            </Button>
          )}
        </div>
      </main>
    );
  }

  if (detailQuery.data === undefined) {
    return (
      <main className="mail-page">
        <title>{pageTitle}</title>
        <div className="mail-back-bar">
          <Link className="mail-back-link" to="/">
            ← Outbox
          </Link>
        </div>
        <HeaderBar title="Loading message…" />
        <p className="mail-state ui-muted" role="status" aria-live="polite">
          Loading message details…
        </p>
      </main>
    );
  }

  return (
    <main className="mail-page">
      <title>{pageTitle}</title>
      <MessageDetailView
        key={detailQuery.data.id}
        detail={detailQuery.data}
        isRetrying={retryMutation.isPending}
        retryNotice={retryNotice}
        retryError={retryError}
        onRetry={handleRetry}
      />
    </main>
  );
}
