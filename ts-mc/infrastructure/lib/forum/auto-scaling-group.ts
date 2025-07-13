import { Duration, Stack, Tags } from "aws-cdk-lib";
import {
  AutoScalingGroup,
  BlockDeviceVolume,
  GroupMetrics,
} from "aws-cdk-lib/aws-autoscaling";
import {
  AmazonLinuxCpuType,
  AmazonLinuxEdition,
  AmazonLinuxGeneration,
  AmazonLinuxStorage,
  AmazonLinuxVirt,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  SecurityGroup,
  SubnetType,
  Volume,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { KeyPair } from "cdk-ec2-key-pair";
import { getBackupTag } from "../backups";
import { createDockerUserData } from "../docker";
import { createInstanceRole } from "../instance-role";

export function createAutoScalingGroup(
  stack: Stack,
  vpc: Vpc,
  securityGroup: SecurityGroup,
  keyPair: KeyPair,
  availabilityZone: string
): AutoScalingGroup {
  const mountPoint = "/xenforo";
  const ebsDeviceName = "/dev/xvdb";

  // Useful when recovering from a snapshot/backup
  // const volume = new Volume(stack, "ForumsVolumeSnapshot", {
  //   volumeName: "Forums Data",
  //   snapshotId: "snap-0af2c15c0063b8246",
  //   size: Size.gibibytes(50),
  //   availabilityZone,
  //   encrypted: true,
  // });

  // Useful when re-using an existing EBS volume
  const volume = Volume.fromVolumeAttributes(stack, "ForumsVolumeImported", {
    volumeId: "vol-0d0d039af1b205b7e",
    availabilityZone,
  });

  const tag = getBackupTag();
  Tags.of(volume).add(tag.key, tag.value);

  const userData = createDockerUserData(mountPoint, volume, ebsDeviceName);
  userData.addCommands(`
# Deploy
(cd $DIR && \
  git clone https://github.com/ts-mc/infrastructure && \
  cd infrastructure && \
  cp docker/docker-compose.forums.yml /xenforo/docker-compose.yml
)
(cd /xenforo && \
  docker-compose up -d
)
  `);

  const autoScalingGroup = new AutoScalingGroup(stack, "AutoScalingGroup", {
    vpc,
    role: createInstanceRole(stack, "Forums"),
    instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
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
        volume: BlockDeviceVolume.ebs(10, {
          deleteOnTermination: true,
          encrypted: true,
        }),
      },
    ],
    keyName: keyPair.keyPairName,
    securityGroup: securityGroup,
    minCapacity: 1,
    maxCapacity: 1,
    associatePublicIpAddress: true,
    maxInstanceLifetime: Duration.days(7),
    groupMetrics: [GroupMetrics.all()],
    userData,
  });

  return autoScalingGroup;
}
