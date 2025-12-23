import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export function createLogGroups(stack: Stack) {
  new LogGroup(stack, "ForumsSrcLogGroup", {
    logGroupName: "src",
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  new LogGroup(stack, "ForumsPhpFpmLogGroup", {
    logGroupName: "phpfpm",
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  new LogGroup(stack, "ForumsNginxLogGroup", {
    logGroupName: "nginx",
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });
}
