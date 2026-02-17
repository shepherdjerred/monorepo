import { Stack } from "aws-cdk-lib";
import { Vpc, SecurityGroup, Peer, Port } from "aws-cdk-lib/aws-ec2";

// TODO: only allow the LB on 80
export function createSecurityGroup(stack: Stack, vpc: Vpc): SecurityGroup {
  const securityGroup = new SecurityGroup(stack, "ForumSecurityGroup", {
    securityGroupName: "Forum",
    description: "Forum security group",
    vpc,
  });
  securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), "HTTP access");
  securityGroup.addIngressRule(Peer.anyIpv6(), Port.tcp(80), "HTTP access");

  const sshPort = 22;
  securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(sshPort), "Allow SSH");
  securityGroup.addIngressRule(Peer.anyIpv6(), Port.tcp(sshPort), "Allow SSH");
  return securityGroup;
}
