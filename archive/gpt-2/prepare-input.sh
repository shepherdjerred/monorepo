#!/bin/bash
jq -r '.chats.list | map(select(.id = 9914865331)) | map(.messages) | flatten | map(.text) | map(select(type == "string")) | flatten | map(select(. != "")) | map(.+"<|endoftext|>") |  .[]'

