import { ChevronRightIcon } from "lucide-react";
import { z } from "zod";
import type { MediaDetail } from "#shared/api.ts";
import { languageName } from "#client/request-sheet/languages.ts";
import { classNames } from "#client/ui/class-names.ts";
import { fullDate } from "./copy.ts";
import styles from "./title.module.css";

const cx = classNames(styles);

type Asset = MediaDetail["assets"][number]["asset"];
type Subtitle = Asset["subtitles"][number];

/** What the API publishes about a file; every part of it is optional. */
const FilePropertiesSchema = z.object({
  quality: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  audioLanguages: z.array(z.string()).optional(),
  hdr: z.boolean().optional(),
});

const GIGABYTE = 1_000_000_000;

/** A file's size as a person would say it: "71.3 GB". */
export function fileSize(bytes: number, locale?: string): string {
  return `${(bytes / GIGABYTE).toLocaleString(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} GB`;
}

/** The picture, sound and size of a file, as the parts the API gave. */
export function fileSummary(properties: unknown, locale?: string): string[] {
  const parsed = FilePropertiesSchema.safeParse(properties);
  if (!parsed.success) return [];
  const { quality, hdr, audioLanguages, sizeBytes } = parsed.data;
  return [
    ...(quality === undefined
      ? []
      : [hdr === true ? `${quality}, HDR` : quality]),
    ...(audioLanguages === undefined || audioLanguages.length === 0
      ? []
      : [
          `${audioLanguages.map((code) => languageName(code)).join(", ")} audio`,
        ]),
    ...(sizeBytes === undefined ? [] : [fileSize(sizeBytes, locale)]),
  ];
}

/** A subtitle as its language and what kind it is. */
export function subtitleName(
  subtitle: Pick<Subtitle, "language" | "forced" | "hearingImpaired">,
): string {
  const language = languageName(subtitle.language);
  if (subtitle.forced === true) return `${language}, foreign dialogue only`;
  return subtitle.hearingImpaired === true
    ? `${language}, with sound descriptions`
    : language;
}

/** The subtitles that are in place and can be switched on in Plex. */
function installed(asset: Asset): string[] {
  return [
    ...new Set(
      asset.subtitles
        .filter((subtitle) => subtitle.state === "installed")
        .map((subtitle) => subtitleName(subtitle)),
    ),
  ];
}

/** The subtitle languages the household wants that this file still lacks. */
function wanted(asset: Asset): string[] {
  const status = asset.subtitleStatus;
  if (status === null) return [];
  return [
    ...new Set(
      [...status.missing, ...status.householdMissing].map((target) =>
        languageName(target.language),
      ),
    ),
  ];
}

function File({ current, asset }: { current: boolean; asset: Asset }) {
  const summary = fileSummary(asset.properties);
  const subtitles = installed(asset);
  const missing = wanted(asset);
  return (
    <li className={cx("file")}>
      <h3 className={cx("fileTitle")}>
        {current ? "The copy you watch" : "An earlier copy"}
      </h3>
      <p className={cx("quiet")}>
        Added {fullDate(asset.createdAt)}
        {summary.map((part) => (
          <span className={cx("filePart")} key={part}>
            {part}
          </span>
        ))}
      </p>
      {current && (
        <p className={cx("fileLine")}>
          {subtitles.length === 0
            ? "No subtitles yet."
            : `Subtitles: ${subtitles.join("; ")}.`}
          {missing.length > 0 &&
            ` Media is still looking for ${missing.join(" and ")}.`}
        </p>
      )}
    </li>
  );
}

/**
 * The files behind a title and their subtitles, closed until someone wants
 * to know. Nothing here can be acted on; it answers "which copy is this".
 */
export function Files({ media }: { media: MediaDetail }) {
  return (
    <details className={cx("disclosure")}>
      <summary className={cx("disclosureSummary")}>
        <ChevronRightIcon className={cx("chevron")} aria-hidden="true" />
        Files and subtitles
      </summary>
      {media.assets.length === 0 ? (
        <p className={cx("quiet")}>
          {media.kind === "series" || media.kind === "season"
            ? "Each episode lists its own file. Open an episode to see it."
            : "There is no file yet. It appears here once this is ready to watch."}
        </p>
      ) : (
        <ul className={cx("files")}>
          {media.assets.map(({ asset, current }) => (
            <File key={asset.id} current={current} asset={asset} />
          ))}
        </ul>
      )}
    </details>
  );
}
