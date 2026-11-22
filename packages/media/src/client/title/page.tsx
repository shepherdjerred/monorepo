import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import { CatalogDetailSchema } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { readApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { useTarget } from "#client/target-controls/api.ts";
import { ProtectionControls } from "#client/target-controls/protection.tsx";
import { BackLink } from "./back.tsx";
import { CatalogTitle } from "./catalog-title.tsx";
import { LibraryTitle } from "./library-title.tsx";
import { mediaPath, readMedia } from "./seasons.tsx";
import { TitleFailure, TitleNotFound, TitleSkeleton } from "./states.tsx";

/**
 * A title the reader asked for but may not open: their Plex access does not
 * reach it. Nothing about the title is shown, but the request is theirs to
 * keep.
 */
function RequestOnly({
  user,
  context,
}: {
  user: MediaUser;
  context: DefaultTargetView;
}) {
  return (
    <>
      <BackLink />
      <PageTitle title="Your request">
        <p>
          Media cannot show you this title with your current Plex access. Your
          request for it still stands, and you can keep it from here.
        </p>
      </PageTitle>
      <ProtectionControls user={user} context={context} />
    </>
  );
}

function LibraryTitlePage({ user, id }: { user: MediaUser; id: string }) {
  const target = useTarget(id);
  const item = useQuery({
    queryKey: ["media", id],
    queryFn: () => readMedia(id),
    refetchInterval: 15_000,
  });
  const refresh = () => {
    void Promise.all([item.refetch(), target.refetch()]);
  };
  if (target.error !== null) {
    return <TitleFailure error={target.error} onRetry={refresh} />;
  }
  if (target.data === undefined) return <TitleSkeleton />;
  if (target.data.access === "protection_only") {
    return <RequestOnly user={user} context={target.data} />;
  }
  if (item.error !== null) {
    return <TitleFailure error={item.error} onRetry={refresh} />;
  }
  if (item.data === undefined) return <TitleSkeleton />;
  return (
    <LibraryTitle
      user={user}
      media={item.data}
      context={target.data}
      onRefresh={refresh}
    />
  );
}

/**
 * `/media/:id`: a film, series, season or episode the household has. The
 * server writes this address into emails and notifications.
 */
export function MediaTitlePage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  if (id === undefined) return <TitleNotFound />;
  // Keyed by title, so nothing a page holds carries over to the next one.
  return <LibraryTitlePage key={id} user={user} id={id} />;
}

/**
 * `/catalog/:kind/:id`: a film or series by its catalog identity. One the
 * household already has is shown on its own page; any other can be asked
 * for from here.
 */
export function CatalogTitlePage({ user }: { user: MediaUser }) {
  const { kind, id } = useParams();
  const valid =
    (kind === "movie" || kind === "series") &&
    id !== undefined &&
    /^\d+$/u.test(id);
  const detail = useQuery({
    queryKey: ["catalog-detail", kind, id],
    enabled: valid,
    queryFn: async () =>
      readApi(`/catalog/${String(kind)}/${String(id)}`, CatalogDetailSchema),
  });
  if (!valid) return <TitleNotFound />;
  if (detail.error !== null) {
    return (
      <TitleFailure
        error={detail.error}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  if (detail.data === undefined) return <TitleSkeleton />;
  const { library } = detail.data;
  return library === null ? (
    <CatalogTitle key={`${kind}:${id}`} user={user} item={detail.data} />
  ) : (
    <Navigate to={mediaPath(library.mediaId)} replace />
  );
}
