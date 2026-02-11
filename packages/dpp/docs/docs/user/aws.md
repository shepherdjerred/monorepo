# Usage on AWS

This image can run smoothly on AWS instances with GPUs. I've tested this thorougly on a `g4dn.2xlarge` instance, which is reasonably priced as long as you shut down the instance when the bot is not in use.

The `misc/ec2-bootstrap.sh` script can be used to setup an AWS EC2 instance. It will:

- Install Docker
- Install Earthly
- Install all required nvidia software

You must use an EC2 instance with x86\*64 CPU, and a Nvidia GPU. It will not work on arm64 instances. You can try running this on AWS _without_ a GPU, but it will be extremely slow. Other GPUs such as Intel and AMD should work, but this is not a tested configuration.
