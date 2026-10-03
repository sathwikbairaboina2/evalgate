#!/usr/bin/env bash
# Runs the toy-agent example end to end inside the container: base, regressed head, compare.
# Exits with compare's exit code (1 = regression detected, which is the expected demo outcome).
set -u
mkdir -p /out
node /app/dist/cli.js run /app/examples/toy-agent/evalgate.yaml --out /out/base.json
TOY_AGENT_VARIANT=regressed node /app/dist/cli.js run /app/examples/toy-agent/evalgate.yaml --out /out/head.json
node /app/dist/cli.js compare --base /out/base.json --head /out/head.json --comment /out/comment.md
