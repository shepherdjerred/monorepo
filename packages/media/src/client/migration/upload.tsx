import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import {
  MAX_MIGRATION_BYTES,
  MigrationProposalSchema,
  MigrationSnapshotSchema,
} from "#shared/migration.ts";
import { queryClient, sessionBoundary, writeApi } from "#client/api.ts";
import { Form, FormFooter } from "#client/ui/forms/form.tsx";
import { TextField } from "#client/ui/forms/field.tsx";
import { Panel } from "#client/ui/panel.tsx";

export async function uploadMigrationCapture(
  actorId: string,
  file: File | null,
) {
  const session = sessionBoundary.capture(actorId);
  if (file === null) throw new Error("Choose a sanitized capture file");
  if (file.size > MAX_MIGRATION_BYTES)
    throw new Error("Capture exceeds the 24 MiB limit");
  const value: unknown = JSON.parse(await file.text());
  session.assertCurrent();
  const envelope = z
    .object({ snapshot: MigrationSnapshotSchema })
    .safeParse(value);
  const snapshot = envelope.success
    ? envelope.data.snapshot
    : MigrationSnapshotSchema.parse(value);
  return writeApi({
    actorId,
    path: "/admin/migration",
    body: { snapshot },
    schema: MigrationProposalSchema,
    sensitive: true,
  });
}

function chosenFile(form: HTMLFormElement): File | null {
  const file = new FormData(form).get("capture");
  return file instanceof File && file.name !== "" ? file : null;
}

/** Step 1: send Media a read-only capture of one existing manager. */
export function UploadCapture({
  actorId,
  onSaved,
}: {
  actorId: string;
  onSaved: (id: string) => void;
}) {
  const headingId = useId();
  const upload = useMutation({
    mutationFn: async (file: File) => uploadMigrationCapture(actorId, file),
    onSuccess: async (proposal) => {
      onSaved(proposal.id);
      await queryClient.invalidateQueries({ queryKey: ["migration"] });
    },
  });
  return (
    <Panel
      id="capture"
      title="1. Add a capture"
      description={
        <p>
          A capture is a read-only copy of what one of your existing managers
          holds. Make it with the migration inventory CLI, which writes
          sanitized JSON: credentials, private download links, and contact
          details are rejected. Sending it changes nothing; every record in it
          stays unowned.
        </p>
      }
    >
      <h3 className="sr-only" id={headingId}>
        Capture file
      </h3>
      <Form
        labelledBy={headingId}
        validate={(form) => {
          const file = chosenFile(form);
          return file !== null && file.size > MAX_MIGRATION_BYTES
            ? { capture: "Choose a capture no larger than 24 MiB." }
            : {};
        }}
        onSubmit={(form) => {
          const file = chosenFile(form);
          if (file !== null) upload.mutate(file);
        }}
      >
        <TextField
          label="Capture JSON"
          description="A .json file from the inventory CLI, up to 24 MiB."
          name="capture"
          type="file"
          accept="application/json,.json"
          required
          requiredMessage="Choose the capture file."
        />
        <FormFooter
          submitLabel="Upload and compare"
          pendingLabel="Checking capture…"
          pending={upload.isPending}
          error={upload.error}
          saved={
            upload.isSuccess
              ? "Capture saved. Review the comparison in step 2."
              : null
          }
          note="Media compares the capture with the library and saves it. Nothing is adopted."
        />
      </Form>
    </Panel>
  );
}
