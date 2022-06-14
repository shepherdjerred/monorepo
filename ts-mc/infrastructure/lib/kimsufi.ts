import { Duration, Stack } from "aws-cdk-lib";
import {
  AaaaRecord,
  ARecord,
  IHostedZone,
  RecordTarget,
} from "aws-cdk-lib/aws-route53";

export function createKimsufiResources(stack: Stack, zone: IHostedZone) {
  new ARecord(stack, "KimsufiARecord", {
    zone,
    recordName: "minecraft.ts-mc.net",
    target: RecordTarget.fromIpAddresses("158.69.122.44"),
    ttl: Duration.minutes(1),
  });
  new AaaaRecord(stack, "KimsufiAaaaRecord", {
    zone,
    recordName: "minecraft.ts-mc.net",
    target: RecordTarget.fromIpAddresses("2607:5300:60:992c::"),
    ttl: Duration.minutes(1),
  });
}
