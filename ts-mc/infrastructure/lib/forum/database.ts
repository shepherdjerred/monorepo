import { Duration, Stack } from "aws-cdk-lib";
import {
  InstanceType,
  InstanceClass,
  InstanceSize,
  SubnetType,
  Vpc,
  SecurityGroup,
  Port,
} from "aws-cdk-lib/aws-ec2";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  DatabaseInstanceEngine,
  MariaDbEngineVersion,
  DatabaseInstance,
  Credentials,
  DatabaseInstanceFromSnapshot,
  SnapshotCredentials,
} from "aws-cdk-lib/aws-rds";

export function createDatabaseInstance(
  stack: Stack,
  vpc: Vpc,
  applicationSecurityGroup: SecurityGroup,
  availabilityZone: string
): void {
  const databaseSecurityGroup = new SecurityGroup(
    stack,
    "ForumsDatabaseSecurityGroup",
    {
      securityGroupName: "DatabaseSecurityGroup",
      description:
        "Allows the Forums instance to communicate with the database",
      vpc,
    }
  );

  databaseSecurityGroup.addIngressRule(
    applicationSecurityGroup,
    Port.tcp(3306),
    "MariaDB/MySQL",
    false
  );

  const sharedProps = {
    engine: DatabaseInstanceEngine.mariaDb({
      version: MariaDbEngineVersion.VER_10_5,
    }),
    instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
    vpc,
    vpcSubnets: {
      subnetType: SubnetType.PRIVATE_ISOLATED,
    },
    allocatedStorage: 20,
    maxAllocatedStorage: 30,
    backupRetention: Duration.days(7),
    cloudwatchLogsRetention: RetentionDays.ONE_WEEK,
    autoMinorVersionUpgrade: true,
    deletionProtection: false,
    securityGroups: [databaseSecurityGroup],
    availabilityZone,
  };

  // Useful when restoring from backup
  // new DatabaseInstanceFromSnapshot(stack, "Instance", {
  //   ...sharedProps,
  //   credentials: SnapshotCredentials.fromGeneratedSecret("admin"),
  //   snapshotIdentifier: "arn:aws:rds:us-west-2:753834062409:snapshot:xenforo",
  // });

  new DatabaseInstance(stack, "XenForoDatabaseInstance", {
    credentials: Credentials.fromGeneratedSecret("admin"),
    ...sharedProps,
  });
}
