import type { AppRouter as ServerRouter } from "#server/router.ts";
import {
  ActorSchema as Actor,
  ActorMetadataSchema as Metadata,
} from "./actor.ts";
import {
  StateTypeSchema as StateType,
  UrgencySchema as UrgencyEnum,
  ImpactSchema as ImpactEnum,
  EffortSchema as EffortEnum,
  FilterUrgencySchema as FilterUrgencyEnum,
  FilterImpactSchema as FilterImpactEnum,
  FilterEffortSchema as FilterEffortEnum,
  IdentifierSchema as Identifier,
  TeamKeySchema as TeamKey,
  CreateIssueSchema as CreateIssue,
  UpdateIssueSchema as UpdateIssue,
  BulkUpdateIssuesSchema as BulkUpdateIssues,
  IssueListSchema as IssueList,
  DueDateSchema as DueDate,
  ViewParamsSchema as ViewParams,
  CreateViewSchema as CreateView,
  UpdateViewSchema as UpdateView,
} from "./schema.ts";
import type { CLIENT_REQUEST_ID_HEADER as ClientRequestIdHeader } from "./live-updates.ts";
import {
  LiveChangeSchema as LiveChange,
  LiveMessageSchema as LiveMessageUnion,
} from "./live-updates.ts";
import type { z } from "zod";
import {
  ForumKindSchema as ForumKind,
  ForumEmojiSchema as ForumEmoji,
  ForumIdentifierSchema as ForumIdentifier,
  ForumPostIdOrIdentifierSchema as ForumPostIdOrIdentifier,
  ForumSortSchema as ForumSort,
  ForumListSchema as ForumList,
  ForumReferenceSchema as ForumReference,
  CreateForumPostSchema as CreateForumPost,
  UpdateForumPostSchema as UpdateForumPost,
  ReplyForumSchema as ReplyForum,
  UpdateForumReplySchema as UpdateForumReply,
  DeleteForumReplySchema as DeleteForumReply,
  ResolveForumSchema as ResolveForum,
  ReopenForumSchema as ReopenForum,
  PinForumSchema as PinForum,
  AcceptForumReplySchema as AcceptForumReply,
  ClaimForumNoticeSchema as ClaimForumNotice,
  HandoffForumNoticeSchema as HandoffForumNotice,
  VoteForumSchema as VoteForum,
  ReactForumSchema as ReactForum,
  SubscribeForumSchema as SubscribeForum,
  MarkForumReadSchema as MarkForumRead,
  ForumIssueLinkSchema as ForumIssueLink,
  PromoteForumToIssueSchema as PromoteForumToIssue,
  ForumInboxSchema as ForumInbox,
} from "./forum.ts";

export const ForumKindSchema = ForumKind.clone();
export const ForumEmojiSchema = ForumEmoji.clone();
export const ForumIdentifierSchema = ForumIdentifier.clone();
export const ForumPostIdOrIdentifierSchema = ForumPostIdOrIdentifier.clone();
export const ForumSortSchema = ForumSort.clone();
export const ForumListSchema = ForumList.clone();
export const ForumReferenceSchema = ForumReference.clone();
export const CreateForumPostSchema = CreateForumPost.clone();
export const UpdateForumPostSchema = UpdateForumPost.clone();
export const ReplyForumSchema = ReplyForum.clone();
export const UpdateForumReplySchema = UpdateForumReply.clone();
export const DeleteForumReplySchema = DeleteForumReply.clone();
export const ResolveForumSchema = ResolveForum.clone();
export const ReopenForumSchema = ReopenForum.clone();
export const PinForumSchema = PinForum.clone();
export const AcceptForumReplySchema = AcceptForumReply.clone();
export const ClaimForumNoticeSchema = ClaimForumNotice.clone();
export const HandoffForumNoticeSchema = HandoffForumNotice.clone();
export const VoteForumSchema = VoteForum.clone();
export const ReactForumSchema = ReactForum.clone();
export const SubscribeForumSchema = SubscribeForum.clone();
export const MarkForumReadSchema = MarkForumRead.clone();
export const ForumIssueLinkSchema = ForumIssueLink.clone();
export const PromoteForumToIssueSchema = PromoteForumToIssue.clone();
export const ForumInboxSchema = ForumInbox.clone();

export type AppRouter = ServerRouter & { readonly __wireContract?: never };
export type ActorEnvelope = z.infer<typeof Actor>;
export const ActorSchema = Actor.clone();
export const ActorMetadataSchema = Metadata.clone();
export const StateTypeSchema = StateType.clone();
export const UrgencySchema = UrgencyEnum.clone();
export const ImpactSchema = ImpactEnum.clone();
export const EffortSchema = EffortEnum.clone();
export const FilterUrgencySchema = FilterUrgencyEnum.clone();
export const FilterImpactSchema = FilterImpactEnum.clone();
export const FilterEffortSchema = FilterEffortEnum.clone();
export type Urgency = z.infer<typeof UrgencyEnum>;
export type Impact = z.infer<typeof ImpactEnum>;
export type Effort = z.infer<typeof EffortEnum>;
export type FilterUrgency = z.infer<typeof FilterUrgencyEnum>;
export type FilterImpact = z.infer<typeof FilterImpactEnum>;
export type FilterEffort = z.infer<typeof FilterEffortEnum>;
export const IdentifierSchema = Identifier.clone();
export const TeamKeySchema = TeamKey.clone();
export const CreateIssueSchema = CreateIssue.clone();
export const UpdateIssueSchema = UpdateIssue.clone();
export const BulkUpdateIssuesSchema = BulkUpdateIssues.clone();
export const IssueListSchema = IssueList.clone();
export const DueDateSchema = DueDate.clone();
export const ViewParamsSchema = ViewParams.clone();
export const CreateViewSchema = CreateView.clone();
export const UpdateViewSchema = UpdateView.clone();
export type DueDate = z.infer<typeof DueDate>;
export type ViewParams = z.infer<typeof ViewParams>;
export const LiveChangeSchema = LiveChange.clone();
export const LiveMessageSchema = LiveMessageUnion.clone();
/** Its literal type makes the compiler hold it equal to the server's value. */
export const CLIENT_REQUEST_ID_HEADER: typeof ClientRequestIdHeader =
  "x-tracker-request-id";
export type LiveChange = z.infer<typeof LiveChange>;
export type LiveMessage = z.infer<typeof LiveMessageUnion>;
