import {
  CommentaryNotification,
  Notifier,
  VideoNotification,
} from "./notification";

export class NullNotifier implements Notifier {
  notifyVideos(_notifications: VideoNotification): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  notifyCommentaries(
    _notifications: CommentaryNotification,
  ): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}
