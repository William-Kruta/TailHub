"""
tailhub/config.py
Central place for runtime configuration.
Change DOWNLOAD_DIR here or override via the TAILHUB_DOWNLOAD_DIR env var.
"""
from __future__ import annotations

import os
import pathlib

# Where received Taildrop files land.
# Default: ~/Downloads/TailHub
_default = pathlib.Path.home() / "Downloads" / "TailHub"
DOWNLOAD_DIR = pathlib.Path(os.environ.get("TAILHUB_DOWNLOAD_DIR", _default))

# Host / port the server binds to.
HOST = os.environ.get("TAILHUB_HOST", "127.0.0.1")
PORT = int(os.environ.get("TAILHUB_PORT", "8080"))
