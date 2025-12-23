import { Stack } from "aws-cdk-lib";
import { Vpc, SecurityGroup, Peer, Port } from "aws-cdk-lib/aws-ec2";

export function createSecurityGroup(stack: Stack, vpc: Vpc): SecurityGroup {
  const securityGroup = new SecurityGroup(stack, "MinecraftSecurityGroup", {
    securityGroupName: "Minecraft",
    description: "Minecraft security group",
    vpc,
  });
  securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(25565), "25565 TCP");
  securityGroup.addIngressRule(Peer.anyIpv6(), Port.tcp(25565), "25565 TCP");

  securityGroup.addIngressRule(Peer.anyIpv4(), Port.udp(25565), "25565 UDP");
  securityGroup.addIngressRule(Peer.anyIpv6(), Port.udp(25565), "25565 UDP");

  const sshPort = 22;
  securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(sshPort), "Allow SSH");
  securityGroup.addIngressRule(Peer.anyIpv6(), Port.tcp(sshPort), "Allow SSH");

  return securityGroup;
}
