import { Stack } from "aws-cdk-lib";
import { AutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { Vpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerCertificate,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";

export function createApplicationLoadBalancer(
  stack: Stack,
  vpc: Vpc,
  autoScalingGroup: AutoScalingGroup,
  certificate: Certificate
): ApplicationLoadBalancer {
  const applicationLoadBalancer = new ApplicationLoadBalancer(
    stack,
    "ApplicationLoadBalancer",
    {
      vpc: vpc,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
      },
      internetFacing: true,
    }
  );

  const httpsListener = applicationLoadBalancer.addListener(
    "ApplicationLoadBalancerHttpsListener",
    {
      port: 443,
      open: true,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [ListenerCertificate.fromCertificateManager(certificate)],
    }
  );

  httpsListener.addTargets("ApplicationLoadBalancerHttpsFleet", {
    port: 80,
    targets: [autoScalingGroup],
    protocol: ApplicationProtocol.HTTP,
  });

  applicationLoadBalancer.addRedirect({
    sourceProtocol: ApplicationProtocol.HTTP,
    sourcePort: 80,
    targetProtocol: ApplicationProtocol.HTTPS,
    targetPort: 443,
  });

  return applicationLoadBalancer;
}
