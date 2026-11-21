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
