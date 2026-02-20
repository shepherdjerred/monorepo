import lodash from "lodash";
import type { Notification } from "#src/model/notification.ts";
import { Notification as NotificationElement } from "./notification.tsx";

export function Notifications({
  notifications,
  onClose,
}: {
  notifications: Notification[];
  onClose: (id: string) => void;
}) {
  const renderedNotifications = lodash.map(notifications, (notification) => {
    return (
      <div key={notification.id}>
        <NotificationElement
          title={notification.title}
          message={notification.message}
          level={notification.level}
          onClose={() => {
            onClose(notification.id);
          }}
        />
      </div>
    );
  });
  return (
    <div className="fixed top-0 right-0 w-1/4 flex flex-col gap-3 m-4">
      {renderedNotifications}
    </div>
  );
}
