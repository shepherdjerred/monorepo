import { z } from "zod";
import { parseExecutionArguments as parseExecution } from "../replicas/preparation";

export function parseExecutionArguments(args: string[]) {
  const values = [...args];
  const take = (key: string) => {
    const index = values.indexOf(key);
    if (index === -1) return;
    const value = z
      .string()
      .min(1)
      .parse(values[index + 1]);
    values.splice(index, 2);
    return value;
  };
  const directory = take("--reference-archive");
  const hash = take("--reference-archive-sha256");
  if ((directory === undefined) !== (hash === undefined))
    throw new Error(
      "Reference archive path and SHA256 must be supplied together",
    );
  const parsed = parseExecution(values);
  const referenceArchive =
    directory === undefined
      ? undefined
      : {
          directory: z.string().startsWith("/").parse(directory),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .parse(hash),
        };
  if (referenceArchive !== undefined && parsed.vm === undefined)
    throw new Error(
      "Historical reference archives require headless guest execution",
    );
  return { ...parsed, referenceArchive };
}
