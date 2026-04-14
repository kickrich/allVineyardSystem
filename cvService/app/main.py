import sys
import os
import logging
import traceback
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
import tempfile
import shutil
import requests
from typing import Optional
from pydantic import BaseModel
import boto3
from botocore.client import Config

from inference import get_detector, ONNXYOLODetector

app = FastAPI(title="Vineyard CV Service")
logger = logging.getLogger("cvservice")

@app.on_event("startup")
async def startup_event():
    try:
        get_detector()
    except Exception:
        pass

@app.get("/")
async def root():
    detector = get_detector()
    return {
        "service": "Vineyard CV Service",
        "status": "running",
        "model_loaded": detector is not None,
        "classes": detector.class_names
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.post("/process_video_shard")
async def process_video_shard(
    shard_id: int = Form(...),
    video_file: UploadFile = File(...),
    callback_url: Optional[str] = Form(None),
    frame_interval: int = Form(4)
):
    temp_path = None
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
            shutil.copyfileobj(video_file.file, tmp)
            temp_path = tmp.name
        
        detector = get_detector()
        results = detector.process_video(temp_path, frame_interval)
        
        result = {
            "bushes_count": results["statistics"]["bushes_count"],
            "gaps_count": results["statistics"]["gaps_count"],
            "bush_spacing_avg": results["statistics"]["bush_spacing_avg"],
            "result_json": {
                "video_info": results["video_info"],
                "tracking_stats": results["tracking_stats"],
                "details": results["statistics"]["details"],
                "row_sequence": results.get("row_sequence", []),
                "sequence_details": results.get("sequence_details", []),
                "row_length": results.get("row_length", 0)
            }
        }
        
        if callback_url:
            response = requests.post(callback_url, json=result)
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
    frame_interval: int = 4
    bucket: Optional[str] = None

@app.post("/process_video_shard_from_minio")
async def process_video_shard_from_minio(payload: ProcessFromMinioRequest):
    temp_path = None

    try:
        temp_path = download_from_minio(payload.object_key, payload.bucket)
        result = process_video_file(temp_path, frame_interval=payload.frame_interval)

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
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

@app.get("/model_info")
async def model_info():
    detector = get_detector()
    return {
        "model_path": "models/best.onnx",
        "classes": detector.class_names,
        "num_classes": len(detector.class_names),
        "input_size": f"{detector.input_width}x{detector.input_height}",
        "conf_threshold": detector.conf_threshold,
        "iou_threshold": detector.iou_threshold
    }

@app.post("/process_video_sync")
async def process_video_sync(
    video_file: UploadFile = File(...),
    frame_interval: int = Form(5)
):
    temp_path = None
    
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
            shutil.copyfileobj(video_file.file, tmp)
            temp_path = tmp.name
        
        detector = get_detector()
        results = detector.process_video(temp_path, frame_interval)
        
        return {
            "bushes_count": results["statistics"]["bushes_count"],
            "gaps_count": results["statistics"]["gaps_count"],
            "bush_spacing_avg": results["statistics"]["bush_spacing_avg"],
            "row_spacing": results["statistics"]["row_spacing"],
            "video_info": results["video_info"]
        }
        
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)

def process_video_file(video_path: str, frame_interval: int = 4) -> dict:
    detector = get_detector()
    results = detector.process_video(video_path, frame_interval=frame_interval)

    return {
        "bushes_count": results["statistics"]["bushes_count"],
        "gaps_count": results["statistics"]["gaps_count"],
        "bush_spacing_avg": results["statistics"]["bush_spacing_avg"],
        "result_json": {
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
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        s3.download_fileobj(target_bucket, object_key, tmp)
        return tmp.name