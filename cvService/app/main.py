import sys
import os
import logging
import traceback
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, TypeVar

from dotenv import load_dotenv

_app_dir = Path(__file__).resolve().parent
sys.path.append(str(_app_dir))
load_dotenv(_app_dir.parent / ".env")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import tempfile
import shutil
import requests
from typing import Optional
from pydantic import BaseModel
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from inference import (
    get_detector,
    ONNXYOLODetector,
    borrow_detector,
    init_detector_pool,
    max_concurrent_videos,
    default_frame_interval,
)
from progress import clear_shard_progress, get_shard_progress, set_shard_progress

app = FastAPI(title="Vineyard CV Service")
logger = logging.getLogger("cvservice")
_DEFAULT_FRAME_INTERVAL = default_frame_interval()

T = TypeVar("T")

_video_semaphore: asyncio.Semaphore | None = None
_video_executor: ThreadPoolExecutor | None = None


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def max_concurrent_videos_limit() -> int:
    return max_concurrent_videos()


def uvicorn_workers() -> int:
    return max(1, _env_int("CV_UVICORN_WORKERS", 1))


async def run_video_task(fn: Callable[..., T], *args, **kwargs) -> T:
    """CPU-bound обработка видео в отдельном потоке."""
    if _video_semaphore is None:
        return fn(*args, **kwargs)

    async with _video_semaphore:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _video_executor_workers(),
            lambda: fn(*args, **kwargs),
        )


def _video_executor_workers() -> ThreadPoolExecutor:
    global _video_executor
    if _video_executor is None:
        workers = max_concurrent_videos_limit()
        _video_executor = ThreadPoolExecutor(
            max_workers=workers,
            thread_name_prefix="cv-worker",
        )
    return _video_executor


@app.on_event("startup")
async def startup_event():
    global _video_semaphore
    parallel = max_concurrent_videos()
    _video_semaphore = asyncio.Semaphore(parallel)
    _video_executor_workers()
    init_detector_pool(parallel)

    logger.info(
        "CV concurrency: uvicorn_workers=%s max_concurrent_videos=%s (max ~%s videos in parallel)",
        uvicorn_workers(),
        parallel,
        uvicorn_workers() * parallel,
    )


@app.on_event("shutdown")
async def shutdown_event():
    global _video_executor
    if _video_executor is not None:
        _video_executor.shutdown(wait=False, cancel_futures=True)
        _video_executor = None

@app.get("/")
async def root():
    try:
        detector = get_detector()
        classes = detector.class_names
        model_loaded = not getattr(detector, "is_dummy", False)
    except FileNotFoundError:
        classes = {}
        model_loaded = False
    onnx_providers = []
    if model_loaded:
        onnx_providers = list(getattr(detector, "onnx_providers", []) or [])

    return {
        "service": "Vineyard CV Service",
        "status": "running",
        "model_loaded": model_loaded,
        "classes": classes,
        "onnx_providers": onnx_providers,
        "cv_use_gpu": os.getenv("CV_USE_GPU", ""),
        "cv_enhance_frames": os.getenv("CV_ENHANCE_FRAMES", ""),
        "cv_frame_interval": _DEFAULT_FRAME_INTERVAL,
        "cv_skip_frame_decode": os.getenv("CV_SKIP_FRAME_DECODE", ""),
        "cv_gpu_io_binding": os.getenv("CV_GPU_IO_BINDING", ""),
        "concurrency": {
            "uvicorn_workers": uvicorn_workers(),
            "max_concurrent_videos": max_concurrent_videos(),
            "max_parallel_videos": uvicorn_workers() * max_concurrent_videos(),
            "cv_job_concurrency_hint": os.getenv("CV_JOB_CONCURRENCY", ""),
        },
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/shards/{shard_id}/processing_progress")
async def shard_processing_progress(shard_id: int):
    payload = get_shard_progress(shard_id)
    if payload is None:
        return {"shard_id": shard_id, "status": "idle"}
    return payload

@app.post("/process_video_shard")
async def process_video_shard(
    shard_id: int = Form(...),
    video_file: UploadFile = File(...),
    callback_url: Optional[str] = Form(None),
    frame_interval: int = Form(_DEFAULT_FRAME_INTERVAL)
):
    temp_path = None
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
            shutil.copyfileobj(video_file.file, tmp)
            temp_path = tmp.name
        
        results = await run_video_task(
            process_video_file,
            temp_path,
            frame_interval=frame_interval,
            shard_id=shard_id,
        )

        if callback_url:
            response = requests.post(callback_url, json=results)
            response.raise_for_status()
        
        return {"status": "success", "shard_id": shard_id}
        
    except Exception as e:
        if callback_url:
            try:
                requests.post(callback_url, json={"error": str(e)})
            except:
                pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

class ProcessFromMinioRequest(BaseModel):
    shard_id: int
    object_key: str
    callback_url: Optional[str] = None
    frame_interval: int = _DEFAULT_FRAME_INTERVAL
    bucket: Optional[str] = None


def process_minio_shard_worker(
    shard_id: int,
    object_key: str,
    bucket: Optional[str],
    frame_interval: int,
) -> dict:
    """Скачивание + inference в worker-потоке, чтобы event loop отвечал на /processing_progress."""
    clear_shard_progress(shard_id)
    set_shard_progress(
        shard_id,
        {
            "status": "processing",
            "progress_percent": 0,
            "processed_frames": 0,
            "frames_to_process": 0,
            "elapsed_seconds": 0,
            "eta_seconds": None,
        },
    )

    temp_path = None
    try:
        temp_path = download_from_minio(object_key, bucket)
        return process_video_file(
            temp_path,
            frame_interval=frame_interval,
            shard_id=shard_id,
        )
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)


@app.post("/process_video_shard_from_minio")
async def process_video_shard_from_minio(payload: ProcessFromMinioRequest):
    try:
        result = await run_video_task(
            process_minio_shard_worker,
            payload.shard_id,
            payload.object_key,
            payload.bucket,
            payload.frame_interval,
        )

        callback_delivered = False
        if payload.callback_url:
            try:
                cb = requests.post(
                    payload.callback_url, json=result, timeout=120
                )
                cb.raise_for_status()
                callback_delivered = True
            except Exception as ce:
                # Частый случай: CV в Docker, RAILS_URL=http://localhost — колбэк недостижим.
                # Результаты всё равно отдаём в теле ответа; Rails (VideoShardProcessorService) их применит.
                logger.warning(
                    "callback to vineyard failed (results in response body): %s", ce
                )

        out = {
            "status": "success",
            "shard_id": payload.shard_id,
            "callback_delivered": callback_delivered,
        }
        out.update(result)
        return out
    except Exception as e:
        logger.exception("process_video_shard_from_minio failed: %s", e)
        if payload.callback_url:
            try:
                requests.post(payload.callback_url, json={"error": str(e)}, timeout=30)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/model_info")
async def model_info():
    detector = get_detector()
    return {
        "model_path": "models/best.onnx",
        "classes": detector.class_names,
        "num_classes": len(detector.class_names),
        "input_size": f"{detector.input_width}x{detector.input_height}",
        "conf_threshold": detector.conf_threshold,
        "iou_threshold": detector.iou_threshold,
        "onnx_providers": list(getattr(detector, "onnx_providers", []) or []),
    }

@app.post("/process_video_sync")
async def process_video_sync(
    video_file: UploadFile = File(...),
    frame_interval: int = Form(_DEFAULT_FRAME_INTERVAL)
):
    temp_path = None
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
            shutil.copyfileobj(video_file.file, tmp)
            temp_path = tmp.name
        
        results = await run_video_task(
            process_video_file,
            temp_path,
            frame_interval=frame_interval,
        )

        return {
            "bushes_count": results["bushes_count"],
            "gaps_count": results["gaps_count"],
            "video_info": results["result_json"]["video_info"],
        }
        
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

def process_video_file(
    video_path: str,
    frame_interval: Optional[int] = None,
    shard_id: Optional[int] = None,
) -> dict:
    if frame_interval is None:
        frame_interval = default_frame_interval()
    try:
        with borrow_detector() as detector:
            if shard_id is not None:
                clear_shard_progress(shard_id)

            def on_progress(data: dict) -> None:
                if shard_id is not None:
                    set_shard_progress(shard_id, data)

            results = detector.process_video(
                video_path,
                frame_interval=frame_interval,
                on_progress=on_progress if shard_id is not None else None,
            )
    except FileNotFoundError as e:
        raise RuntimeError(
            "Модель ONNX не найдена (включён CV_STRICT_MODEL): положите cvService/models/best.onnx "
            "или уберите CV_STRICT_MODEL для режима заглушки."
        ) from e

    return {
        "bushes_count": results["statistics"]["bushes_count"],
        "gaps_count": results["statistics"]["gaps_count"],
        "result_json": {
            "bushes_positions": results["statistics"].get("bushes_positions", []),
            "gaps_positions": results["statistics"].get("gaps_positions", []),
            "video_info": results["video_info"],
            "tracking_stats": results["tracking_stats"],
            "details": results["statistics"]["details"],
            "row_sequence": results.get("row_sequence", []),
            "sequence_details": results.get("sequence_details", []),
            "row_length": results.get("row_length", 0)
        }
    }

def download_from_minio(object_key: str, bucket: Optional[str] = None) -> str:
    endpoint = os.getenv("MINIO_ENDPOINT")
    access_key = os.getenv("MINIO_ACCESS_KEY")
    secret_key = os.getenv("MINIO_SECRET_KEY")
    region = os.getenv("MINIO_REGION", "us-east-1")
    default_bucket = os.getenv("MINIO_BUCKET")
    use_ssl = os.getenv("MINIO_SECURE", "false").lower() == "true"

    if not endpoint or not access_key or not secret_key:
        raise RuntimeError("MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY must be set")

    target_bucket = bucket or default_bucket
    if not target_bucket:
        raise RuntimeError("MINIO_BUCKET must be set (or pass bucket in request)")

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        use_ssl=use_ssl,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )

    ext = os.path.splitext(object_key)[1] or ".mp4"
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            s3.download_fileobj(target_bucket, object_key, tmp)
            path = tmp.name
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        logger.error(
            "MinIO download failed bucket=%s key=%r code=%s",
            target_bucket,
            object_key,
            code,
        )
        raise RuntimeError(
            f"Не удалось скачать объект из MinIO (bucket={target_bucket}, key={object_key}): {code or e}"
        ) from e

    size = os.path.getsize(path)
    if size == 0:
        try:
            os.unlink(path)
        except OSError:
            pass
        raise RuntimeError(
            f"Объект в MinIO пустой (bucket={target_bucket}, key={object_key})"
        )

    logger.info("Downloaded from MinIO bucket=%s key=%r bytes=%s", target_bucket, object_key, size)
    return path