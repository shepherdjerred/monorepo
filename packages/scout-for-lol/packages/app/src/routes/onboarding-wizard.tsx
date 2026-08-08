import { useEffect, useReducer, useRef, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { match } from "ts-pattern";
import { useTRPC } from "#src/lib/trpc.ts";
import type { OnboardingOutcome } from "@scout-for-lol/data";
import {
  reportOnboardingOutcome,
  reportOnboardingStep,
} from "#src/lib/funnel.ts";
import { Button } from "#src/components/ui/button.tsx";
import {
  initialOnboardingState,
  onboardingReducer,
  type OnboardingState,
} from "#src/lib/onboarding-steps.ts";
import { markOnboardingComplete } from "#src/lib/onboarding-storage.ts";
import { OnboardingInstallStep } from "#src/components/onboarding/onboarding-install-step.tsx";
import { OnboardingPickGuildStep } from "#src/components/onboarding/onboarding-pick-guild-step.tsx";
import { OnboardingConceptsStep } from "#src/components/onboarding/onboarding-concepts-step.tsx";
import { OnboardingSubscribeStep } from "#src/components/onboarding/onboarding-subscribe-step.tsx";
import { OnboardingDoneStep } from "#src/components/onboarding/onboarding-done-step.tsx";
import { OnboardingChooseExtraStep } from "#src/components/onboarding/onboarding-extras-choice-step.tsx";
import { OnboardingReportStep } from "#src/components/onboarding/onboarding-report-step.tsx";
import { OnboardingCompetitionStep } from "#src/components/onboarding/onboarding-competition-step.tsx";

export function OnboardingWizard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Arriving from the post-install /installed page (?guild=…) skips the
  // install + pick-guild steps and lands on concepts (step 2).
  const [state, dispatch] = useReducer(
    onboardingReducer,
    searchParams.get("guild"),
    (guild): OnboardingState =>
      guild === null
        ? initialOnboardingState
        : {
            step: "concepts",
            selectedGuildId: guild,
            selectedExampleId: null,
            // Deep-linked in from /installed — no pick-guild step was shown,
            // so back from concepts goes to install.
            conceptsBack: "install",
          },
  );
  const guildId = state.selectedGuildId;
  // Whether the core flow was ever finished, for exit-outcome classification.
  const reachedDone = useRef(false);

  // Funnel: record each onboarding step as it is reached (fires on the initial
  // step and every transition). `step` is a bounded enum — low cardinality.
  useEffect(() => {
    if (state.step === "done") {
      reachedDone.current = true;
    }
    reportOnboardingStep(state.step);
  }, [state.step]);

  const meQuery = useQuery(
    trpc.auth.sessionState.queryOptions(undefined, { retry: false }),
  );
  const guildsQuery = useQuery(trpc.guild.listManageable.queryOptions());
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: guildId ?? "" },
      { enabled: guildId !== null },
    ),
  );
  const subsQuery = useQuery(
    trpc.subscription.list.queryOptions(
      { guildId: guildId ?? "" },
      { enabled: guildId !== null },
    ),
  );

  const guilds = guildsQuery.data ?? [];
  const channels = channelsQuery.data ?? [];
  // subscription.list is paginated ({ items, nextCursor }); the onboarding
  // wizard only needs the first page's items for its "tracking so far" list.
  const subs = subsQuery.data?.items ?? [];

  function complete(outcome: OnboardingOutcome): void {
    const user = meQuery.data?.user ?? null;
    if (user !== null) {
      markOnboardingComplete(user.discordId);
    }
    reportOnboardingOutcome(outcome);
  }

  // Leaving from "Skip setup" only counts as abandonment if the user never got
  // as far as the done step. The steps after `done` (report/competition) are
  // optional extras, so skipping those is a finished setup, not a dropout.
  function outcomeForExit(): OnboardingOutcome {
    return reachedDone.current ? "completed" : "skipped";
  }

  function finish(outcome: OnboardingOutcome): void {
    complete(outcome);
    void navigate(guildId === null ? "/" : `/g/${guildId}/subscriptions`);
  }
  function finishTo(path: string): void {
    complete("completed");
    void navigate(path);
  }
  function skip(): void {
    finish(outcomeForExit());
  }
  function finishCompleted(): void {
    finish("completed");
  }

  function requireGuild(render: (gid: string) => ReactElement): ReactElement {
    if (guildId === null) {
      return (
        <div className="mx-auto max-w-2xl space-y-3 py-8">
          <p className="text-sm text-destructive">No server selected.</p>
          <Button
            onClick={() => {
              dispatch({ type: "goto", step: "install" });
            }}
          >
            Back to start
          </Button>
        </div>
      );
    }
    return render(guildId);
  }

  return match(state.step)
    .with("install", () => (
      <OnboardingInstallStep
        guildCount={guilds.length}
        isLoading={guildsQuery.isLoading}
        onRefresh={() => {
          void queryClient.invalidateQueries({
            queryKey: trpc.guild.listManageable.pathKey(),
          });
        }}
        onContinue={() => {
          const first = guilds[0];
          if (first === undefined) return;
          if (guilds.length === 1) {
            dispatch({ type: "select-guild", guildId: first.id });
          } else {
            dispatch({ type: "goto", step: "pick-guild" });
          }
        }}
        onSkip={skip}
      />
    ))
    .with("pick-guild", () => (
      <OnboardingPickGuildStep
        guilds={guilds}
        onSelect={(id) => {
          dispatch({ type: "select-guild", guildId: id });
        }}
        onBack={() => {
          dispatch({ type: "back" });
        }}
        onSkip={skip}
      />
    ))
    .with("concepts", () => (
      <OnboardingConceptsStep
        onNext={() => {
          dispatch({ type: "next" });
        }}
        onBack={() => {
          dispatch({ type: "back" });
        }}
        onSkip={skip}
      />
    ))
    .with("subscribe-self", () =>
      requireGuild((gid) => (
        <OnboardingSubscribeStep
          key={state.step}
          mode="self"
          guildId={gid}
          channels={channels}
          username={meQuery.data?.user?.username ?? ""}
          discordId={meQuery.data?.user?.discordId ?? ""}
          existingSubs={[]}
          onAdded={() => {
            void queryClient.invalidateQueries({
              queryKey: trpc.subscription.list.pathKey(),
            });
          }}
          onContinue={() => {
            dispatch({ type: "next" });
          }}
          onBack={() => {
            dispatch({ type: "back" });
          }}
          onSkip={skip}
        />
      )),
    )
    .with("subscribe-more", () =>
      requireGuild((gid) => (
        <OnboardingSubscribeStep
          key={state.step}
          mode="more"
          guildId={gid}
          channels={channels}
          username=""
          discordId=""
          existingSubs={subs.map((s) => ({
            alias: s.player.alias,
            channelId: s.channelId,
          }))}
          onAdded={() => {
            void queryClient.invalidateQueries({
              queryKey: trpc.subscription.list.pathKey(),
            });
          }}
          onContinue={() => {
            dispatch({ type: "next" });
          }}
          onBack={() => {
            dispatch({ type: "back" });
          }}
          onSkip={skip}
        />
      )),
    )
    .with("done", () => (
      <OnboardingDoneStep
        subCount={subs.length}
        onMore={() => {
          dispatch({ type: "goto", step: "choose-extra" });
        }}
        onFinish={finishCompleted}
        onBack={() => {
          dispatch({ type: "back" });
        }}
      />
    ))
    .with("choose-extra", () => (
      <OnboardingChooseExtraStep
        onChoose={(extra, exampleId) => {
          dispatch({ type: "choose", extra, exampleId });
        }}
        onBack={() => {
          dispatch({ type: "back" });
        }}
        onSkip={skip}
      />
    ))
    .with("build-report", () =>
      requireGuild((gid) => (
        <OnboardingReportStep
          guildId={gid}
          channels={channels}
          exampleId={state.selectedExampleId}
          onCreated={(reportId) => {
            finishTo(`/g/${gid}/reports/${reportId.toString()}`);
          }}
          onBack={() => {
            dispatch({ type: "back" });
          }}
          onSkip={skip}
        />
      )),
    )
    .with("build-competition", () =>
      requireGuild((gid) => (
        <OnboardingCompetitionStep
          guildId={gid}
          channels={channels}
          exampleId={state.selectedExampleId}
          onCreated={(competitionId) => {
            finishTo(`/g/${gid}/competitions/${competitionId.toString()}`);
          }}
          onBack={() => {
            dispatch({ type: "back" });
          }}
          onSkip={skip}
        />
      )),
    )
    .exhaustive();
}
