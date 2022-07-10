import { Construct } from "monocdk";
import { Peer, Port, SecurityGroup, Vpc } from "monocdk/lib/aws-ec2";
import { DockerServer } from "./dockerServer";

export interface MinecraftServerProps {
  minecraftVersion: string;
  availabilityZone: string;
  volumeSizeInGigabytes: number;
  javaProcessMemoryInGigabytes: number;
  minecraftServerPort: string;
  keyName: string;
  domain: string;
  hostedZoneId: string;
  hostedZoneName: string;
  instanceType: string;
}

export class MinecraftServer extends Construct {
  constructor(scope: Construct, id: string, props: MinecraftServerProps) {
    super(scope, id);
    const {
      minecraftVersion,
      javaProcessMemoryInGigabytes,
      minecraftServerPort,
    } = props;

    const minecraftSecurityGroupFn = (vpc: Vpc) => {
      const securityGroup = new SecurityGroup(this, "MinecraftSecurityGroup", {
        securityGroupName: "Minecraft",
        description: "Allows network access for Minecraft",
        vpc,
        allowAllOutbound: false,
      });

      const minecraftServerPortAsNumber = parseInt(minecraftServerPort);

      securityGroup.addIngressRule(
        Peer.anyIpv4(),
        Port.tcp(minecraftServerPortAsNumber),
        "Minecraft"
      );
      securityGroup.addIngressRule(
        Peer.anyIpv4(),
        Port.udp(minecraftServerPortAsNumber),
        "Minecraft"
      );
      securityGroup.addIngressRule(
        Peer.anyIpv6(),
        Port.tcp(minecraftServerPortAsNumber),
        "Minecraft"
      );
      securityGroup.addIngressRule(
        Peer.anyIpv6(),
        Port.udp(minecraftServerPortAsNumber),
        "Minecraft"
      );

      return securityGroup;
    };

    const mountPoint = "/storage";
    const user = "minecraft";
    const userId = "1001";

    const userData = [
      `
useradd -u ${userId} ${user}
usermod -a -G docker ${user}

cat > /etc/systemd/system/docker.minecraft.service <<EOF
[Unit]
Description=Docker Spigot service
After=docker.service
Requires=docker.service

[Service]
User=${user}
StandardInput=tty-force
TimeoutStartSec=0
Restart=always
RestartSec=10
ExecStart=/usr/bin/docker run \\
  --rm \\
  --name %n \\
  --user ${userId}:${userId} \\
  -p ${minecraftServerPort}:${minecraftServerPort}/tcp \\
  -p ${minecraftServerPort}:${minecraftServerPort}/udp \\
  --mount type=bind,source=${mountPoint},target=/home/minecraft/server \\
  -it \\
  shepherdjerred/spigot:${minecraftVersion} \\
  -Xmx${javaProcessMemoryInGigabytes}G \\
  -Dcom.mojang.eula.agree=true \\
  -jar "../spigot.jar"
ExecStop=/usr/bin/docker stop %n

[Install]
WantedBy=default.target
EOF

chown -R ${user}:${user} ${mountPoint}

systemctl enable docker.minecraft.service
systemctl start docker.minecraft.service
      `,
    ];

    new DockerServer(this, "DockerServer", {
      securityGroupFns: [minecraftSecurityGroupFn],
      mountPoint,
      userData,
      ...props,
    });
  }
}
