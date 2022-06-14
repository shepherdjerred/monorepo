#!/usr/local/bin/bash

docker start redis > /dev/null

printf "Starting redis Docker container"
until [ "`/usr/local/bin/docker inspect -f {{.State.Running}} redis`"=="true" ]; do
    printf "."
    sleep 1;
done;

printf "\nredis has started\n"

