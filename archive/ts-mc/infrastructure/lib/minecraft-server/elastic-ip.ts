import { Stack } from "aws-cdk-lib";
import { CfnEIP, CfnEIPAssociation, Instance } from "aws-cdk-lib/aws-ec2";

export function createElasticIp(stack: Stack, instance: Instance): CfnEIP {
  const eip = new CfnEIP(stack, "MinecraftServerEip", {});
  new CfnEIPAssociation(stack, "MinecraftServerEipAssociation", {
    eip: eip.ref,
    instanceId: instance.instanceId,
  });
  return eip;
}
