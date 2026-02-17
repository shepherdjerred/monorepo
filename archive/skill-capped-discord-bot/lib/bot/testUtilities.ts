import { readFile } from "fs/promises";

export async function getTestData(file: string): Promise<string> {
  const result = await readFile("./data/test/" + file, "utf-8");
  return Promise.resolve(result);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTestJsonData(file: string): Promise<any> {
  const raw = await getTestData(file);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(raw);
}
