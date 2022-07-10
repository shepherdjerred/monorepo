import { Commentary, Video } from "../schema/schema";

export interface NotificationGroup<T> {
  identifier: string;
  content: T[];
}

export interface VideoNotification {
  groups: NotificationGroup<Video>[];
}

export interface CommentaryNotification {
  groups: NotificationGroup<Commentary>[];
}

export interface Notifier {
  notifyVideos: (notifications: VideoNotification) => Promise<undefined>;
  notifyCommentaries: (
    notifications: CommentaryNotification
  ) => Promise<undefined>;
}
