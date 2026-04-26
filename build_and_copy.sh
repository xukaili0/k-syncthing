#!/bin/bash
set -e
cd "$(dirname "$0")"
go run build.go -goos windows -goarch amd64 -build-out /home/lxk11/syncthing_dev/out/windows-amd64/syncthing.exe build
cp /home/lxk11/syncthing_dev/out/windows-amd64/syncthing.exe /mnt/e/syncthing_test/
/mnt/e/syncthing_test/syncthing.exe
