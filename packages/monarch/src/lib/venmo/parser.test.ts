import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { parseVenmoCSV } from "./parser.ts";
import path from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = path.join(homedir(), ".monarch-cache");
const CACHE_FILE = path.join(CACHE_DIR, "venmo.json");

const tmpFiles: string[] = [];

async function removeFile(filePath: string): Promise<void> {
  const file = Bun.file(filePath);
  if (await file.exists()) {
    await Bun.spawn(["rm", "-f", filePath]).exited;
  }
}

async function writeTempCSV(name: string, content: string): Promise<string> {
  const filePath = path.join(CACHE_DIR, name);
  tmpFiles.push(filePath);
  await Bun.write(filePath, content);
  return filePath;
}

const SAMPLE_CSV = `Username,jerred-shepherd
Phones,1234567890
,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (tax),Amount (fee),Tax Rate,Tax Exempt,Funding Source,Destination,Beginning Balance,Ending Balance,Statement Period Venmo Fees,Terminal Location,Year to Date Venmo Fees,Disclaimer
,,,,,,,,,,,,,,,,,$1234.56,$1234.56,$0.00,,$0.00,
,4276717296868096443,2025-02-26T17:53:50,Payment,Complete,It's not stealing if I give you money ;),Mark Steinke,Jerred Shepherd,+ $100.00,,0,,0,,,Venmo balance,,,,Venmo,,
,4279880990171236238,2025-03-03T02:39:32,Payment,Complete,La dive,Jerred Shepherd,Nikita Zolotykh,- $25.75,,0,$0.75,0,,Visa *2418,,,,,Venmo,,
,9999999999999999999,2025-03-05T10:00:00,Standard Transfer,Complete,,,Jerred Shepherd,- $500.00,,0,,0,,,,,,,,
,8888888888888888888,2025-03-06T12:00:00,Credit Card Reward,Complete,,,Jerred Shepherd,+ $5.00,,0,,0,,,,,,,,
`;

describe("parseVenmoCSV", () => {
  beforeEach(async () => {
    await removeFile(CACHE_FILE);
  });

  afterEach(async () => {
    await removeFile(CACHE_FILE);
    for (const f of tmpFiles) {
      await removeFile(f);
    }
    tmpFiles.length = 0;
  });

  test("parses payment transactions from CSV", async () => {
    const tmpPath = await writeTempCSV("test-venmo.csv", SAMPLE_CSV);
    const transactions = await parseVenmoCSV(tmpPath);

    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.id).toBe("4276717296868096443");
    expect(transactions[0]?.type).toBe("Payment");
    expect(transactions[1]?.id).toBe("4279880990171236238");
    expect(transactions[1]?.type).toBe("Payment");
  });

  test("parses positive amount correctly", async () => {
    const tmpPath = await writeTempCSV("test-venmo2.csv", SAMPLE_CSV);
    const transactions = await parseVenmoCSV(tmpPath);

    expect(transactions[0]?.amount).toBe(100);
  });

  test("parses negative amount correctly", async () => {
    const tmpPath = await writeTempCSV("test-venmo3.csv", SAMPLE_CSV);
    const transactions = await parseVenmoCSV(tmpPath);

    expect(transactions[1]?.amount).toBe(-25.75);
  });

  test("parses fee amount correctly", async () => {
    const tmpPath = await writeTempCSV("test-venmo4.csv", SAMPLE_CSV);
    const transactions = await parseVenmoCSV(tmpPath);

    expect(transactions[1]?.fee).toBe(0.75);
  });

  test("filters out non-Payment types", async () => {
    const tmpPath = await writeTempCSV("test-venmo5.csv", SAMPLE_CSV);
    const transactions = await parseVenmoCSV(tmpPath);

    for (const txn of transactions) {
      expect(txn.type).toBe("Payment");
    }

    expect(transactions).toHaveLength(2);
  });

  test("preserves note with special characters", async () => {
    const tmpPath = await writeTempCSV("test-venmo6.csv", SAMPLE_CSV);
    const transactions = await parseVenmoCSV(tmpPath);

    expect(transactions[0]?.note).toBe(
      "It's not stealing if I give you money ;)",
    );
    expect(transactions[1]?.note).toBe("La dive");
  });

  test("handles note with commas in quoted fields", async () => {
    const csvWithQuotes = `Username,jerred-shepherd
Phones,1234567890
,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (tax),Amount (fee),Tax Rate,Tax Exempt,Funding Source,Destination,Beginning Balance,Ending Balance,Statement Period Venmo Fees,Terminal Location,Year to Date Venmo Fees,Disclaimer
,,,,,,,,,,,,,,,,,$0.00,$0.00,$0.00,,$0.00,
,1111111111111111111,2025-04-01T12:00:00,Payment,Complete,"Dinner, drinks, and tip",Alice Bob,Carol Dave,- $50.00,,0,,0,,,,,,,,
`;
    const tmpPath = await writeTempCSV("test-venmo7.csv", csvWithQuotes);
    const transactions = await parseVenmoCSV(tmpPath);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.note).toBe("Dinner, drinks, and tip");
  });
});
