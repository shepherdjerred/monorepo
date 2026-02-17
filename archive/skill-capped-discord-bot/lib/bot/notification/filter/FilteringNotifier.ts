import {
  CommentaryNotification,
  Notifier,
  VideoNotification,
} from "../notification";
import { NotificationSettings } from "../../configuration/config";

export class FilteringNotifier implements Notifier {
  readonly config: NotificationSettings;
  readonly delegate: Notifier;
  constructor(config: NotificationSettings, delegate: Notifier) {
    this.config = config;
    this.delegate = delegate;
  }

  notifyCommentaries(notification: CommentaryNotification) {
    if (this.config.sendCommentaries) {
      return this.delegate.notifyCommentaries(notification);
    } else {
      return Promise.resolve(undefined);
    }
  }

  notifyVideos(notification: VideoNotification) {
    if (this.config.sendVideos) {
      return this.delegate.notifyVideos(notification);
    } else {
      return Promise.resolve(undefined);
    }
  }
}
