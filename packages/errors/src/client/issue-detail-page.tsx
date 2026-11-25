import { Dialog } from "@base-ui/react/dialog";
import { Button, Field, HeaderBar } from "@shepherdjerred/console-ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type SyntheticEvent } from "react";
import { Link, useParams } from "react-router";
import {
  TrackerTriageEffortSchema,
  TrackerTriageImpactSchema,
  TrackerTriageUrgencySchema,
  type CreateTrackerIssueInput,
  type UpdateIssueStateInput,
} from "#shared/contract.ts";
import {
  createTrackerIssue,
  fetchEventDetail,
  fetchIssueDetail,
  fetchIssueEvents,
  queryKeys,
  updateIssueState,
} from "./api.ts";
import { IssueDetailView } from "./issue-detail-view.tsx";

function CreateTrackerIssueDialog({
  open,
  defaultTitle,
  isSubmitting,
  errorMessage,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly defaultTitle: string;
  readonly isSubmitting: boolean;
  readonly errorMessage: string | null;
  readonly onOpenChange: (next: boolean) => void;
  readonly onSubmit: (input: CreateTrackerIssueInput) => void;
}): React.JSX.Element {
  const [title, setTitle] = useState(defaultTitle);
  const [urgency, setUrgency] =
    useState<CreateTrackerIssueInput["urgency"]>("medium");
  const [impact, setImpact] =
    useState<CreateTrackerIssueInput["impact"]>("medium");
  const [effort, setEffort] = useState<CreateTrackerIssueInput["effort"]>("s");

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    onSubmit({
      ...(trimmedTitle.length > 0 ? { title: trimmedTitle } : {}),
      urgency,
      impact,
      effort,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="er-dialog-backdrop" />
        <Dialog.Popup className="er-dialog">
          <div>
            <Dialog.Title className="er-dialog-title">
              Create Tracker AI Issue
            </Dialog.Title>
            <Dialog.Description className="er-dialog-desc">
              Files a linked issue in Tracker team AI with stacktrace context.
            </Dialog.Description>
          </div>
          {errorMessage === null ? null : (
            <div className="er-banner" data-sev="error" role="alert">
              <span>{errorMessage}</span>
            </div>
          )}
          <form className="er-dialog-form" onSubmit={handleSubmit}>
            <Field label="Title">
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={title}
                  maxLength={300}
                  onChange={(event) => {
                    setTitle(event.currentTarget.value);
                  }}
                />
              )}
            </Field>
            <div className="er-dialog-row">
              <Field label="Urgency">
                {(control) => (
                  <select
                    {...control}
                    value={urgency}
                    onChange={(event) => {
                      const parsed = TrackerTriageUrgencySchema.safeParse(
                        event.currentTarget.value,
                      );
                      if (parsed.success) {
                        setUrgency(parsed.data);
                      }
                    }}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                )}
              </Field>
              <Field label="Impact">
                {(control) => (
                  <select
                    {...control}
                    value={impact}
                    onChange={(event) => {
                      const parsed = TrackerTriageImpactSchema.safeParse(
                        event.currentTarget.value,
                      );
                      if (parsed.success) {
                        setImpact(parsed.data);
                      }
                    }}
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                )}
              </Field>
              <Field label="Effort">
                {(control) => (
                  <select
                    {...control}
                    value={effort}
                    onChange={(event) => {
                      const parsed = TrackerTriageEffortSchema.safeParse(
                        event.currentTarget.value,
                      );
                      if (parsed.success) {
                        setEffort(parsed.data);
                      }
                    }}
                  >
                    <option value="xs">XS</option>
                    <option value="s">S</option>
                    <option value="m">M</option>
                    <option value="l">L</option>
                    <option value="xl">XL</option>
                  </select>
                )}
              </Field>
            </div>
            <div className="er-dialog-actions">
              <Dialog.Close className="ui-btn" data-variant="default">
                Cancel
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Create AI Issue"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function IssueDetailPage(): React.JSX.Element {
  const params = useParams();
  const issueId = params["id"] ?? "";
  const selectedEventId = params["eventId"];
  const queryClient = useQueryClient();

  const [trackerDialogOpen, setTrackerDialogOpen] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const copyTimerRef = useRef<
    ReturnType<typeof globalThis.setTimeout> | undefined
  >(undefined);

  const issueQuery = useQuery({
    queryKey: queryKeys.issue(issueId),
    queryFn: ({ signal }) => fetchIssueDetail(issueId, signal),
    enabled: issueId.length > 0,
  });

  const eventsQuery = useQuery({
    queryKey: queryKeys.issueEvents(issueId),
    queryFn: ({ signal }) => fetchIssueEvents(issueId, { limit: 50 }, signal),
    enabled: issueId.length > 0,
  });

  const specificEventQuery = useQuery({
    queryKey: queryKeys.event(selectedEventId ?? ""),
    queryFn: ({ signal }) => fetchEventDetail(selectedEventId ?? "", signal),
    enabled: selectedEventId !== undefined && selectedEventId.length > 0,
  });

  const stateMutation = useMutation({
    mutationFn: (input: UpdateIssueStateInput) =>
      updateIssueState(issueId, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.issue(issueId), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issuesRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
    },
  });

  const trackerMutation = useMutation({
    mutationFn: (input: CreateTrackerIssueInput) =>
      createTrackerIssue(issueId, input),
    onSuccess: async () => {
      setTrackerDialogOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issuesRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });

  if (issueQuery.isPending) {
    return (
      <main>
        <title>Issue · Errors</title>
        <HeaderBar title="Issue" />
        <p className="er-state" role="status">
          Loading issue…
        </p>
      </main>
    );
  }

  if (issueQuery.isError) {
    return (
      <main>
        <title>Issue not found · Errors</title>
        <HeaderBar title="Issue" />
        <div className="er-banner" data-sev="error" role="alert">
          <span>{issueQuery.error.message}</span>
          <Link className="ui-btn" data-variant="default" to="/issues">
            Back to issues
          </Link>
        </div>
      </main>
    );
  }

  const issue = issueQuery.data;
  const activeEvent =
    selectedEventId === undefined
      ? issue.latestEvent
      : (specificEventQuery.data ?? issue.latestEvent);
  const defaultTrackerTitle =
    issue.value.length > 0 ? `${issue.type}: ${issue.value}` : issue.type;

  const handleCopyMarkdown = (): void => {
    if (activeEvent === null || activeEvent.stacktraceMd.length === 0) {
      return;
    }
    void (async () => {
      try {
        await globalThis.navigator.clipboard.writeText(
          activeEvent.stacktraceMd,
        );
        setCopiedMd(true);
        if (copyTimerRef.current !== undefined) {
          globalThis.clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = globalThis.setTimeout(() => {
          setCopiedMd(false);
        }, 1800);
      } catch {
        // Ignore clipboard errors cleanly.
      }
    })();
  };

  return (
    <>
      <IssueDetailView
        issue={issue}
        activeEvent={activeEvent}
        events={eventsQuery.data?.items ?? []}
        isMutating={stateMutation.isPending || trackerMutation.isPending}
        copiedMarkdown={copiedMd}
        actionError={stateMutation.isError ? stateMutation.error.message : null}
        onUpdateState={(nextState) => {
          stateMutation.mutate({
            state: nextState,
            expectedRevision: issue.revision,
          });
        }}
        onOpenCreateTrackerDialog={() => {
          setTrackerDialogOpen(true);
        }}
        onCopyMarkdown={handleCopyMarkdown}
      />
      <CreateTrackerIssueDialog
        key={`${issue.id}-${String(trackerDialogOpen)}`}
        open={trackerDialogOpen}
        defaultTitle={defaultTrackerTitle}
        isSubmitting={trackerMutation.isPending}
        errorMessage={
          trackerMutation.isError ? trackerMutation.error.message : null
        }
        onOpenChange={setTrackerDialogOpen}
        onSubmit={(input) => {
          trackerMutation.mutate(input);
        }}
      />
    </>
  );
}
