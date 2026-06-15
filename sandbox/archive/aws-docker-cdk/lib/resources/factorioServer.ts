import { Construct } from "monocdk";
import { Peer, Port, SecurityGroup, Vpc } from "monocdk/lib/aws-ec2";
import { DockerServer } from "./dockerServer";

export interface FactorioServerProps {
  factorioVersion: string;
  availabilityZone: string;
  volumeSizeInGigabytes: number;
  keyName: string;
  domain: string;
  hostedZoneId: string;
  hostedZoneName: string;
  instanceType: string;
}

export class FactorioServer extends Construct {
  constructor(scope: Construct, id: string, props: FactorioServerProps) {
    super(scope, id);
    const { factorioVersion } = props;

    const factorioGamePort = 34197;
    const factorioRconPort = 27015;
    const factorioGamePortString = factorioGamePort.toString();
    const factorioRconPortString = factorioRconPort.toString();

    const factorioSecurityGroupFn = (vpc: Vpc) => {
      const securityGroup = new SecurityGroup(this, "FactorioSecurityGroup", {
        securityGroupName: "Factorio",
        description: "Allows network access for Factorio",
        vpc,
        allowAllOutbound: false,
      });

      securityGroup.addIngressRule(
        Peer.anyIpv4(),
        Port.udp(factorioGamePort),
        "Factorio",
      );
      securityGroup.addEgressRule(
        Peer.anyIpv4(),
        Port.udp(factorioGamePort),
        "Factorio",
      );
      securityGroup.addIngressRule(
        Peer.anyIpv6(),
        Port.udp(factorioGamePort),
        "Factorio",
      );
      securityGroup.addEgressRule(
        Peer.anyIpv6(),
        Port.udp(factorioGamePort),
        "Factorio",
      );

      return securityGroup;
    };

    const mountPoint = "/storage";
    const userName = "factorio";
    const userId = "845";
    const groupName = userName;
    const groupId = userId;
    const serviceName = "docker.factorio.service";

    const userData = [
      `
groupadd -g ${groupId} ${groupName}
useradd -g ${groupId} -u ${userId} ${userName}
usermod -a -G docker ${userName}

cat > /etc/systemd/system/${serviceName} <<EOF
[Unit]
Description=Docker Factorio service
After=docker.service
Requires=docker.service

[Service]
User=${userName}
StandardInput=tty-force
TimeoutStartSec=0
Restart=always
RestartSec=10
ExecStart=/usr/bin/docker run \\
  --rm \\
  --name %n \\
  --user ${userId}:${groupId} \\
  -p ${factorioGamePortString}:${factorioGamePortString}/udp \\
  -p ${factorioRconPortString}:${factorioRconPortString}/tcp \\
  --mount type=bind,source=${mountPoint},target=/factorio \\
  -it \\
  factoriotools/factorio:${factorioVersion}
ExecStop=/usr/bin/docker stop %n

[Install]
WantedBy=default.target
EOF

chown -R ${userId}:${groupId} ${mountPoint}

systemctl enable ${serviceName}
systemctl start ${serviceName}
      `,
    ];

    new DockerServer(this, "DockerServer", {
      securityGroupFns: [factorioSecurityGroupFn],
      mountPoint,
      userData,
      ...props,
    });
  }
}
