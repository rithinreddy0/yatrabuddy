"""Local API launcher: load server secrets without exposing them to Vite."""

import argparse
import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv


def main():
    parser = argparse.ArgumentParser(description="Run the YatraBuddy API")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    load_dotenv(root / ".env", override=False)
    os.environ.setdefault("PUBLIC_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3010,http://127.0.0.1:3010")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=args.port,
                reload=args.reload, reload_dirs=[str(root / "backend")] if args.reload else None,
                access_log=False)


if __name__ == "__main__":
    main()
