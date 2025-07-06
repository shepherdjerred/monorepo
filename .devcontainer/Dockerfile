# This Dockerfile is used for:
# - devcontainers
# - Cursor background agents

FROM ubuntu:noble@sha256:440dcf6a5640b2ae5c77724e68787a906afb8ddee98bf86db94eea8528c2c076

RUN apt update -y && apt install -y gpg wget curl git sudo
RUN install -dm 755 /etc/apt/keyrings
RUN wget -qO - https://mise.jdx.dev/gpg-key.pub | gpg --dearmor > /etc/apt/keyrings/mise-archive-keyring.gpg
RUN echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg] https://mise.jdx.dev/deb stable main" > /etc/apt/sources.list.d/mise.list
RUN apt update
RUN apt install -y mise

# Set up mise for root user
RUN echo 'eval "$(mise activate bash --shims)"' >> ~/.bash_profile
RUN echo 'eval "$(mise activate bash)"' >> ~/.bashrc

RUN mise global bun@1.2.16
RUN mise global python@3.13.5
RUN mise global go@1.23.5
RUN mise global node@lts
RUN mise install
RUN mise reshim

RUN /root/.local/share/mise/shims/go install golang.stackrox.io/kube-linter/cmd/kube-linter@v0.7.2

# Create dev user with sudo privileges
RUN useradd -m -s /bin/bash dev && \
    echo 'dev ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

# Set up mise for dev user
USER dev
WORKDIR /home/dev

RUN echo 'eval "$(mise activate bash --shims)"' >> ~/.bash_profile
RUN echo 'eval "$(mise activate bash)"' >> ~/.bashrc

RUN mise global bun@1.2.16
RUN mise global python@3.13.5
RUN mise global go@1.23.5
RUN mise global node@lts
RUN mise install
RUN mise reshim

RUN /home/dev/.local/share/mise/shims/go install golang.stackrox.io/kube-linter/cmd/kube-linter@v0.7.2

# Switch back to root for system-level installations
USER root

RUN apt-get update
RUN apt-get install -y apt-transport-https ca-certificates curl gnupg
RUN curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.33/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
RUN chmod 644 /etc/apt/keyrings/kubernetes-apt-keyring.gpg
RUN echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.33/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
RUN chmod 644 /etc/apt/sources.list.d/kubernetes.list
RUN apt-get update
RUN apt-get install -y kubectl

RUN curl -fsSL https://dl.dagger.io/dagger/install.sh | BIN_DIR=/usr/local/bin sh
