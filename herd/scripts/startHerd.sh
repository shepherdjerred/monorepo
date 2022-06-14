#!/usr/local/bin/bash

tmux new -d -s herd
tmux split-window -h

tmux select-pane -t 0
tmux send-key "cd ../api" C-m
tmux send-key "npm run dev" C-m

tmux select-pane -t 1
tmux send-key "cd ../web" C-m
tmux send-key "npm run start" C-m

tmux a -t herd

