#!/bin/bash

# Load .bashrc to get the PATH environment variable
source ~/.bashrc

# Trust mise configuration
mise trust

mise run dev
