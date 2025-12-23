import { Size, Stack, Tags } from "aws-cdk-lib";
import {
  AmazonLinuxCpuType,
  AmazonLinuxEdition,
  AmazonLinuxGeneration,
  AmazonLinuxStorage,
  AmazonLinuxVirt,
  BlockDeviceVolume,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  SubnetType,
  Volume,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { KeyPair } from "cdk-ec2-key-pair";
import { getBackupTag } from "../backups";
import { createDockerUserData } from "../docker";
import { createInstanceRole } from "../instance-role";
import { createSecurityGroup } from "./security-group";

export function createMinecraftInstance(
  stack: Stack,
  vpc: Vpc,
  keyPair: KeyPair,
  availabilityZone: string
): Instance {
  const securityGroup = createSecurityGroup(stack, vpc);

  const mountPoint = "/minecraft";
  const ebsDeviceName = "/dev/xvdb";

  // const volume = new Volume(stack, "MinecraftVolumeSnapshot", {
  //   volumeName: "Minecraft Data",
  //   snapshotId: "snap-0f16d68ba67ced553",
  //   size: Size.gibibytes(50),
  //   availabilityZone,
  //   encrypted: true,
  // });

  const volume = Volume.fromVolumeAttributes(stack, "MinecraftVolumeImported", {
    volumeId: "vol-0d7030d9262cbf1d1",
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
  cp docker/docker-compose.minecraft.yml /minecraft/docker-compose.yml
)
(cd /minecraft && \
  docker-compose up -d
)
  `);
  return new Instance(stack, "MinecraftInstance2", {
    vpc,
    role: createInstanceRole(stack, "Minecraft"),
    instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL),
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
    securityGroup,
    userData,
    userDataCausesReplacement: true,
  });
}
