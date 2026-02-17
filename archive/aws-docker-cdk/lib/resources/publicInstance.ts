import { Construct, Duration } from "monocdk";
import { AccountRootPrincipal, Role } from "monocdk/aws-iam";
import { BlockDeviceVolume } from "monocdk/lib/aws-autoscaling";
import {
  AmazonLinuxCpuType,
  AmazonLinuxEdition,
  AmazonLinuxGeneration,
  AmazonLinuxStorage,
  AmazonLinuxVirt,
  CfnEIP,
  CfnEIPAssociation,
  Instance,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "monocdk/lib/aws-ec2";
import { ARecord, HostedZone, RecordTarget } from "monocdk/lib/aws-route53";

export interface PublicInstanceProps {
  availabilityZone: string;
  volumeSizeInGigabytes: number;
  securityGroupFns: [(vpc: Vpc) => SecurityGroup];
  userData: string[];
  keyName: string;
  domain: string;
  hostedZoneId: string;
  hostedZoneName: string;
  instanceType: string;
  mountPoint: string;
}

export class PublicInstance extends Construct {
  constructor(scope: Construct, id: string, props: PublicInstanceProps) {
    super(scope, id);

    const {
      availabilityZone,
      volumeSizeInGigabytes,
      securityGroupFns,
      keyName,
      domain,
      hostedZoneId,
      hostedZoneName,
      instanceType,
      userData,
      mountPoint,
    } = props;

    const cidr = "172.31.0.0/16";

    const vpc = new Vpc(this, "Vpc", {
      cidr,
      subnetConfiguration: [
        {
          subnetType: SubnetType.PUBLIC,
          name: "Public",
        },
      ],
      natGateways: 0,
    });

    const sshSecurityGroup = new SecurityGroup(this, "SshSecurityGroup", {
      securityGroupName: "SSH",
      description: "Allows SSH access",
      vpc,
      allowAllOutbound: false,
    });

    const sshPort = 22;
    sshSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(sshPort),
      "Allow SSH",
    );
    sshSecurityGroup.addIngressRule(
      Peer.anyIpv6(),
      Port.tcp(sshPort),
      "Allow SSH",
    );

    const moshSecurityGroup = new SecurityGroup(this, "MoshSecurityGroup", {
      securityGroupName: "mosh",
      description: "Allows mosh access",
      vpc,
      allowAllOutbound: false,
    });

    moshSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.udpRange(60001, 60999),
      "Allow mosh",
    );
    moshSecurityGroup.addIngressRule(
      Peer.anyIpv6(),
      Port.udpRange(60001, 60999),
      "Allow mosh",
    );

    const role = new Role(this, "Role", {
      assumedBy: new AccountRootPrincipal(),
    });

    const ebsDeviceName = "/dev/xvdb";

    const instance = new Instance(this, "Instance", {
      keyName,
      availabilityZone,
      instanceType: new InstanceType(instanceType),
      vpc,
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
        edition: AmazonLinuxEdition.MINIMAL,
        virtualization: AmazonLinuxVirt.HVM,
        storage: AmazonLinuxStorage.EBS,
        cpuType: AmazonLinuxCpuType.X86_64,
      }),
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC,
        availabilityZones: [availabilityZone],
      },
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: BlockDeviceVolume.ebs(4, {
            deleteOnTermination: true,
          }),
        },
        {
          deviceName: ebsDeviceName,
          volume: BlockDeviceVolume.ebs(volumeSizeInGigabytes, {
            deleteOnTermination: false,
          }),
        },
      ],
      role,
      userDataCausesReplacement: true,
    });

    instance.addUserData(
      `
yum update -y

# Install Mosh
yum groupinstall -y 'Development Tools'
yum install -y protobuf-devel protobuf-compiler ncurses-devel openssl-devel
(cd /tmp && git clone https://github.com/mobile-shell/mosh)
(cd /tmp/mosh && ./autogen.sh && ./configure && make && make install)

# Install useful applications
amazon-linux-extras install epel -y
yum install -y \\
  tmux \\
  vim \\
  htop \\
  amazon-cloudwatch-agent

# Set up EBS volume
mkdir -p ${mountPoint}

blkid --match-token TYPE=xfs ${ebsDeviceName} || mkfs -t xfs ${ebsDeviceName}

echo "${ebsDeviceName} ${mountPoint} xfs defaults,nofail 0 2" | tee -a /etc/fstab
mount -a
      `,
      ...userData,
    );

    const elasticIp = new CfnEIP(this, "ElasticIp", {});

    new CfnEIPAssociation(this, "ElasticIpAssociation", {
      eip: elasticIp.ref,
      instanceId: instance.instanceId,
    });

    const hostedZone = HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      zoneName: hostedZoneName,
      hostedZoneId: hostedZoneId,
    });

    new ARecord(this, "ARecord", {
      recordName: domain,
      zone: hostedZone,
      target: RecordTarget.fromIpAddresses(elasticIp.ref),
      ttl: Duration.seconds(60),
    });

    instance.addSecurityGroup(sshSecurityGroup);
    instance.addSecurityGroup(moshSecurityGroup);
    securityGroupFns
      .map((securityGroupsFn) => {
        return securityGroupsFn(vpc);
      })
      .forEach((securityGroup) => {
        instance.addSecurityGroup(securityGroup);
      });
  }
}
