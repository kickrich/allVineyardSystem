import logging
import cv2
import numpy as np
import onnxruntime as ort
from typing import List, Dict, Optional, Tuple
from collections import defaultdict
import os
import time
from pathlib import Path

from image_enhancement import VineTrunkEnhancer

_logger = logging.getLogger("cvservice")

# Корень cvService/ — путь к ONNX не зависит от cwd при запуске uvicorn.
_CV_ROOT = Path(__file__).resolve().parent.parent


def default_onnx_path() -> str:
    return str(_CV_ROOT / "models" / "best.onnx")

class ONNXYOLODetector:
    def __init__(self, model_path: str = 'models/best.onnx', enhance_frames: bool = True):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Модель не найдена: {model_path}")
        
        self.session = ort.InferenceSession(model_path)

        in0 = self.session.get_inputs()[0]
        self.input_name = in0.name
        self.input_shape = in0.shape
        self.output_names = [output.name for output in self.session.get_outputs()]

        self.input_width, self.input_height = self._parse_spatial_hw(in0.shape)
        self.conf_threshold = 0.25
        self.iou_threshold = 0.45
        
        self.class_names = {
            0: "grape_bush",
            1: "gap"
        }
        
        self.track_history = defaultdict(list)
        self.next_track_id = 0
        self.max_history = 30
        
        self.enhance_frames = enhance_frames
        if enhance_frames:
            self.enhancer = VineTrunkEnhancer({
                'green_suppression': 0.6,
                'brown_enhancement': 1.8,
                'texture_enhancement': 2.0,
                'shadow_removal': True,
                'bilateral_filter': True,
                'edge_enhancement': True,
                'clahe_clip_limit': 3.0,
            })
        else:
            self.enhancer = None

    @staticmethod
    def _parse_spatial_hw(shape) -> Tuple[int, int]:
        """Из shape входа ONNX [N,C,H,W] берём H,W; при символических размерах — 640."""
        h, w = 640, 640
        if shape is None or len(shape) < 4:
            return w, h
        dim_h, dim_w = shape[2], shape[3]
        if isinstance(dim_h, int) and dim_h > 0:
            h = dim_h
        if isinstance(dim_w, int) and dim_w > 0:
            w = dim_w
        return w, h

    @staticmethod
    def _sigmoid(x: np.ndarray) -> np.ndarray:
        x = np.clip(x.astype(np.float32), -80.0, 80.0)
        return 1.0 / (1.0 + np.exp(-x))

    def preprocess(self, image: np.ndarray) -> np.ndarray:
        image = cv2.resize(image, (self.input_width, self.input_height))
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        image = image.astype(np.float32) / 255.0
        image = np.transpose(image, (2, 0, 1))
        image = np.expand_dims(image, axis=0)
        return image
    
    def postprocess(self, outputs: List[np.ndarray], orig_shape: Tuple[int, int]) -> List[Dict]:
        """
        YOLO Ultralytics ONNX: выход [1, 4+nc, N] (например [1, 6, 8400] для 2 классов).
        Координаты — центр xy и wh в пикселях входа модели; классы — логиты → sigmoid.
        """
        orig_h, orig_w = orig_shape
        out = np.asarray(outputs[0])
        if out.ndim == 3:
            out = out[0]

        nc = len(self.class_names)
        feat = 4 + nc
        if out.shape[0] == feat and out.shape[0] < out.shape[1]:
            preds = out.T
        elif out.shape[1] == feat:
            preds = out
        elif out.shape[0] < out.shape[1]:
            preds = out.T
        else:
            preds = out

        if preds.shape[1] < feat:
            return []

        boxes = preds[:, :4].astype(np.float32)
        logits = preds[:, 4:feat].astype(np.float32)
        probs = self._sigmoid(logits)

        class_ids = np.argmax(probs, axis=1)
        confidences = probs[np.arange(probs.shape[0], dtype=np.int64), class_ids]
        mask = confidences >= self.conf_threshold
        idxs = np.nonzero(mask)[0]

        detections = []
        for i in idxs:
            xc, yc, w, h = boxes[i]
            class_id = int(class_ids[i])
            confidence = float(confidences[i])

            x1 = (xc - w / 2) * orig_w / self.input_width
            y1 = (yc - h / 2) * orig_h / self.input_height
            x2 = (xc + w / 2) * orig_w / self.input_width
            y2 = (yc + h / 2) * orig_h / self.input_height

            x1 = float(np.clip(x1, 0.0, max(0.0, orig_w - 1.0)))
            y1 = float(np.clip(y1, 0.0, max(0.0, orig_h - 1.0)))
            x2 = float(np.clip(x2, 0.0, max(0.0, orig_w - 1.0)))
            y2 = float(np.clip(y2, 0.0, max(0.0, orig_h - 1.0)))
            if x2 <= x1 or y2 <= y1:
                continue

            detections.append(
                {
                    "bbox": [float(x1), float(y1), float(x2), float(y2)],
                    "confidence": confidence,
                    "class_id": class_id,
                    "class_name": self.class_names.get(class_id, f"class_{class_id}"),
                }
            )

        return self.nms(detections)
    
    def nms(self, detections: List[Dict]) -> List[Dict]:
        if not detections:
            return []
        
        detections = sorted(detections, key=lambda x: x['confidence'], reverse=True)
        keep = []
        
        while detections:
            best = detections.pop(0)
            keep.append(best)
            
            detections = [d for d in detections if self.iou(best['bbox'], d['bbox']) < self.iou_threshold]
        
        return keep
    
    def iou(self, box1: List[float], box2: List[float]) -> float:
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])
        
        intersection = max(0, x2 - x1) * max(0, y2 - y1)
        
        area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
        area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
        union = area1 + area2 - intersection
        
        return intersection / union if union > 0 else 0
    
    def track_detections(self, detections: List[Dict]) -> List[Dict]:
        if not detections:
            self.track_history.clear()
            return []
        
        if not self.track_history:
            for det in detections:
                det['track_id'] = self.next_track_id
                self.track_history[self.next_track_id].append({
                    'bbox': det['bbox'],
                    'frame': self.current_frame
                })
                self.next_track_id += 1
            return detections
        
        matched = []
        unmatched_detections = list(range(len(detections)))
        unmatched_tracks = list(self.track_history.keys())
        
        iou_matrix = np.zeros((len(unmatched_tracks), len(detections)))
        for i, track_id in enumerate(unmatched_tracks):
            last_pos = self.track_history[track_id][-1]['bbox']
            for j, det_idx in enumerate(unmatched_detections):
                iou_matrix[i, j] = self.iou(last_pos, detections[det_idx]['bbox'])
        
        while iou_matrix.size > 0 and unmatched_tracks and unmatched_detections:
            max_iou_idx = np.unravel_index(np.argmax(iou_matrix), iou_matrix.shape)
            max_iou = iou_matrix[max_iou_idx]
            
            if max_iou < 0.3:
                break
            
            track_idx, det_idx = max_iou_idx
            track_id = unmatched_tracks[track_idx]
            det_index = unmatched_detections[det_idx]
            
            detections[det_index]['track_id'] = track_id
            self.track_history[track_id].append({
                'bbox': detections[det_index]['bbox'],
                'frame': self.current_frame
            })
            matched.append(det_index)
            
            unmatched_tracks.pop(track_idx)
            unmatched_detections.pop(det_idx)
            iou_matrix = np.delete(iou_matrix, track_idx, axis=0)
            iou_matrix = np.delete(iou_matrix, det_idx, axis=1)
        
        for det_idx in unmatched_detections:
            detections[det_idx]['track_id'] = self.next_track_id
            self.track_history[self.next_track_id].append({
                'bbox': detections[det_idx]['bbox'],
                'frame': self.current_frame
            })
            self.next_track_id += 1
        
        for track_id in list(self.track_history.keys()):
            if len(self.track_history[track_id]) > self.max_history:
                self.track_history[track_id] = self.track_history[track_id][-self.max_history:]
        
        return detections
    
    def detect_frame(self, frame: np.ndarray, frame_number: int) -> List[Dict]:
        self.current_frame = frame_number
        
        if self.enhancer:
            enhanced_frame = self.enhancer.enhance_for_trunk_detection(frame)
        else:
            enhanced_frame = frame
        
        orig_shape = enhanced_frame.shape[:2]
        input_tensor = self.preprocess(enhanced_frame)
        
        outputs = self.session.run(self.output_names, {self.input_name: input_tensor})
        
        detections = self.postprocess(outputs, orig_shape)
        
        detections = self.track_detections(detections)
        
        return detections
    
    def process_video(self, video_path: str, frame_interval: int = 4) -> Dict:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Не удалось открыть видео: {video_path}")

        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        # WebM и часть контейнеров дают fps=0 — иначе деление в video_info даёт ZeroDivisionError → 500 в API.
        if fps <= 0:
            fps = 25.0
        
        frame_count = 0
        processed_frames = 0
        
        unique_bushes = set()
        unique_gaps = set()
        
        bushes_positions = []
        
        row_sequence = []
        tracked_objects = {}
        
        start_time = time.time()
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_count % frame_interval == 0:
                detections = self.detect_frame(frame, frame_count)
                
                detections.sort(key=lambda d: (d['bbox'][0] + d['bbox'][2]) / 2)
                
                for det in detections:
                    x1, y1, x2, y2 = det['bbox']
                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2
                    
                    if det['class_name'] == 'grape_bush':
                        unique_bushes.add(det['track_id'])
                        
                        bushes_positions.append({
                            'track_id': det['track_id'],
                            'frame': frame_count,
                            'x': center_x,
                            'y': center_y,
                            'confidence': det['confidence']
                        })
                        
                        if det['track_id'] not in tracked_objects:
                            tracked_objects[det['track_id']] = {
                                'order': len(row_sequence) + 1,
                                'type': 'bush'
                            }
                            row_sequence.append({
                                'track_id': det['track_id'],
                                'order': len(row_sequence) + 1,
                                'type': 'bush'
                            })
                        
                    elif det['class_name'] == 'gap':
                        unique_gaps.add(det['track_id'])
                        
                        if det['track_id'] not in tracked_objects:
                            tracked_objects[det['track_id']] = {
                                'order': len(row_sequence) + 1,
                                'type': 'gap'
                            }
                            row_sequence.append({
                                'track_id': det['track_id'],
                                'order': len(row_sequence) + 1,
                                'type': 'gap'
                            })
                
                processed_frames += 1
            
            frame_count += 1
        
        cap.release()
        processing_time = time.time() - start_time
        
        display_sequence = []
        for item in sorted(row_sequence, key=lambda x: x['order']):
            display_sequence.append(item['type'])
        
        sequence_details = []
        for item in sorted(row_sequence, key=lambda x: x['order']):
            sequence_details.append({
                'position': item['order'],
                'type': item['type'],
                'track_id': item['track_id']
            })
        
        statistics = self.calculate_statistics(
            unique_bushes, 
            unique_gaps, 
            bushes_positions,
            frame_count,
            fps
        )
        
        duration = (total_frames / fps) if fps > 0 else 0.0
        return {
            "video_info": {
                "total_frames": total_frames,
                "fps": fps,
                "duration": duration,
                "processed_frames": processed_frames,
                "processing_time": processing_time
            },
            "statistics": statistics,
            "tracking_stats": {
                "unique_bushes": len(unique_bushes),
                "unique_gaps": len(unique_gaps),
                "total_tracks": len(unique_bushes) + len(unique_gaps)
            },
            "row_sequence": display_sequence,
            "sequence_details": sequence_details,
            "row_length": len(row_sequence)
        }
    
    def calculate_statistics(self, unique_bushes, unique_gaps, bushes_positions, total_frames, fps):
        bush_spacing_avg = self._calculate_bush_spacing(bushes_positions)
        row_spacing = self._calculate_row_spacing(bushes_positions)
        
        return {
            "bushes_count": len(unique_bushes),
            "gaps_count": len(unique_gaps),
            "bush_spacing_avg": bush_spacing_avg,
            "row_spacing": row_spacing,
            "details": {
                "processed_frames": len(set(p['frame'] for p in bushes_positions)),
                "total_positions": len(bushes_positions),
                "enhancement_enabled": self.enhance_frames
            }
        }
    
    def _calculate_bush_spacing(self, positions):
        if len(positions) < 10:
            return 0.0
        
        by_track = defaultdict(list)
        for pos in positions:
            by_track[pos['track_id']].append(pos)
        
        for track_id, track_positions in by_track.items():
            if len(track_positions) >= 3:
                track_positions.sort(key=lambda p: p['frame'])
                
                x_positions = [p['x'] for p in track_positions[:3]]
                
                distances = []
                for i in range(1, len(x_positions)):
                    distances.append(abs(x_positions[i] - x_positions[i-1]))
                
                if distances:
                    return sum(distances) / len(distances)
        
        return 0.0
    
    def _calculate_row_spacing(self, positions):
        if len(positions) < 10:
            return 0.0
        
        y_positions = sorted(list(set([p['y'] for p in positions])))
        
        if len(y_positions) < 2:
            return 0.0
        
        distances = []
        for i in range(1, min(5, len(y_positions))):
            distances.append(abs(y_positions[i] - y_positions[i-1]))
        
        if distances:
            return sum(distances) / len(distances)
        
        return 0.0


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


class DummyVideoDetector:
    """Без ONNX: проверяет чтение видео, возвращает нулевые метрики (dev / CI)."""

    is_dummy = True
    class_names = {0: "grape_bush", 1: "gap"}
    enhance_frames = False
    input_width = 640
    input_height = 640
    conf_threshold = 0.25
    iou_threshold = 0.45

    def process_video(self, video_path: str, frame_interval: int = 4) -> Dict:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Не удалось открыть видео: {video_path}")

        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if fps <= 0:
            fps = 25.0
        total_frames_meta = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        start = time.time()
        frame_count = 0
        while True:
            ret, _ = cap.read()
            if not ret:
                break
            frame_count += 1
        cap.release()

        elapsed = time.time() - start
        processed_frames = 0
        if frame_interval > 0 and frame_count > 0:
            processed_frames = sum(1 for i in range(frame_count) if i % frame_interval == 0)

        duration = (total_frames_meta / fps) if total_frames_meta > 0 and fps > 0 else (
            frame_count / fps if fps > 0 else 0.0
        )

        statistics: Dict = {
            "bushes_count": 0,
            "gaps_count": 0,
            "bush_spacing_avg": 0.0,
            "row_spacing": 0.0,
            "details": {
                "processed_frames": processed_frames,
                "total_positions": 0,
                "enhancement_enabled": False,
            },
        }

        return {
            "video_info": {
                "total_frames": frame_count,
                "fps": fps,
                "duration": duration,
                "processed_frames": processed_frames,
                "processing_time": elapsed,
            },
            "statistics": statistics,
            "tracking_stats": {
                "unique_bushes": 0,
                "unique_gaps": 0,
                "total_tracks": 0,
            },
            "row_sequence": [],
            "sequence_details": [],
            "row_length": 0,
        }


_detector = None


def get_detector(model_path: Optional[str] = None, enhance_frames: bool = True):
    global _detector
    if _detector is not None:
        return _detector

    raw = (model_path or default_onnx_path()).strip()
    path = raw if os.path.isabs(raw) else str(_CV_ROOT / raw)

    if os.path.isfile(path):
        _detector = ONNXYOLODetector(path, enhance_frames)
        return _detector

    if _env_truthy("CV_STRICT_MODEL"):
        raise FileNotFoundError(f"Модель не найдена: {path}")

    if _env_truthy("CV_DUMMY_INFERENCE"):
        _logger.warning(
            "CV_DUMMY_INFERENCE: модель %s не найдена, заглушка (метрики = 0)",
            path,
        )
    else:
        _logger.warning(
            "ONNX не найден (%s): заглушка (метрики = 0). Положите веса или задайте CV_STRICT_MODEL=1 для ошибки.",
            path,
        )

    _detector = DummyVideoDetector()
    return _detector