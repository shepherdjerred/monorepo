import { IVolume, UserData, Volume } from "aws-cdk-lib/aws-ec2";

export function createDockerUserData(
  mountPoint: string,
  volume: IVolume,
  deviceName: string
): UserData {
  // TODO: setup CloudWatch logs
  const userData = `
#!/bin/bash
set -x
set -e

DIR="$(mktemp -d)"

yum update -y

# Install useful applications
amazon-linux-extras install epel -y
yum install -y \
  mysql \
  git \
  unzip \
  amazon-cloudwatch-agent

(cd "$DIR" && \
  curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
  unzip awscliv2.zip && \
  sudo ./aws/install
)


INSTANCE_ID=$(ec2-metadata -i | cut -d" " -f2)
/usr/local/aws-cli/v2/current/bin/aws ec2 attach-volume --instance-id "$INSTANCE_ID" --volume-id ${volume.volumeId} --device ${deviceName}

# Set up EBS volume
mkdir -p ${mountPoint}
echo "${deviceName} ${mountPoint} xfs defaults,nofail 0 2" | tee -a /etc/fstab
mount -a
chown ec2-user:ec2-user ${mountPoint}

yum install -y docker
service docker start
chkconfig docker on
usermod -a -G docker ec2-user

curl -L https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

  `;

  return UserData.custom(userData);
}
