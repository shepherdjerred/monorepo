import {
  CommentaryNotification,
  Notifier,
  VideoNotification,
} from "./notification";

export class ConsoleNotifier implements Notifier {
  notifyCommentaries(notifications: CommentaryNotification) {
    return this.notify(notifications);
  }
  notifyVideos(notifications: VideoNotification) {
    return this.notify(notifications);
  }

  notify(
    notification: VideoNotification | CommentaryNotification
  ): Promise<undefined> {
    console.log(notification);
    return Promise.resolve(undefined);
  }
}
