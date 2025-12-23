import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { KeyPair } from "cdk-ec2-key-pair";
import { createMinecraftInstance } from "./instance";
import { createRecords } from "./records";
import { createElasticIp } from "./elastic-ip";
import { createLogGroups } from "./cloud-watch";

export interface AppStackProps extends StackProps {
  vpc: Vpc;
  hostedZone: IHostedZone;
  keyPair: KeyPair;
  availabilityZone: string;
}

export class MinecraftServerStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    createLogGroups(this);
    const instance = createMinecraftInstance(
      this,
      props.vpc,
      props.keyPair,
      props.availabilityZone
    );

    const eip = createElasticIp(this, instance);

    createRecords(this, props.hostedZone, eip);
  }
}
