from fastapi import FastAPI
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


app = FastAPI()


@app.get("/api/health")
def health():
    return {"status": "ok", "updated_at": now_iso()}
