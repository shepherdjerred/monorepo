import { Stack, StackProps } from "aws-cdk-lib";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import { createLambdaResources } from "./lambda";
import { createS3Resources } from "./s3";

export class LambdaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const bucket = createS3Resources(this);
    const lambdaFunction = createLambdaResources(this, bucket);
    const eventRule = new Rule(this, "EventRule", {
      schedule: Schedule.expression("cron(*/10 * * * ? *)"),
    });
    eventRule.addTarget(new LambdaFunction(lambdaFunction));
  }
}
