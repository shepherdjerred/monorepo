import { Stack, Tag } from "aws-cdk-lib";
import { CfnLifecyclePolicy } from "aws-cdk-lib/aws-dlm";
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";

export function createDataLifecycleManager(stack: Stack) {
  const role = new Role(stack, "DataLifecycleManagerRole", {
    assumedBy: new ServicePrincipal("dlm.amazonaws.com"),
    roleName: "DataLifecycleManagerRole",
    managedPolicies: [
      new ManagedPolicy(stack, "DataLifecycleManagerRolePolicy", {
        managedPolicyName: "DataLifecycleManagerRolePolicy",
        statements: [
          new PolicyStatement({
            actions: [
              "ec2:CreateSnapshot",
              "ec2:CreateSnapshots",
              "ec2:DeleteSnapshot",
              "ec2:DescribeInstances",
              "ec2:DescribeVolumes",
              "ec2:DescribeSnapshots",
              "ec2:EnableFastSnapshotRestores",
              "ec2:DescribeFastSnapshotRestores",
              "ec2:DisableFastSnapshotRestores",
              "ec2:CopySnapshot",
              "ec2:ModifySnapshotAttribute",
              "ec2:DescribeSnapshotAttribute",
            ],
            resources: ["*"],
          }),
          new PolicyStatement({
            actions: ["ec2:CreateTags"],
            resources: ["arn:aws:ec2:*::snapshot/*"],
          }),
          new PolicyStatement({
            actions: [
              "events:PutRule",
              "events:DeleteRule",
              "events:DescribeRule",
              "events:EnableRule",
              "events:DisableRule",
              "events:ListTargetsByRule",
              "events:PutTargets",
              "events:RemoveTargets",
            ],
            resources: [
              "arn:aws:events:*:*:rule/AwsDataLifecycleRule.managed-cwe.*",
            ],
          }),
        ],
      }),
    ],
  });

  new CfnLifecyclePolicy(stack, "LifecyclePolicy", {
    description: "Backups for EBS volumes",
    state: "ENABLED",
    executionRoleArn: role.roleArn,
    policyDetails: {
      policyType: "EBS_SNAPSHOT_MANAGEMENT",
      resourceTypes: ["VOLUME"],
      schedules: [
        {
          name: "Hourly snapshots for one week",
          copyTags: true,
          createRule: {
            cronExpression: "cron(0 * * * ? *)",
          },
          retainRule: {
            interval: 1,
            intervalUnit: "WEEKS",
          },
        },
      ],
      targetTags: [getBackupTag()],
    },
  });
}

export function getBackupTag(): Tag {
  return new Tag("Backup", "Hourly");
}
