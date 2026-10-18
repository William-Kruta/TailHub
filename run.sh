#!/usr/bin/env bash

# Automatically navigate to the directory where this script is located
cd "$(dirname "$0")" || exit

# If no port was given, find a free one starting at TAILHUB_PORT (default 8080)
if [ $# -eq 0 ]; then
    port=$(uv run python - "${TAILHUB_HOST:-127.0.0.1}" "${TAILHUB_PORT:-8080}" <<'EOF'
import socket
import sys

host, start = sys.argv[1], int(sys.argv[2])
for port in range(start, min(start + 100, 65536)):
    with socket.socket() as s:
        # Match uvicorn, which sets SO_REUSEADDR, so TIME_WAIT ports count as free
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            continue
    print(port)
    break
else:
    sys.exit(f"No free port found in {start}-{start + 99}")
EOF
    ) || exit 1
    set -- "$port"
fi

# Run the TailHub server using uv
echo "🦔 Starting TailHub server..."
uv run python main.py "$@"
