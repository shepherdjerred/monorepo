#!/usr/local/bin/bash

source ./stop.sh

echo "Starting Docker"
source ./startDocker.sh

echo "Starting MySQL"
source ./startMysql.sh

echo "Starting redis"
source ./startRedis.sh

echo "Starting Easely web"
source ./startWeb.sh

