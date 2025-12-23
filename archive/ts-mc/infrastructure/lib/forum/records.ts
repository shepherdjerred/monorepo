import { Duration, Stack } from "aws-cdk-lib";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ARecord, IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import {
  CloudFrontTarget,
  LoadBalancerTarget,
} from "aws-cdk-lib/aws-route53-targets";

export function createRecords(
  stack: Stack,
  hostedZone: IHostedZone,
  applicationLoadBalancer: ApplicationLoadBalancer
) {
  // new ARecord(stack, "ForumsARecord", {
  //   zone: hostedZone,
  //   recordName: "ts-mc.net",
  //   ttl: Duration.minutes(1),
  //   target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
  // });

  // new ARecord(stack, "ForumsWwwARecord", {
  //   zone: hostedZone,
  //   recordName: "www.ts-mc.net",
  //   ttl: Duration.minutes(1),
  //   target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
  // });

  new ARecord(stack, "ForumsARecord", {
    zone: hostedZone,
    recordName: "ts-mc.net",
    ttl: Duration.minutes(1),
    target: RecordTarget.fromAlias(
      new LoadBalancerTarget(applicationLoadBalancer)
    ),
  });

  new ARecord(stack, "ForumsWwwARecord", {
    zone: hostedZone,
    recordName: "www.ts-mc.net",
    ttl: Duration.minutes(1),
    target: RecordTarget.fromAlias(
      new LoadBalancerTarget(applicationLoadBalancer)
    ),
  });
}
