#!/bin/bash

# Load .bashrc to get the PATH environment variable
# shellcheck source=/dev/null
source ~/.bashrc

# Trust mise configuration
mise trust

mise run dev
