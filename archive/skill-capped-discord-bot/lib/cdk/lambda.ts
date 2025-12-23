import { Duration, Stack } from "aws-cdk-lib";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  LambdaInsightsVersion,
  Runtime,
  Tracing,
} from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import path = require("path");

export function createLambdaResources(
  stack: Stack,
  bucket: Bucket
): LambdaFunction {
  const policy = new ManagedPolicy(stack, "Policy", {
    statements: [
      new PolicyStatement({
        actions: ["s3:*"],
        effect: Effect.ALLOW,
        resources: [bucket.bucketArn, bucket.bucketArn + "/*"],
      }),
    ],
  });

  const role = new Role(stack, "Role", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    managedPolicies: [policy],
  });

  return new LambdaFunction(stack, "Function", {
    runtime: Runtime.NODEJS_14_X,
    handler: "handler.handler",
    code: Code.fromAsset(path.join(__dirname, "../../build/bot")),
    timeout: Duration.minutes(5),
    environment: {
      BUCKET: bucket.bucketName,
    },
    memorySize: 512,
    role,
    tracing: Tracing.ACTIVE,
    insightsVersion: LambdaInsightsVersion.VERSION_1_0_119_0,
    logRetention: RetentionDays.ONE_WEEK,
    architecture: Architecture.ARM_64,
  });
}
