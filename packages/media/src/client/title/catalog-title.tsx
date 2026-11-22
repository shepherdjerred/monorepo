import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { EllipsisIcon } from "lucide-react";
import { useNavigate } from "react-router";
import { z } from "zod";
import type { CatalogDetail } from "#shared/api.ts";
import type { MediaUser } from "#shared/contract.ts";
import { writeApi } from "#client/api.ts";
import { ErrorNotice } from "#client/components.tsx";
import { KIND_COPY } from "#client/presentation/state-phrase.ts";
import { languageName } from "#client/request-sheet/languages.ts";
import type { SheetSubject } from "#client/request-sheet/form.ts";
import { RequestSheet } from "#client/request-sheet/sheet.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Menu } from "#client/ui/menu.tsx";
import { BackLink } from "./back.tsx";
import { fullDate } from "./copy.ts";
import { Hero } from "./hero.tsx";
import { Facts, Section, type Fact } from "./household.tsx";
import { mediaPath } from "./seasons.tsx";
import styles from "./title.module.css";

const cx = classNames(styles);

const AdoptedSchema = z.object({ mediaId: z.string() });

/** A catalog date is a day with no time; an unreleased title may have none. */
const CATALOG_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function aboutFacts(item: CatalogDetail): Fact[] {
  return [
    ...(CATALOG_DATE.test(item.date)
      ? [
          {
            term: "First released",
            // Noon, so the day is the same in every time zone.
            detail: fullDate(`${item.date}T12:00:00Z`),
          },
        ]
      : []),
    {
      term: "Original language",
      detail: languageName(item.originalLanguage),
    },
  ];
}

/**
 * Opens a series in the library without asking for any of it, so that single
 * episodes can be asked for from their own pages.
 */
function useChooseEpisodes(user: MediaUser, item: CatalogDetail) {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/catalog/adopt",
        body: { kind: item.kind, externalId: item.externalId },
        schema: AdoptedSchema,
      }),
    onSuccess: (result) => {
      void navigate(mediaPath(result.mediaId));
    },
  });
}

/**
 * The page of a film or series the household does not have: what it is, and
 * the one thing to do with it, which is to ask for it. Once asked for, the
 * title is in the library and its own page takes over.
 */
export function CatalogTitle({
  user,
  item,
}: {
  user: MediaUser;
  item: CatalogDetail;
}) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);
  const target = { externalId: item.externalId };
  const subject: SheetSubject =
    item.kind === "movie"
      ? { kind: "movie", title: item.title, target }
      : {
          kind: "series",
          title: item.title,
          target,
          seasons: item.seasons.map((season) => ({
            seasonNumber: season.seasonNumber,
            title: season.title,
            episodeCount: season.episodeCount,
          })),
        };
  const year = item.date.slice(0, 4);
  const choose = useChooseEpisodes(user, item);
  return (
    <>
      <BackLink />
      <Hero
        title={item.title}
        artwork={{
          posterPath: item.posterPath,
          backdropPath: item.backdropPath,
        }}
        meta={[KIND_COPY[item.kind], ...(year.length === 4 ? [year] : [])]}
        state={{ label: "Not in the library", tone: "neutral" }}
        overview={item.overview}
      >
        <div className={cx("actions")}>
          <div className={cx("actionRow")}>
            <button
              className="button primary"
              type="button"
              onClick={() => {
                setAsking(true);
              }}
            >
              Request
            </button>
            {item.kind === "series" && (
              <Menu
                label="More actions"
                trigger={<EllipsisIcon aria-hidden="true" />}
                alignEndOnPhone
                disabled={choose.isPending || user.restricted}
                items={[
                  {
                    key: "episodes",
                    label: "Choose single episodes",
                    detail:
                      "Opens the series in the library, where each episode can be asked for by itself.",
                    onSelect: () => {
                      choose.mutate();
                    },
                  },
                ]}
              />
            )}
          </div>
          {choose.isPending && (
            <p className={cx("quiet")} role="status">
              Opening the series…
            </p>
          )}
          {choose.error !== null && <ErrorNotice error={choose.error} />}
        </div>
      </Hero>
      {asking && (
        <RequestSheet
          user={user}
          subject={subject}
          onRequested={(outcome) => {
            setRequested(outcome.mediaId);
          }}
          onClose={() => {
            setAsking(false);
            // The title is in the library now: its own page takes over.
            if (requested !== null) {
              void navigate(mediaPath(requested), { replace: true });
            }
          }}
        />
      )}
      <Section title="In your household">
        <p className={cx("quiet")}>
          {item.libraryAccess === "stale"
            ? "Media could not confirm your Plex access just now, so it cannot say whether the household already has this."
            : "Nobody in your household has asked for this yet."}
        </p>
      </Section>
      <Section title="About">
        <Facts facts={aboutFacts(item)} />
      </Section>
      {item.seasons.length > 0 && (
        <Section title="Seasons">
          <ul className={cx("rows")}>
            {item.seasons.map((season) => (
              <li className={cx("row")} key={season.externalId}>
                <span className={cx("rowText")}>{season.title}</span>
                <span className={cx("quiet")}>
                  {season.episodeCount}{" "}
                  {season.episodeCount === 1 ? "episode" : "episodes"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
