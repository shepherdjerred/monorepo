import { Duration, Stack } from "aws-cdk-lib";
import { CfnEIP, Instance } from "aws-cdk-lib/aws-ec2";
import { ARecord, IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";

export function createRecords(
  stack: Stack,
  hostedZone: IHostedZone,
  elasticIp: CfnEIP
) {
  new ARecord(stack, "MinecraftServerARecord", {
    zone: hostedZone,
    recordName: "minecraft.ts-mc.net",
    ttl: Duration.minutes(1),
    target: RecordTarget.fromIpAddresses(elasticIp.ref),
  });
}
