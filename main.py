"""
main.py — TailHub entry point.
Run with:  uv run python main.py
Or:        uv run uvicorn tailhub.app:app --reload
"""
import argparse
import os

import uvicorn


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the TailHub server.")
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        help="Port for the web UI and API. Overrides TAILHUB_PORT.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    from tailhub import config

    port = args.port if args.port is not None else config.PORT
    if not 1 <= port <= 65535:
        raise SystemExit("Port must be between 1 and 65535.")

    if args.port is not None:
        os.environ["TAILHUB_PORT"] = str(port)
        config.PORT = port

    print(f"🦔 TailHub running at http://{config.HOST}:{port}")
    uvicorn.run(
        "tailhub.app:app",
        host=config.HOST,
        port=port,
        reload=False,
    )


if __name__ == "__main__":
    main()
