import { Construct } from "monocdk/lib/core";
import { Vpc, SecurityGroup } from "monocdk/lib/aws-ec2";
import { PublicInstance } from "./publicInstance";

export interface DockerServerProps {
  availabilityZone: string;
  volumeSizeInGigabytes: number;
  securityGroupFns: [(vpc: Vpc) => SecurityGroup];
  userData: string[];
  mountPoint: string;
  keyName: string;
  domain: string;
  hostedZoneId: string;
  hostedZoneName: string;
  instanceType: string;
}

export class DockerServer extends Construct {
  constructor(scope: Construct, id: string, props: DockerServerProps) {
    super(scope, id);

    const userData = [
      `
yum install -y docker
usermod -a -G docker ec2-user
service docker start
      `,
      ...props.userData,
    ];

    new PublicInstance(this, "PublicInstance", {
      ...props,
      userData,
    });
  }
}
