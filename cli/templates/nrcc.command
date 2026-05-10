#!/usr/bin/env bash
# Double-clickable launcher for macOS. Terminal opens briefly, NRCC
# starts (or no-ops if already running), the browser is opened, then
# the launcher exits and the Terminal window can be closed.
exec "@LAUNCHER@"
