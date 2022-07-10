import { Construct, Stack, StackProps } from "monocdk";
import { CfnLifecyclePolicy } from "monocdk/aws-dlm";
import { MinecraftServer } from "./resources/minecraftServer";
import { FactorioServer } from "./resources/factorioServer";

export class AwsDockerCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const keyName: string = this.node.tryGetContext("key_pair_name") as string;
    const availabilityZone = "us-east-1c";
    const hostedZoneName = "shepherdjerred.com";
    const hostedZoneId = "Z24MJMG74F2S94";

    new MinecraftServer(this, "MinecraftServer", {
      volumeSizeInGigabytes: 30,
      availabilityZone,
      minecraftVersion: "1.17.1",
      javaProcessMemoryInGigabytes: 4,
      minecraftServerPort: "25565",
      keyName,
      domain: "minecraft",
      hostedZoneId,
      hostedZoneName,
      instanceType: "c4.xlarge",
    });

    new FactorioServer(this, "FactorioServer", {
      volumeSizeInGigabytes: 3,
      availabilityZone,
      factorioVersion: "1.1.37",
      keyName,
      domain: "factorio",
      hostedZoneId,
      hostedZoneName,
      instanceType: "c4.xlarge",
    });

    // TODO tag EBS volume so that this policy applies
    new CfnLifecyclePolicy(this, "LifecyclePolicy", {
      description: "Docker policy",
      state: "ENABLED",
      executionRoleArn: `arn:aws:iam::${
        Stack.of(this).account
      }:role/AWSDataLifecycleManagerDefaultRole`,
      policyDetails: {
        resourceTypes: ["VOLUME"],
        targetTags: [
          {
            key: "stack",
            value: "docker",
          },
        ],
        schedules: [
          {
            name: "Daily Snapshots",
            tagsToAdd: [
              {
                key: "type",
                value: "dailySnapshot",
              },
            ],
            createRule: {
              interval: 12,
              intervalUnit: "HOURS",
              times: ["13:00"],
            },
            retainRule: {
              count: 2,
            },
            copyTags: false,
          },
        ],
      },
    });
  }
}
