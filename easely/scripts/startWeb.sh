#!/usr/local/bin/bash

tmux new -d -s easely
tmux split-window -v

tmux select-pane -t 1
tmux send-key "cd ../web" C-m
tmux send-key "npm run dev" C-m

tmux a -t easely

