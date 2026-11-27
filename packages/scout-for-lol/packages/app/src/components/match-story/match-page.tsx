import { Chip } from "@scout-for-lol/design-system/components/surfaces/chip";
import {
  PageLoading,
  PageState,
} from "@scout-for-lol/design-system/domain/profile/page-states";
import { MatchHero } from "./match-hero.tsx";
import { MatchLane } from "./match-lane.tsx";
import {
  friendsOf,
  heroText,
  laneResultOf,
  queueName,
  viewerOf,
  type MatchDetail,
  type MatchStory,
} from "./match-model.ts";
import { MatchBuild, MatchFriends } from "./match-people.tsx";
import { MatchTeams } from "./match-teams.tsx";
import { hasWent, MatchWent } from "./match-went.tsx";

export type StoryState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "done"; story: MatchStory };

function StorySlot(props: {
  state: StoryState;
  viewerTeamId: number;
  hasTimeline: boolean;
}) {
  const { state } = props;
  if (state.status === "loading") {
    return props.hasTimeline ? <PageLoading label="Loading the game" /> : null;
  }
  if (state.status === "error") {
    return (
      <PageState
        id="match-story-unavailable"
        kind="unavailable"
        title="How it went"
        lead="This part of the game is unavailable."
        actions={
          <Chip type="button" onClick={state.retry}>
            Retry
          </Chip>
        }
      />
    );
  }
  return <MatchWent story={state.story} viewerTeamId={props.viewerTeamId} />;
}

/**
 * The redesigned Match page: the result, the lane, how the game went, who was
 * with you, what you built and both teams. `detail` is everything the page
 * needs to be useful; `story` fills the timeline sections as it arrives.
 */
export function MatchPage(props: {
  detail: MatchDetail;
  story: StoryState;
  profilePath: string;
  now: number;
}) {
  const { match } = props.detail;
  const viewer = viewerOf(match);
  const lane = laneResultOf(match, viewer);
  const story = props.story.status === "done" ? props.story.story : undefined;
  const viewerStory =
    story === undefined || viewer.participantId === null
      ? undefined
      : story.participants.find(
          (participant) => participant.participantId === viewer.participantId,
        );
  const friends = match.remake ? [] : friendsOf(match, viewer);
  // The left column holds the lane and the timeline. When neither exists the
  // build and friends take the width instead of leaving it empty.
  const storyPending =
    props.story.status !== "done" && props.detail.timeline.coverage !== null;
  const wide =
    lane !== null || storyPending || (story !== undefined && hasWent(story));
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 sm:px-8 sm:py-12">
      <MatchHero
        viewer={viewer}
        profilePath={props.profilePath}
        text={heroText({
          match,
          viewer,
          queue: queueName(match.queue),
          now: props.now,
        })}
      />
      <div
        className={`grid items-start gap-6 ${wide ? "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : "lg:grid-cols-2"}`}
      >
        {wide ? (
          <div className="grid min-w-0 gap-6">
            {lane === null ? null : <MatchLane viewer={viewer} lane={lane} />}
            <StorySlot
              state={props.story}
              viewerTeamId={viewer.teamId}
              hasTimeline={props.detail.timeline.coverage !== null}
            />
          </div>
        ) : null}
        <div className={wide ? "grid min-w-0 gap-6" : "contents"}>
          <MatchFriends friends={friends} />
          <MatchBuild viewer={viewer} story={viewerStory} />
        </div>
      </div>
      <MatchTeams match={match} viewer={viewer} story={story} />
    </div>
  );
}
