import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

_PROGRESS_DIR = Path(
    os.getenv("CV_PROGRESS_DIR", os.path.join(tempfile.gettempdir(), "cv_shard_progress"))
)


def _path(shard_id: int) -> Path:
    return _PROGRESS_DIR / f"{int(shard_id)}.json"


def set_shard_progress(shard_id: int, payload: Dict[str, Any]) -> None:
    _PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    data = dict(payload)
    data["shard_id"] = int(shard_id)
    data["updated_at"] = time.time()
    _path(shard_id).write_text(json.dumps(data), encoding="utf-8")


def get_shard_progress(shard_id: int) -> Optional[Dict[str, Any]]:
    path = _path(shard_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def clear_shard_progress(shard_id: int) -> None:
    try:
        _path(shard_id).unlink(missing_ok=True)
    except OSError:
        pass


def estimate_frames_to_process(total_frames: int, frame_interval: int) -> int:
    if total_frames <= 0:
        return 0
    interval = max(1, frame_interval)
    return (total_frames + interval - 1) // interval


def build_progress_payload(
    *,
    frame_interval: int,
    total_frames: int,
    processed_frames: int,
    elapsed_seconds: float,
    status: str = "processing",
) -> Dict[str, Any]:
    frames_to_process = estimate_frames_to_process(total_frames, frame_interval)
    progress_percent = 0
    if frames_to_process > 0:
        progress_percent = min(99, int(100 * processed_frames / frames_to_process))

    eta_seconds: Optional[float] = None
    fps_processed: Optional[float] = None
    if processed_frames > 0 and elapsed_seconds > 0:
        fps_processed = processed_frames / elapsed_seconds
        remaining = max(0, frames_to_process - processed_frames)
        if fps_processed > 0 and remaining > 0:
            eta_seconds = remaining / fps_processed
        elif remaining == 0:
            eta_seconds = 0.0

    return {
        "status": status,
        "frame_interval": max(1, frame_interval),
        "total_frames": total_frames,
        "frames_to_process": frames_to_process,
        "processed_frames": processed_frames,
        "progress_percent": progress_percent,
        "elapsed_seconds": round(elapsed_seconds, 2),
        "eta_seconds": round(eta_seconds, 1) if eta_seconds is not None else None,
        "fps_processed": round(fps_processed, 3) if fps_processed is not None else None,
    }
