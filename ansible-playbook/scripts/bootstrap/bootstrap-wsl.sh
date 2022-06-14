#!/bin/bash
ssh-copy-id wsl
# edit /etc/ssh/sshd_config to allow key auth
sudo apt remove openssh-server
sudo apt install openssh-server

