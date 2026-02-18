import { useState, useEffect } from "react";
import type { Session } from "@clauderon/client";
import { useSessionContext } from "@shepherdjerred/clauderon/web/frontend/src/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type EditSessionDialogProps = {
  session: Session;
  onClose: () => void;
};

export function EditSessionDialog({
  session,
  onClose,
}: EditSessionDialogProps) {
  const { updateSession, regenerateMetadata } = useSessionContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: session.title ?? session.name,
    description: session.description ?? "",
  });

  // Sync form data when session prop changes (e.g., after regeneration via WebSocket)
  ;

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await updateSession(session.id, formData.title, formData.description);
      toast.success("Session updated successfully");
      onClose();
    } catch (caughtError) {
      const errorMsg = caughtError instanceof Error ? caughtError.message : String(caughtError);
      setError(errorMsg);
      toast.error(`Failed to update session: ${errorMsg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerate = () => {
    setError(null);

    // Show initial toast and close modal immediately
    toast.info("Regenerating session metadata...");
    onClose();

    // Fire-and-forget operation
    void regenerateMetadata(session.id)
      .then(() => {
        toast.success("Session metadata regenerated");
      })
      .catch((caughtError: unknown) => {
        const errorMsg = caughtError instanceof Error ? caughtError.message : String(caughtError);
        toast.error(`Failed to regenerate metadata: ${errorMsg}`);
      });
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "hsl(220, 90%, 8%)",
          opacity: 0.85,
        }}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div
          className="max-w-2xl w-full flex flex-col border-4 border-primary"
          style={{
            backgroundColor: "hsl(220, 15%, 95%)",
            boxShadow:
              "12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-4 border-b-4 border-primary"
            style={{ backgroundColor: "hsl(220, 85%, 25%)" }}
          >
            <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">
              Edit Session
            </h2>
            <button
              onClick={onClose}
              className="p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all font-bold text-white"
              title="Close dialog"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={(e) => {
              void handleSubmit(e);
            }}
            className="p-6 space-y-6"
            style={{ backgroundColor: "hsl(220, 15%, 95%)" }}
          >
            {error != null && error.length > 0 && (
              <div
                className="p-4 border-4 font-mono"
                style={{
                  backgroundColor: "hsl(0, 75%, 95%)",
                  color: "hsl(0, 75%, 40%)",
                  borderColor: "hsl(0, 75%, 50%)",
                }}
              >
                <strong className="font-bold">ERROR:</strong> {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title" className="font-semibold">
                Title
              </Label>
              <input
                id="title"
                type="text"
                value={formData.title}
                onChange={(e) => {
                  setFormData({ ...formData, title: e.target.value });
                }}
                className="flex w-full rounded-md border-2 border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                placeholder="Enter session title"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="font-semibold">
                Description
              </Label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => {
                  setFormData({ ...formData, description: e.target.value });
                }}
                className="flex w-full rounded-md border-2 border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm min-h-[100px]"
                placeholder="Enter session description"
              />
            </div>

            {/* Regenerate with AI */}
            <div className="space-y-2">
              <Label className="font-semibold">AI Generation</Label>
              <div className="flex items-center gap-3 p-4 border-2 border-input rounded-md bg-muted/50">
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">
                    Regenerate title and description using AI based on the
                    initial prompt.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    handleRegenerate();
                  }}
                  disabled={isSubmitting}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Regenerate with AI
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t-4 border-primary">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="brutalist" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
