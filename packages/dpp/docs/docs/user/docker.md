# Docker

The primary artifact of this repository is a Docker image. It can be used like any other Docker image using the Docker CLI, or Docker Compose.

!!! warning

    The Docker image runs a full copy of Desktop Linux. In order for streaming to work smoothly, you'll need either a _very_ fast CPU, or a GPU. The [nvidia-docker](https://github.com/NVIDIA/nvidia-docker) project allows Docker containers to use host GPU resources, and it is _strongly_ recommended to be used with the Docker image.
