import { RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  FlowLogDestination,
  FlowLogTrafficType,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";

export function createVpc(stack: Stack): Vpc {
  // TODO: support ipv6
  const logGroup = createLogGroup(stack);
  const role = new Role(stack, "VpcFlowLogsRole", {
    assumedBy: new ServicePrincipal("vpc-flow-logs.amazonaws.com"),
    roleName: "Ec2InstanceRole",
    managedPolicies: [
      new ManagedPolicy(stack, "Ec2InstanceRolePolicy", {
        managedPolicyName: "Ec2InstanceRolePolicy",
        statements: [
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
        ],
      }),
    ],
  });

  return new Vpc(stack, "Vpc", {
    vpcName: "Main VPC",
    cidr: "10.0.0.0/16",
    natGateways: 0,
    subnetConfiguration: [
      {
        name: "Public",
        subnetType: SubnetType.PUBLIC,
        cidrMask: 24,
      },
      {
        name: "PrivateIsolated",
        subnetType: SubnetType.PRIVATE_ISOLATED,
        cidrMask: 24,
      },
    ],
    flowLogs: {
      logs: {
        trafficType: FlowLogTrafficType.ALL,
        destination: FlowLogDestination.toCloudWatchLogs(logGroup, role),
      },
    },
  });
}

function createLogGroup(stack: Stack): LogGroup {
  return new LogGroup(stack, "FlowLogsLogGroup", {
    logGroupName: "FlowLogsLogGroup",
    retention: RetentionDays.ONE_WEEK,
    removalPolicy: RemovalPolicy.DESTROY,
  });
}
