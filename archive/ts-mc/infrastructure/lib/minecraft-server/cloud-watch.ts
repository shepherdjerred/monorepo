import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export function createLogGroups(stack: Stack) {
  new LogGroup(stack, "MinecraftServerLogGroup", {
    logGroupName: "minecraft",
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });
}
