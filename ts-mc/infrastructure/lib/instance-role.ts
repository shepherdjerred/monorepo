import { Stack } from "aws-cdk-lib";
import {
  Role,
  ServicePrincipal,
  ManagedPolicy,
  PolicyStatement,
} from "aws-cdk-lib/aws-iam";

export function createInstanceRole(stack: Stack, instance: string) {
  return new Role(stack, `Ec2InstanceRole-${instance}`, {
    assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    roleName: `Ec2InstanceRole-${instance}`,
    managedPolicies: [
      new ManagedPolicy(stack, `Ec2InstanceRolePolicy-${instance}`, {
        managedPolicyName: `Ec2InstanceRolePolicy-${instance}`,
        statements: [
          new PolicyStatement({
            actions: ["ec2:AttachVolume", "ec2:DetatchVolume"],
            resources: [
              "arn:aws:ec2:*:*:volume/*",
              "arn:aws:ec2:*:*:instance/*",
            ],
          }),
          new PolicyStatement({
            actions: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
              "logs:DescribeLogGroups",
              "logs:DescribeLogStreams",
            ],
            resources: ["*"],
          }),
          new PolicyStatement({
            actions: [
              "ssm:*",
              "ec2:describeInstances",
              "iam:ListRoles",
              "iam:PassRole",
            ],
            resources: ["*"],
          }),
        ],
      }),
    ],
  });
}
