"""
main.py — TailHub entry point.
Run with:  uv run python main.py
Or:        uv run uvicorn tailhub.app:app --reload
"""
import uvicorn
from tailhub.config import HOST, PORT

if __name__ == "__main__":
    print(f"🦔 TailHub running at http://{HOST}:{PORT}")
    uvicorn.run(
        "tailhub.app:app",
        host=HOST,
        port=PORT,
        reload=False,
    )
