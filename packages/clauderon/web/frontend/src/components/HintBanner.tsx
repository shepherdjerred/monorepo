import { X } from "lucide-react";
import { Button } from "./ui/button";

type HintBannerProps = {
  hintId: string;
  message: string;
  onDismiss: (hintId: string) => void;
};

/**
 * Dismissible hint banner for first-time users
 * Appears at the top of the session list with contextual guidance
 */
export function HintBanner({ hintId, message, onDismiss }: HintBannerProps) {
  return (
    <div className="bg-blue-50 border-2 border-blue-800 p-4 mb-4 relative">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium text-blue-900">{message}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-blue-100"
          onClick={() => onDismiss(hintId)}
          aria-label="Dismiss hint"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
