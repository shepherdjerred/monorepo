import { MoreVertical, RefreshCw, Key, Zap } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { ExperienceLevel } from "@clauderon/shared";

type Operation = {
  id: string;
  label: string;
  icon: React.ReactNode;
  description?: string;
  onClick: () => void;
  visibleFrom: ExperienceLevel;
  dangerous?: boolean;
};

type OperationsDropdownProps = {
  experienceLevel: ExperienceLevel;
  sessionId: string;
  isDockerBackend: boolean;
  onRefresh?: () => void;
  onRegenerateMetadata?: () => void;
  onUpdateAccessMode?: () => void;
  onTrackAdvancedOperation?: () => void;
};

/**
 * Dropdown menu for session operations
 * Adapts visibility based on user experience level
 */
export function OperationsDropdown({
  experienceLevel,
  isDockerBackend,
  onRefresh,
  onRegenerateMetadata,
  onUpdateAccessMode,
  onTrackAdvancedOperation,
}: OperationsDropdownProps) {
  const operations: Operation[] = [
    {
      id: "refresh",
      label: "Refresh Container",
      icon: <RefreshCw className="h-4 w-4" />,
      description: "Pull latest image and recreate container",
      onClick: () => {
        onTrackAdvancedOperation?.();
        onRefresh?.();
      },
      visibleFrom: "Regular",
    },
    {
      id: "regenerate-metadata",
      label: "Regenerate Metadata",
      icon: <Zap className="h-4 w-4" />,
      description: "Use AI to regenerate title and description",
      onClick: () => {
        onTrackAdvancedOperation?.();
        onRegenerateMetadata?.();
      },
      visibleFrom: "Advanced",
    },
    {
      id: "access-mode",
      label: "Change Access Mode",
      icon: <Key className="h-4 w-4" />,
      description: "Switch between ReadWrite and ReadOnly",
      onClick: () => {
        onTrackAdvancedOperation?.();
        onUpdateAccessMode?.();
      },
      visibleFrom: "Advanced",
    },
  ];

  // Filter operations based on experience level and conditions
  const visibleOperations = operations.filter((op) => {
    // Check experience level
    if (experienceLevel === "FirstTime") {
      return false; // FirstTime users see no dropdown operations
    }
    if (experienceLevel === "Regular" && op.visibleFrom === "Advanced") {
      return false; // Regular users don't see Advanced operations
    }

    // Additional filters
    if (op.id === "refresh" && !isDockerBackend) {
      return false; // Refresh only for Docker
    }

    return true;
  });

  // Don't render if no operations are visible
  if (visibleOperations.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label="More operations"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visibleOperations.map((op) => (
          <DropdownMenuItem key={op.id} onClick={op.onClick}>
            <div className="flex items-center gap-2">
              {op.icon}
              <div>
                <div className="font-medium">{op.label}</div>
                {op.description && (
                  <div className="text-xs text-gray-600">{op.description}</div>
                )}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
