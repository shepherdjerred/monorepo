import { Duration, Stack } from "aws-cdk-lib";
import {
  HostedZone,
  IHostedZone,
  MxRecord,
  TxtRecord,
} from "aws-cdk-lib/aws-route53";
export function createRecords(stack: Stack, hostedZone: IHostedZone) {
  new MxRecord(stack, "MxRecord", {
    zone: hostedZone,
    recordName: "ts-mc.net",
    ttl: Duration.minutes(5),
    values: [
      {
        priority: 1,
        hostName: "aspmx.l.google.com.",
      },
      {
        priority: 5,
        hostName: "alt1.aspmx.l.google.com.",
      },
      {
        priority: 5,
        hostName: "alt2.aspmx.l.google.com.",
      },
      {
        priority: 10,
        hostName: "alt3.aspmx.l.google.com.",
      },
      {
        priority: 10,
        hostName: "alt4.aspmx.l.google.com.",
      },
    ],
  });

  new TxtRecord(stack, "TxtRecord", {
    zone: hostedZone,
    recordName: "ts-mc.net",
    ttl: Duration.minutes(5),
    values: ['"v=spf1 include:_spf.google.com ~all"'],
  });

  new TxtRecord(stack, "TxtRecord2", {
    zone: hostedZone,
    recordName: "google._domainkey.ts-mc.net",
    ttl: Duration.minutes(5),
    values: [
      '"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAlwpe3cyvNy7kFSzsn35opkSf+sAuUDMdPsCkBQXQjELbfXeuUcpo8HcTbA0wdIsQHmp5oHk++csLq35FzGkggRmlBa4KJgm4ud4KHnmdNrv31owsK0s6V3B2L8ZfphxBTasmFyiGN5MTnb+kQt/oCBhlYu3YM9fpZhcf1nMWIYHVScoIVP1IxkwoEVXqD5bX+"',
      '"GwzoVyD01hyv8OaFXByLazQh3ELNmhNBzi1a5VPPgY4l1hnsAFS/eD8ewXxFUncyaGyPDeJ4kPNdgnLF/rmiF+DtVy/23ccHgLHafFFVnmM9d7/NV0yvApxyBPwstrQDW8fTiPvdZKoawlKQpEnawIDAQAB"',
    ],
  });
}
