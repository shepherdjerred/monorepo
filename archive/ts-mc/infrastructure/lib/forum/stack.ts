import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { createAutoScalingGroup } from "./auto-scaling-group";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { IHostedZone } from "aws-cdk-lib/aws-route53";
import { createApplicationLoadBalancer } from "./load-balancer";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { createSecurityGroup } from "./security-group";
import { createRecords } from "./records";
import { createSesResources } from "../ses";
import { KeyPair } from "cdk-ec2-key-pair";
import { createDatabaseInstance } from "./database";
import { createLogGroups } from "./cloud-watch";

export interface ForumStackProps extends StackProps {
  vpc: Vpc;
  hostedZone: IHostedZone;
  keyPair: KeyPair;
  availabilityZone: string;
}

export class ForumStack extends Stack {
  constructor(scope: Construct, id: string, props: ForumStackProps) {
    super(scope, id, props);

    createLogGroups(this);
    const securityGroup = createSecurityGroup(this, props.vpc);
    const autoScalingGroup = createAutoScalingGroup(
      this,
      props.vpc,
      securityGroup,
      props.keyPair,
      props.availabilityZone
    );

    createDatabaseInstance(
      this,
      props.vpc,
      securityGroup,
      props.availabilityZone
    );

    const certificate = new Certificate(this, "ForumCertificate", {
      domainName: "ts-mc.net",
      subjectAlternativeNames: ["www.ts-mc.net"],
      validation: CertificateValidation.fromDns(props.hostedZone),
    });

    const applicationLoadBalancer = createApplicationLoadBalancer(
      this,
      props.vpc,
      autoScalingGroup,
      certificate
    );

    // const distribution = createCloudFrontResources(
    //   this,
    //   applicationLoadBalancer,
    //   certificate
    // );
    createRecords(this, props.hostedZone, applicationLoadBalancer);
  }
}
