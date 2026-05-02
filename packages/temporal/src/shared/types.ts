export type DnsCheckResult = {
  domain: string;
  parked: boolean;
  spf: DnsRecordResult;
  dmarc: DnsRecordResult;
  mx: DnsRecordResult;
};

export type DnsRecordResult = {
  status: "ok" | "warning" | "error";
  message: string;
};

export type GolinkEntry = {
  short: string;
  long: string;
  /**
   * Tailscale identity that owns the entry (`shepherdjerred@gmail.com`,
   * `tagged-devices`, etc). golink rejects updates from any identity other
   * than the owner with a 403, so the sync workflow uses this to skip
   * entries it doesn't own.
   */
  owner: string;
};
