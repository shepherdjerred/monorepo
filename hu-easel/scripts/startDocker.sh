#!/usr/local/bin/bash

if (! docker stats --no-stream > /dev/null 2> /dev/null); then
  open /Applications/Docker.app
  printf "Waiting for Docker to launch"
  while (! docker stats --no-stream > /dev/null 2> /dev/null ); do
          printf "."
          sleep 1
  done
  printf "\nDocker has started\n"
else
  printf "Docker is already running\n"
fi


