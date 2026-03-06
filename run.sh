#!/bin/bash
while true; do
  node server.js
  echo "App crashed! Restarting in 5 seconds..."
  sleep 5
done
