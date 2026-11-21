import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProviderListSchema, type ProviderStatus } from "#shared/admin.ts";
import { readApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { Badge, LoadError } from "#client/ui/feedback.tsx";
import { useSavedNotes } from "#client/ui/form.tsx";
import {
  Disclosure,
  DisclosureList,
  EmptyNote,
  Panel,
  SkeletonRows,
} from "#client/ui/panel.tsx";
import { LAST_ERRORS, PROVIDER_NAMES, ProviderForm } from "./provider-form.tsx";
import { CREDENTIAL_FIELDS } from "./provider-input.ts";

type Notes = ReturnType<typeof useSavedNotes>;

function ProviderRow({
  provider,
  notes,
}: {
  provider: ProviderStatus;
  notes: Notes;
}) {
  const headingId = useId();
  const needsCredential =
    (CREDENTIAL_FIELDS[provider.id] ?? []).length > 0 &&
    !provider.credentialConfigured;
  return (
    <Disclosure
      title={PROVIDER_NAMES[provider.id]}
      titleId={headingId}
      meta={
        <>
          {needsCredential && <Badge tone="warn">No sign-in details</Badge>}
          {provider.lastError !== null && (
            <Badge tone="danger">{LAST_ERRORS[provider.lastError]}</Badge>
          )}
          {provider.enabled ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>}
        </>
      }
    >
      <ProviderForm
        // A saved provider comes back with a new timestamp; start its form again.
        key={provider.updatedAt ?? "new"}
        provider={provider}
        headingId={headingId}
        saved={notes.note(provider.id)}
        onSaved={(message) => {
          notes.saved(provider.id, message);
        }}
        onEdit={() => {
          notes.edited(provider.id);
        }}
      />
    </Disclosure>
  );
}

function ProviderSection({
  title,
  description,
  loading,
  kind,
  providers,
  notes,
}: {
  title: string;
  description: string;
  loading: string;
  kind: ProviderStatus["kind"];
  providers: ReturnType<typeof useProviders>;
  notes: Notes;
}) {
  const listed = providers.data?.filter((provider) => provider.kind === kind);
  return (
    <Panel title={title} description={description}>
      {providers.isPending && <SkeletonRows label={loading} rows={4} />}
      {listed?.length === 0 && (
        <EmptyNote>This server has none set up.</EmptyNote>
      )}
      {listed !== undefined && listed.length > 0 && (
        <DisclosureList>
          {listed.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} notes={notes} />
          ))}
        </DisclosureList>
      )}
    </Panel>
  );
}

function useProviders() {
  return useQuery({
    queryKey: ["admin-providers"],
    queryFn: async () => readApi("/admin/providers", ProviderListSchema),
  });
}

export function ProvidersPage() {
  const providers = useProviders();
  return (
    <>
      <PageTitle title="Providers and seeding">
        <p>
          Where releases and subtitles come from, and how long each download
          keeps seeding.
        </p>
      </PageTitle>
      {providers.error !== null && (
        <Panel title="Providers">
          <LoadError
            what="Providers"
            error={providers.error}
            retry={() => {
              void providers.refetch();
            }}
          />
        </Panel>
      )}
      {providers.error === null && <ProviderLists providers={providers} />}
    </>
  );
}

function ProviderLists({
  providers,
}: {
  providers: ReturnType<typeof useProviders>;
}) {
  const notes = useSavedNotes();
  return (
    <>
      <ProviderSection
        title="Release trackers"
        description="Where Media looks for releases. Each tracker has its own request limit and its own rules for how long a download must seed."
        loading="Loading release trackers"
        kind="tracker"
        providers={providers}
        notes={notes}
      />
      <ProviderSection
        title="Subtitle sources"
        description="Where Media looks for subtitles a release did not come with."
        loading="Loading subtitle sources"
        kind="subtitle"
        providers={providers}
        notes={notes}
      />
    </>
  );
}
