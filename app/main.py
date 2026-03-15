from datetime import datetime, timezone

from fastapi import FastAPI

app = FastAPI()


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
