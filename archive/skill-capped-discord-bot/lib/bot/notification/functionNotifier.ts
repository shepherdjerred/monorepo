import {
  CommentaryNotification,
  Notifier,
  VideoNotification,
} from "./notification";

export class FunctionNotifier implements Notifier {
  readonly fn: (
    notifications: CommentaryNotification | VideoNotification,
  ) => Promise<undefined>;

  constructor(
    fn: (
      notifications: CommentaryNotification | VideoNotification,
    ) => Promise<undefined>,
  ) {
    this.fn = fn;
  }

  notifyVideos(notifications: VideoNotification): Promise<undefined> {
    return this.fn(notifications);
  }

  notifyCommentaries(
    notifications: CommentaryNotification,
  ): Promise<undefined> {
    return this.fn(notifications);
  }
}
