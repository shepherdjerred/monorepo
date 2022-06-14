#!/usr/local/bin/bash

source ./stop.sh

echo "Starting Docker"

source ./startDocker.sh

echo "Starting MySQL"

source ./startMysql.sh

echo "Starting EASEL"

source ./startEasel.sh

