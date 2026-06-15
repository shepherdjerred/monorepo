#!/usr/local/bin/bash

source ./stop.sh

echo "Starting Docker"
source ./startDocker.sh

echo "Starting MongoDB"
source ./startMongo.sh

echo "Starting Herd"
source ./startHerd.sh

