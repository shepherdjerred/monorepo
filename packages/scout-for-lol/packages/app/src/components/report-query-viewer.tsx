import { formatScoutQl } from "@scout-for-lol/data/model/scoutql/format.ts";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";

/**
 * A saved query, shown rather than edited.
 *
 * `formatScoutQl` returns a query holding error diagnostics unchanged, so a
 * row whose text no longer compiles is still displayed verbatim — highlighted
 * by the same tokenizer as the editor, with the unparseable part marked
 * invalid instead of vanishing.
 */
export function ReportQueryViewer(props: { queryText: string }) {
  return (
    <ScoutQlCode
      queryText={formatScoutQl(props.queryText)}
      className="max-h-[360px] overflow-y-auto whitespace-pre-wrap break-words"
    />
  );
}
