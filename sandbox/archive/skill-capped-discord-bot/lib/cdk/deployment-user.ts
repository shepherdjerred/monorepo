import { Stack } from "aws-cdk-lib";
import {
  ManagedPolicy,
  PolicyStatement,
  Effect,
  User,
} from "aws-cdk-lib/aws-iam";

export function createDeploymentResources(stack: Stack): void {
  const deploymentPolicy = new ManagedPolicy(stack, "DeploymentPolicy", {
    statements: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ["*"],
        actions: ["*"],
      }),
    ],
  });

  new User(stack, "DeploymentUser", {
    userName: "DeploymentUser",
    managedPolicies: [deploymentPolicy],
  });
}
