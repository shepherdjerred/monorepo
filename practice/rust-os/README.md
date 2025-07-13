# rust-os
[![License](https://img.shields.io/github/license/shepherdjerred/rust-os)](LICENSE)
[![Build Status](https://travis-ci.com/shepherdjerred/rust-os.svg?branch=master)](https://travis-ci.com/shepherdjerred/rust-os)
[![Latest Release](https://img.shields.io/github/v/release/shepherdjerred/rust-os?include_prereleases)](https://github.com/shepherdjerred/rust-os/releases)

An operating system written in Rust

Following the guide from [Philipp Opperman](https://os.phil-opp.com/)

# Running
1. Download the [latest release](https://github.com/shepherdjerred/rust-os/releases) from GitHub.
2. Do either of the following:
  * Run with [Qemu](https://www.qemu.org/): `qemu-system-x86_64 -drive format=raw,file=bootimage-rust_os.bin`
  * Format a USB (replace `/dev/sdX` with your device): `dd if=bootimage-rust_os.bin of=/dev/sdX && sync`

# Screenshots
![Screenshot of OS as of commit 0ffe3c87062e46862cf616e2334fb53544a74f24](https://i.imgur.com/N9gfTH8.png)
