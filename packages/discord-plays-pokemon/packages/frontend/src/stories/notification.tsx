import { match } from "ts-pattern";
import IconCheckMark from "~icons/ph/check-circle";
import IconError from "~icons/ph/x-circle";
import IconClose from "~icons/ph/x";
import IconWarning from "~icons/ph/warning-circle";
import IconInfo from "~icons/ph/info";
import type { Level } from "../model/notification";

export function Notification({
  title = "",
  message = "",
  dismissable = true,
  level,
  onClose,
}: {
  title?: string;
  message?: string;
  level?: Level;
  dismissable?: boolean;
  onClose: () => void;
}) {
  const icon = match(level)
    .with("Success", () => {
      return <IconCheckMark className="text-green-500" />;
    })
    .with("Info", () => {
      return <IconInfo className="text-blue-500" />;
    })
    .with("Warning", () => {
      return <IconWarning className="text-orange-500" />;
    })
    .with("Error", () => {
      return <IconError className="text-red-500" />;
    })
    .otherwise(() => {
      return null;
    });

  const dismissButton = match(dismissable)
    .with(true, () => {
      return (
        <button
          type="button"
          className="inline-flex rounded-md bg-white dark:bg-gray-900 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          onClick={onClose}
        >
          <span className="sr-only">Close</span>
          <IconClose />
        </button>
      );
    })
    .otherwise(() => null);

  return (
    <div className="flex w-full flex-col items-center space-y-4 sm:items-end">
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-lg bg-white dark:bg-gray-900 shadow-lg ring-1 ring-black ring-opacity-5">
        <div className="p-4">
          <div className="flex items-start">
            {icon}
            <div className="ml-3 w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-400">
                {title}
              </p>
              <p className="mt-1 text-sm text-gray-500">{message}</p>
            </div>
            <div className="ml-4 flex flex-shrink-0">{dismissButton}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
