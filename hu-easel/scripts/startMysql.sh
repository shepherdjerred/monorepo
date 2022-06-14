#!/usr/local/bin/bash

docker start mysql > /dev/null

printf "Starting MySQL Docker container"
until [ "`/usr/local/bin/docker inspect -f {{.State.Running}} mysql`"=="true" ]; do
    printf "."
    sleep 1;
done;

printf "\nMySQL has started\n"

