#!/usr/bin/env bash

# Automatically navigate to the directory where this script is located
cd "$(dirname "$0")" || exit

# Run the TailHub server using uv
echo "🦔 Starting TailHub server..."
uv run python main.py
