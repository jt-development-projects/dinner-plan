#!/bin/zsh
cd "$(dirname "$0")"

# Load API key from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

open http://localhost:8080
python3 server.py
