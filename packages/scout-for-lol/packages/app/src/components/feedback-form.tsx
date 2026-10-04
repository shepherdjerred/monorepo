import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Textarea } from "@scout-for-lol/design-system/components/textarea";
import { Label } from "@scout-for-lol/design-system/components/label";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { track } from "#src/lib/analytics.ts";
import {
  DialogFormError,
  DialogFormFooter,
} from "#src/components/dialog-form.tsx";
import { FormPendingStatus } from "#src/components/semantic-form.tsx";

type Screenshot = {
  id: string;
  name: string;
  file: File | null;
  status: "uploading" | "ready" | "failed";
};
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(
        new Error("Could not read the screenshot. Please choose it again."),
      );
    });
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Screenshot could not be read."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    });
    reader.readAsDataURL(file);
  });
}

export function FeedbackForm(props: {
  onSubmitted: () => void;
  onCancel: () => void;
  page?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const submissionId = useRef(crypto.randomUUID());
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const features = useQuery(trpc.feedback.features.queryOptions());
  const conversation = useQuery(trpc.feedback.conversation.queryOptions({}));
  const upload = useMutation(
    trpc.feedback.uploadScreenshot.mutationOptions({ retry: false }),
  );
  const remove = useMutation(
    trpc.feedback.removeScreenshot.mutationOptions({ retry: false }),
  );
  const submit = useMutation(
    trpc.feedback.submit.mutationOptions({
      retry: false,
      onSuccess: async () => {
        formRef.current?.reset();
        await queryClient.invalidateQueries({
          queryKey: trpc.feedback.pathKey(),
        });
        track("feedback_submitted", {
          surface:
            props.page === "/app/feedback" ? "support-page" : "in-app-prompt",
        });
        setBody("");
        setScreenshots([]);
        submissionId.current = crypto.randomUUID();
        props.onSubmitted();
      },
      onError: (failure) => {
        setError(failure.message);
      },
    }),
  );
  useEffect(() => {
    if (!draftsHydrated && conversation.isError) {
      setDraftsHydrated(true);
      return;
    }
    if (
      draftsHydrated ||
      conversation.isFetching ||
      conversation.data === undefined
    )
      return;
    setScreenshots(
      conversation.data.drafts.map((draft) => ({
        id: draft.id,
        name: draft.name,
        file: null,
        status: draft.status === "STORED" ? "ready" : "failed",
      })),
    );
    setDraftsHydrated(true);
  }, [
    conversation.data,
    conversation.isError,
    conversation.isFetching,
    draftsHydrated,
  ]);
  const uploadFile = async (item: Screenshot) => {
    if (item.file === null) return;
    try {
      const base64 = await fileBase64(item.file);
      // The picker validated MIME; the server validates both MIME and bytes.
      if (
        item.file.type !== "image/png" &&
        item.file.type !== "image/jpeg" &&
        item.file.type !== "image/webp"
      )
        throw new Error("Unsupported screenshot type.");
      await upload.mutateAsync({
        id: item.id,
        name: item.file.name,
        contentType: item.file.type,
        base64,
      });
      await queryClient.invalidateQueries({
        queryKey: trpc.feedback.pathKey(),
      });
      setScreenshots((files) =>
        files.map((file) =>
          file.id === item.id ? { ...file, status: "ready" } : file,
        ),
      );
    } catch (error_) {
      setScreenshots((files) =>
        files.map((file) =>
          file.id === item.id ? { ...file, status: "failed" } : file,
        ),
      );
      setError(
        error_ instanceof Error
          ? error_.message
          : "Screenshot upload failed. Retry or remove it to send without an image.",
      );
    }
  };
  const uploading = screenshots.some((file) => file.status === "uploading");
  const uploadFiles = async (files: Screenshot[]) => {
    for (const file of files) await uploadFile(file);
  };
  const removeFile = async (id: string) => {
    try {
      await remove.mutateAsync({ id });
      await queryClient.invalidateQueries({
        queryKey: trpc.feedback.pathKey(),
      });
      setScreenshots((files) => files.filter((file) => file.id !== id));
      submissionId.current = crypto.randomUUID();
    } catch (error_) {
      setError(
        error_ instanceof Error
          ? error_.message
          : "Could not remove screenshot.",
      );
    }
  };
  return (
    <form
      ref={formRef}
      className="space-y-4"
      aria-busy={submit.isPending || uploading}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        if (
          !draftsHydrated ||
          screenshots.some((file) => file.status !== "ready")
        ) {
          setError("Retry or remove failed screenshots before sending.");
          return;
        }
        if (body.trim().length === 0 && screenshots.length === 0) {
          setError("Write a message or attach a screenshot.");
          return;
        }
        submit.mutate({
          body,
          submissionId: submissionId.current,
          attachmentIds: screenshots.map((file) => file.id),
          context: { page: props.page ?? "/app/dashboard" },
        });
      }}
    >
      <fieldset disabled={submit.isPending} className="space-y-4 border-0 p-0">
        <div className="space-y-2">
          <Label htmlFor={fieldId}>Your message</Label>
          <Textarea
            id={fieldId}
            value={body}
            rows={5}
            maxLength={4000}
            required={screenshots.length === 0}
            placeholder="What happened, what was confusing, or what would you like Scout to do?"
            onChange={(event) => {
              setBody(event.target.value);
              submissionId.current = crypto.randomUUID();
              setError(null);
            }}
          />
        </div>
        {features.data?.conversations === true && (
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-files`}>Screenshots (optional)</Label>
            <input
              id={`${fieldId}-files`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={!draftsHydrated || uploading || screenshots.length >= 5}
              className="block w-full text-sm"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (
                  files.length + screenshots.length > 5 ||
                  files.some(
                    (file) =>
                      file.size > 10 * 1024 * 1024 ||
                      !["image/png", "image/jpeg", "image/webp"].includes(
                        file.type,
                      ),
                  )
                ) {
                  setError(
                    "Choose up to five PNG, JPEG, or WebP screenshots, 10 MiB or less each.",
                  );
                  return;
                }
                const added: Screenshot[] = files.map((file) => ({
                  id: crypto.randomUUID(),
                  name: file.name,
                  file,
                  status: "uploading",
                }));
                setScreenshots((current) => [...current, ...added]);
                setError(null);
                submissionId.current = crypto.randomUUID();
                void uploadFiles(added);
              }}
            />
            <p className="text-xs text-scout-subtle">
              Private to you and Scout&apos;s support team. Remove personal
              information you don&apos;t want to share.
            </p>
            {screenshots.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="break-all">
                  {item.name} —{" "}
                  {item.status === "ready"
                    ? "Uploaded"
                    : item.status === "failed"
                      ? "Upload failed"
                      : "Uploading…"}
                </span>
                {item.status === "failed" && item.file !== null && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      setScreenshots((files) =>
                        files.map((file) =>
                          file.id === item.id
                            ? { ...file, status: "uploading" }
                            : file,
                        ),
                      );
                      void uploadFile(item);
                    }}
                  >
                    Retry
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={item.status === "uploading" || remove.isPending}
                  onClick={() => {
                    void removeFile(item.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </fieldset>
      <DialogFormError error={error} />
      <FormPendingStatus pending={submit.isPending}>
        Saving your message…
      </FormPendingStatus>
      <DialogFormFooter
        onCancel={props.onCancel}
        pending={submit.isPending || uploading}
        submitLabel="Send message"
        pendingLabel={uploading ? "Uploading…" : "Saving…"}
      />
    </form>
  );
}
