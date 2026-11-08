import { loadCorpus } from "./load.ts";
import {
  reportCorpusCase,
  corpusReport,
  type CorpusCaseReport,
} from "./report.ts";

/** Local boundary replay only: no provider, database, torrent client or filesystem mutation. */
export async function runCorpus(manifestPath: string, executable?: string) {
  const corpus = await loadCorpus(manifestPath);
  const reports: CorpusCaseReport[] = [];
  for (const entry of corpus.manifest.cases)
    reports.push(
      await reportCorpusCase(await corpus.readCase(entry), executable),
    );
  return corpusReport(corpus.manifest.corpusId, corpus.manifestHash, reports);
}
