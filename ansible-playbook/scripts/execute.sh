#!/bin/bash
ansible-galaxy install -r requirements.yml
ansible-playbook main.yml -e@group_vars/all/vault.yml "$@"
