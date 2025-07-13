import { Duration, Stack } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  CacheCookieBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
} from "aws-cdk-lib/aws-cloudfront";
import { LoadBalancerV2Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";

export function createCloudFrontResources(
  stack: Stack,
  applicationLoadBalancer: ApplicationLoadBalancer,
  certificate: Certificate
): Distribution {
  return new Distribution(stack, "Distribution", {
    defaultRootObject: "index.html",
    domainNames: ["ts-mc.net", "www.ts-mc.net"],
    certificate,
    defaultBehavior: {
      origin: new LoadBalancerV2Origin(applicationLoadBalancer),
      cachePolicy: new CachePolicy(stack, "CachePolicy", {
        defaultTtl: Duration.minutes(1),
        maxTtl: Duration.hours(1),
        cookieBehavior: CacheCookieBehavior.all(),
        queryStringBehavior: CacheQueryStringBehavior.all(),
        enableAcceptEncodingGzip: true,
        enableAcceptEncodingBrotli: true,
      }),
    },
  });
}
