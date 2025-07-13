#!/usr/local/bin/bash

docker start mongo > /dev/null

printf "Starting Mongo Docker container"
until [ "`/usr/local/bin/docker inspect -f {{.State.Running}} mongo`"=="true" ]; do
    printf "."
    sleep 1;
done;

printf "\nMongo has started\n"

