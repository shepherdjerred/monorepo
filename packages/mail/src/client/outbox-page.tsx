import {
  Button,
  Field,
  FigureStrip,
  HeaderBar,
  StatusGlyph,
} from "@shepherdjerred/console-ui";
import {
  formatMailClientLabel,
  type AdminMessageSummary,
} from "@shepherdjerred/mail/shared/contract.ts";
import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { useAdminMessages, useAdminOverview } from "./api.ts";
import {
  buildOutboxFigures,
  buildOutboxSearchParams,
  formatPacificTimestamp,
  formatRecipientsCompact,
  formatRelayMeta,
  hasActiveOutboxFilter,
  messageStatusLabel,
  messageStatusSeverity,
  outboxDocumentTitle,
  outboxFilterHeading,
  parseOutboxFilter,
  syncDocumentTitle,
} from "./format.ts";
import { registerSearchInput } from "./nav-state.ts";

function OutboxTable({
  items,
  filtered,
}: {
  readonly items: readonly AdminMessageSummary[];
  readonly filtered: boolean;
}): React.JSX.Element {
  return (
    <div
      className="ui-table-scroll mail-table-wrap"
      role="region"
      aria-label="Outbound messages"
      tabIndex={0}
    >
      <table className="ui-table mail-table">
        <caption className="ui-sr-only">Outbound mail messages</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Subject</th>
            <th scope="col">Sender</th>
            <th scope="col">Recipient</th>
            <th scope="col" className="ui-num">
              Attempts
            </th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={6} className="mail-empty-cell ui-muted">
                {filtered
                  ? "No outbound messages match the current filter."
                  : "No outbound messages stored yet."}
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td data-label="Status">
                  <StatusGlyph
                    severity={messageStatusSeverity(item.status)}
                    label={messageStatusLabel(item.status)}
                  />
                </td>
                <th scope="row" className="ui-lead mail-subject-cell">
                  <Link
                    className="mail-subject-link"
                    to={`/messages/${encodeURIComponent(item.id)}`}
                  >
                    {item.subject.length > 0 ? item.subject : "(no subject)"}
                  </Link>
                  {item.tag === null ? null : (
                    <span className="mail-tag-inline ui-mono ui-muted">
                      {item.tag}
                    </span>
                  )}
                </th>
                <td data-label="Sender">
                  {formatMailClientLabel(item.clientId)}
                </td>
                <td
                  data-label="Recipient"
                  className="ui-mono mail-recipient-cell"
                  title={item.recipients.join(", ")}
                >
                  {formatRecipientsCompact(item.recipients)}
                </td>
                <td data-label="Attempts" className="ui-num ui-mono">
                  {item.attemptCount}
                </td>
                <td data-label="Updated" className="ui-mono ui-muted">
                  <time dateTime={item.updatedAt}>
                    {formatPacificTimestamp(item.updatedAt)}
                  </time>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function OutboxPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = useMemo(() => parseOutboxFilter(searchParams), [searchParams]);
  const heading = outboxFilterHeading(filter);
  const pageTitle = outboxDocumentTitle(filter);
  syncDocumentTitle(pageTitle);

  const overviewQuery = useAdminOverview();
  const messagesQuery = useAdminMessages(filter);

  const rawSearchValue = searchParams.get("q") ?? "";
  const isFiltered = hasActiveOutboxFilter(filter);

  const handleSearchChange = useCallback(
    (value: string) => {
      const next = buildOutboxSearchParams({
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.client === undefined ? {} : { client: filter.client }),
        ...(value.length > 0 ? { q: value } : {}),
      });
      setSearchParams(next, { replace: true });
    },
    [filter, setSearchParams],
  );

  const handleClearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const relayMeta =
    overviewQuery.data === undefined
      ? overviewQuery.isError
        ? "Relay status unavailable"
        : "Loading relay status…"
      : formatRelayMeta(overviewQuery.data.relay);

  const totalCount = messagesQuery.data?.total;
  const countLabel =
    totalCount === undefined
      ? "Loading…"
      : `${String(totalCount)} message${totalCount === 1 ? "" : "s"}`;

  return (
    <main className="mail-page">
      <title>{pageTitle}</title>
      <HeaderBar title={heading} meta={relayMeta} />

      {overviewQuery.data === undefined ? null : (
        <FigureStrip figures={buildOutboxFigures(overviewQuery.data)} />
      )}

      <div className="ui-toolbar mail-toolbar">
        <search aria-label="Search outbound messages" className="mail-search">
          <form
            action="/"
            method="get"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <Field label="Search" layout="inline">
              {(control) => (
                <input
                  {...control}
                  ref={registerSearchInput}
                  type="search"
                  name="q"
                  value={rawSearchValue}
                  placeholder="Recipient, subject, Message-ID, or tag"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={(event) => {
                    handleSearchChange(event.target.value);
                  }}
                />
              )}
            </Field>
          </form>
        </search>

        {isFiltered ? (
          <Button onClick={handleClearFilters}>Clear filters</Button>
        ) : null}

        <span className="ui-count mail-toolbar-count">{countLabel}</span>
      </div>

      {messagesQuery.isError ? (
        <div className="mail-banner" data-sev="error" role="alert">
          <span>
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "Unable to load outbound messages."}
          </span>
          <Button
            onClick={() => {
              void messagesQuery.refetch();
              void overviewQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      ) : messagesQuery.data === undefined ? (
        <p className="mail-state ui-muted" role="status" aria-live="polite">
          Loading outbound messages…
        </p>
      ) : (
        <OutboxTable items={messagesQuery.data.items} filtered={isFiltered} />
      )}
    </main>
  );
}
