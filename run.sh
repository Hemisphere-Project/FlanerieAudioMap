#!/bin/bash
# Node's stdout/stderr go to logs/run.log (Infomaniak keeps none), rotated at ~20 MB.
mkdir -p logs
while true; do
  if [ -f logs/run.log ] && [ "$(stat -c %s logs/run.log)" -gt 20000000 ]; then
    mv logs/run.log logs/run.log.1
  fi
  echo "$(date '+%F %T %z') run.sh[$$]: starting node" >> logs/run.log
  node server.js >> logs/run.log 2>&1
  rc=$?
  echo "$(date '+%F %T %z') run.sh[$$]: node exited with code $rc — restarting in 5 seconds" >> logs/run.log
  sleep 5
done
