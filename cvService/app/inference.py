import logging
import cv2
import numpy as np
import onnxruntime as ort
from typing import List, Dict, Optional, Tuple, Callable
from collections import defaultdict
import os
import time
import threading
import queue
from contextlib import contextmanager
from pathlib import Path

from image_enhancement import VineTrunkEnhancer
from progress import build_progress_payload

_logger = logging.getLogger("cvservice")


def _track_median_xs(positions: List[Dict]) -> List[float]:
    if not positions:
        return []

    by_track: Dict[int, List[float]] = defaultdict(list)
    for p in positions:
        by_track[int(p["track_id"])].append(float(p["x"]))
    return sorted(float(np.median(xs)) for xs in by_track.values())


def _cluster_sorted_medians(medians: List[float]) -> List[float]:
    """Сливает близкие median-x в один объект; возвращает якоря кластеров."""
    if not medians:
        return []
    if len(medians) == 1:
        return medians

    gaps = [medians[i + 1] - medians[i] for i in range(len(medians) - 1)]
    positive_gaps = [g for g in gaps if g > 1.0]
    if positive_gaps:
        typical_gap = float(np.median(positive_gaps))
        merge_threshold = max(20.0, min(100.0, typical_gap * 0.45))
    else:
        merge_threshold = 40.0

    anchors = [medians[0]]
    cluster_anchor = medians[0]
    for x in medians[1:]:
        if x - cluster_anchor > merge_threshold:
            anchors.append(x)
            cluster_anchor = x
    return anchors


def _summarize_positions(
    positions: List[Dict],
    obj_type: str,
    min_hits: int,
) -> List[Dict]:
    by_track: Dict[int, Dict] = {}
    for p in positions:
        track_id = int(p["track_id"])
        entry = by_track.setdefault(
            track_id,
            {
                "track_id": track_id,
                "type": obj_type,
                "xs": [],
                "confs": [],
                "frames": set(),
            },
        )
        entry["xs"].append(float(p["x"]))
        entry["confs"].append(float(p["confidence"]))
        entry["frames"].add(int(p["frame"]))

    summaries: List[Dict] = []
    for entry in by_track.values():
        hits = len(entry["frames"])
        if hits < min_hits:
            continue
        summaries.append(
            {
                "track_id": entry["track_id"],
                "median_x": float(np.median(entry["xs"])),
                "type": obj_type,
                "hits": hits,
                "max_conf": float(max(entry["confs"])),
                "first_frame": min(entry["frames"]),
                "last_frame": max(entry["frames"]),
            }
        )
    return sorted(summaries, key=lambda s: s["median_x"])


def _summarize_tracks(
    bushes_positions: List[Dict],
    gaps_positions: List[Dict],
    min_bush_hits: int = 2,
    min_gap_hits: int = 3,
) -> List[Dict]:
    """Один summary на track_id; отсекаем одноразовые ложные детекции."""
    summaries = _summarize_positions(bushes_positions, "bush", min_bush_hits)
    summaries.extend(_summarize_positions(gaps_positions, "gap", min_gap_hits))
    return sorted(summaries, key=lambda s: s["median_x"])


def _cluster_summaries_by_x(
    summaries: List[Dict],
    same_type_threshold: Optional[float] = None,
    cross_type_threshold: Optional[float] = None,
) -> List[Dict]:
    """Слияние track_id по близости median-x (устойчиво к джиттеру GPU-трекера)."""
    if not summaries:
        return []

    xs = sorted(s["median_x"] for s in summaries)
    if same_type_threshold is None or cross_type_threshold is None:
        same_type_threshold, cross_type_threshold = _merge_threshold_from_xs(xs)

    clusters: List[Dict] = []
    for summary in summaries:
        if not clusters:
            clusters.append({"members": [summary], "anchor_x": summary["median_x"]})
            continue

        cluster = clusters[-1]
        dist = summary["median_x"] - cluster["anchor_x"]
        last_type = cluster["members"][-1]["type"]
        same_type = summary["type"] == last_type
        threshold = same_type_threshold if same_type else cross_type_threshold

        if dist <= threshold:
            cluster["members"].append(summary)
            cluster["anchor_x"] = float(
                np.median([m["median_x"] for m in cluster["members"]])
            )
        else:
            clusters.append({"members": [summary], "anchor_x": summary["median_x"]})

    return clusters


def _merge_threshold_from_xs(xs: List[float]) -> Tuple[float, float]:
    """Порог слияния дубликатов track_id и более жёсткий порог bush+gap в одной точке."""
    if len(xs) < 2:
        return 50.0, 14.0

    gaps = [xs[i + 1] - xs[i] for i in range(len(xs) - 1) if xs[i + 1] - xs[i] > 1.0]
    if not gaps:
        return 50.0, 14.0

    typical_gap = float(np.median(gaps))
    same_type = float(np.clip(typical_gap * 0.58, 28.0, 110.0))
    cross_type = min(16.0, same_type * 0.28)
    return same_type, cross_type


def cluster_row_tracks(
    bushes_positions: List[Dict],
    gaps_positions: List[Dict],
    min_bush_hits: int = 2,
    min_gap_hits: int = 3,
) -> List[Dict]:
    """
    Единая кластеризация кустов и пропусков по X для row_sequence.
    Счётчики bushes/gaps считаются отдельно в build_spatial_row_sequence.
    """
    summaries = _summarize_tracks(bushes_positions, gaps_positions, min_bush_hits, min_gap_hits)
    if not summaries:
        return []

    xs = sorted(s["median_x"] for s in summaries)
    same_type_threshold, cross_type_threshold = _merge_threshold_from_xs(xs)
    clusters = _cluster_summaries_by_x(
        summaries, same_type_threshold, cross_type_threshold
    )

    resolved: List[Dict] = []
    for cluster in clusters:
        bush_score = sum(
            m["hits"] * m["max_conf"] for m in cluster["members"] if m["type"] == "bush"
        )
        gap_score = sum(
            m["hits"] * m["max_conf"] for m in cluster["members"] if m["type"] == "gap"
        )
        obj_type = "gap" if gap_score > bush_score * 1.35 else "bush"
        resolved.append(
            {
                "median_x": cluster["anchor_x"],
                "type": obj_type,
                "bush_score": bush_score,
                "gap_score": gap_score,
                "first_frame": min(m["first_frame"] for m in cluster["members"]),
            }
        )
    return sorted(resolved, key=lambda item: item["median_x"])


def _min_track_hits() -> Tuple[int, int]:
    return (
        max(2, _env_int("CV_MIN_BUSH_HITS", 2)),
        max(3, _env_int("CV_MIN_GAP_HITS", 4)),
    )


def build_spatial_row_sequence(
    bushes_positions: List[Dict],
    gaps_positions: List[Dict],
    frame_interval: int = 4,
    processed_frames: int = 0,
) -> Tuple[List[str], List[Dict], int, int]:
    del frame_interval, processed_frames
    min_bush, min_gap = _min_track_hits()

    bush_summaries = _summarize_positions(bushes_positions, "bush", min_bush)
    gap_summaries = _summarize_positions(gaps_positions, "gap", min_gap)

    all_xs = sorted(s["median_x"] for s in bush_summaries + gap_summaries)
    same_type_threshold, _ = _merge_threshold_from_xs(all_xs) if len(all_xs) >= 2 else (50.0, 14.0)

    bush_clusters = _cluster_summaries_by_x(bush_summaries, same_type_threshold, same_type_threshold)
    gap_clusters = _cluster_summaries_by_x(gap_summaries, same_type_threshold, same_type_threshold)

    clusters = cluster_row_tracks(
        bushes_positions,
        gaps_positions,
        min_bush_hits=min_bush,
        min_gap_hits=min_gap,
    )
    display_sequence = [c["type"] for c in clusters]
    sequence_details = [
        {
            "position": idx + 1,
            "type": item["type"],
            "median_x": item["median_x"],
            "bush_score": item["bush_score"],
            "gap_score": item["gap_score"],
        }
        for idx, item in enumerate(clusters)
    ]
    bush_anchors = sorted(c["anchor_x"] for c in bush_clusters)
    gap_anchors = sorted(c["anchor_x"] for c in gap_clusters)
    bushes_count = len(_cluster_sorted_medians(bush_anchors)) if bush_anchors else 0
    gaps_count = len(_cluster_sorted_medians(gap_anchors)) if gap_anchors else 0
    return display_sequence, sequence_details, bushes_count, gaps_count


def _spatial_count_threshold() -> int:
    return max(40, _env_int("CV_SPATIAL_COUNT_THRESHOLD", 120))


# Корень cvService/ — путь к ONNX не зависит от cwd при запуске uvicorn.
_CV_ROOT = Path(__file__).resolve().parent.parent


def max_concurrent_videos() -> int:
    return max(1, min(_env_int("CV_MAX_CONCURRENT_VIDEOS", 1), 8))


def default_onnx_path() -> str:
    return str(_CV_ROOT / "models" / "best.onnx")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in ("1", "true", "yes", "on")


def default_frame_interval() -> int:
    return max(1, min(_env_int("CV_FRAME_INTERVAL", 4), 120))


def _env_enhance_frames() -> bool:
    raw = os.getenv("CV_ENHANCE_FRAMES", "").strip().lower()
    if _env_use_gpu():
        if raw in ("1", "true", "yes", "on") and _env_truthy("CV_ALLOW_GPU_ENHANCE"):
            return True
        if raw in ("1", "true", "yes", "on"):
            _logger.warning(
                "CV_ENHANCE_FRAMES=true ignored on GPU (CPU enhancement → hours per video). "
                "Set CV_ALLOW_GPU_ENHANCE=1 only for debugging."
            )
        return False
    if not raw:
        return True
    return raw in ("1", "true", "yes", "on")


def _env_gpu_io_binding() -> bool:
    raw = os.getenv("CV_GPU_IO_BINDING", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return _env_use_gpu()


def _env_skip_frame_decode() -> bool:
    raw = os.getenv("CV_SKIP_FRAME_DECODE", "").strip().lower()
    if not raw:
        return True
    return raw in ("1", "true", "yes", "on")


def _env_use_gpu() -> bool:
    raw = os.getenv("CV_USE_GPU", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return "CUDAExecutionProvider" in ort.get_available_providers()


def _build_session_options() -> ort.SessionOptions:
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    default_intra = 1 if _env_use_gpu() else 4
    so.intra_op_num_threads = max(1, _env_int("CV_ORT_INTRA_THREADS", default_intra))
    so.inter_op_num_threads = max(1, _env_int("CV_ORT_INTER_THREADS", 1))
    return so


def _cuda_provider_options() -> dict:
    algo = os.getenv("CV_CUDA_CUDNN_CONV_ALGO", "HEURISTIC").strip().upper()
    if algo not in ("HEURISTIC", "EXHAUSTIVE", "DEFAULT"):
        algo = "HEURISTIC"
    opts = {
        "device_id": _env_int("CV_CUDA_DEVICE_ID", 0),
        "arena_extend_strategy": "kNextPowerOfTwo",
        "cudnn_conv_algo_search": algo,
        "do_copy_in_default_stream": True,
    }
    gpu_mem_mb = _env_int("CV_CUDA_GPU_MEM_MB", 0)
    if gpu_mem_mb > 0:
        opts["gpu_mem_limit"] = gpu_mem_mb * 1024 * 1024
    return opts


def create_onnx_session(model_path: str) -> ort.InferenceSession:
    available = ort.get_available_providers()
    use_gpu = _env_use_gpu()
    so = _build_session_options()

    if use_gpu and "CUDAExecutionProvider" in available:
        providers: List = [
            ("CUDAExecutionProvider", _cuda_provider_options()),
            "CPUExecutionProvider",
        ]
    else:
        providers = ["CPUExecutionProvider"]
        if use_gpu:
            _logger.warning(
                "CV_USE_GPU включён, но CUDAExecutionProvider недоступен (available=%s)",
                available,
            )

    session = ort.InferenceSession(model_path, sess_options=so, providers=providers)
    _logger.info(
        "ONNX session providers: %s (intra=%s inter=%s)",
        session.get_providers(),
        so.intra_op_num_threads,
        so.inter_op_num_threads,
    )
    return session


class ONNXYOLODetector:
    def __init__(self, model_path: str = "models/best.onnx", enhance_frames: bool = True):
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Модель не найдена: {model_path}")

        self.session = create_onnx_session(model_path)
        self.onnx_providers = self.session.get_providers()

        in0 = self.session.get_inputs()[0]
        self.input_name = in0.name
        self.input_shape = in0.shape
        self.output_names = [output.name for output in self.session.get_outputs()]

        self.input_width, self.input_height = self._parse_spatial_hw(in0.shape)
        self.conf_threshold = 0.25
        self.iou_threshold = 0.45

        self.class_names = {
            0: "grape_bush",
            1: "gap",
        }

        self.track_history = defaultdict(list)
        self.track_classes: Dict[int, str] = {}
        self.next_track_id = 0
        self.max_history = 30
        self.max_stale_frames = _env_int("CV_TRACK_STALE_FRAMES", 120)
        self.track_match_iou = float(
            np.clip(_env_int("CV_TRACK_IOU_MATCH", 20) / 100.0, 0.05, 0.6)
        )

        self.enhance_frames = enhance_frames
        self._cuda_device_id = _env_int("CV_CUDA_DEVICE_ID", 0)
        self._use_gpu_iobinding = (
            _env_gpu_io_binding()
            and "CUDAExecutionProvider" in self.onnx_providers
        )
        self._io_binding = None
        self._input_ort = None
        if enhance_frames:
            self.enhancer = VineTrunkEnhancer(
                {
                    "green_suppression": 0.6,
                    "brown_enhancement": 1.8,
                    "texture_enhancement": 2.0,
                    "shadow_removal": True,
                    "bilateral_filter": True,
                    "edge_enhancement": True,
                    "clahe_clip_limit": 3.0,
                }
            )
        else:
            self.enhancer = None

        self._setup_gpu_iobinding()

    def _setup_gpu_iobinding(self) -> None:
        if not self._use_gpu_iobinding:
            return
        self._io_binding = self.session.io_binding()
        for name in self.output_names:
            self._io_binding.bind_output(name, "cuda", self._cuda_device_id)

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

        detections = sorted(detections, key=lambda x: x["confidence"], reverse=True)
        keep = []

        while detections:
            best = detections.pop(0)
            keep.append(best)
            detections = [
                d
                for d in detections
                if d["class_id"] != best["class_id"]
                or self.iou(best["bbox"], d["bbox"]) < self.iou_threshold
            ]

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

    @staticmethod
    def _bbox_center(bbox: List[float]) -> Tuple[float, float]:
        return (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2

    def track_match_score(self, track_bbox: List[float], det_bbox: List[float]) -> float:
        iou = self.iou(track_bbox, det_bbox)
        if iou >= self.track_match_iou:
            return iou

        tcx, tcy = self._bbox_center(track_bbox)
        dcx, dcy = self._bbox_center(det_bbox)
        ref_w = max(track_bbox[2] - track_bbox[0], det_bbox[2] - det_bbox[0], 24.0)
        x_dist = abs(dcx - tcx)
        y_dist = abs(dcy - tcy)

        # Камера едет вдоль ряда: bbox смещается по X, Y почти стабилен.
        if y_dist <= ref_w * 0.9 and x_dist <= ref_w * 3.0:
            x_score = max(0.0, 1.0 - x_dist / (ref_w * 3.0))
            return max(iou, x_score * 0.9)
        return iou

    def _prune_stale_tracks(self) -> None:
        for track_id in list(self.track_history.keys()):
            last_frame = self.track_history[track_id][-1]["frame"]
            if self.current_frame - last_frame > self.max_stale_frames:
                del self.track_history[track_id]
                self.track_classes.pop(track_id, None)

    def reset_tracker(self) -> None:
        self.track_history.clear()
        self.track_classes.clear()
        self.next_track_id = 0

    def track_detections(self, detections: List[Dict]) -> List[Dict]:
        self._prune_stale_tracks()

        if not detections:
            # Не сбрасываем track_history: на пустом кадре иначе next_track_id
            # растёт бесконечно → len(unique_bushes) в тысячи на длинном видео.
            return []

        if not self.track_history:
            for det in detections:
                det["track_id"] = self.next_track_id
                self.track_classes[self.next_track_id] = det["class_name"]
                self.track_history[self.next_track_id].append(
                    {
                        "bbox": det["bbox"],
                        "frame": self.current_frame,
                    }
                )
                self.next_track_id += 1
            return detections

        unmatched_detections = list(range(len(detections)))
        unmatched_tracks = list(self.track_history.keys())

        score_matrix = np.zeros((len(unmatched_tracks), len(detections)))
        for i, track_id in enumerate(unmatched_tracks):
            track_class = self.track_classes.get(track_id)
            last_pos = self.track_history[track_id][-1]["bbox"]
            for j, det_idx in enumerate(unmatched_detections):
                det = detections[det_idx]
                if track_class and det["class_name"] != track_class:
                    continue
                score_matrix[i, j] = self.track_match_score(last_pos, det["bbox"])

        while score_matrix.size > 0 and unmatched_tracks and unmatched_detections:
            max_idx = np.unravel_index(np.argmax(score_matrix), score_matrix.shape)
            max_score = score_matrix[max_idx]

            if max_score < self.track_match_iou:
                break

            track_idx, det_idx = max_idx
            track_id = unmatched_tracks[track_idx]
            det_index = unmatched_detections[det_idx]

            detections[det_index]["track_id"] = track_id
            self.track_history[track_id].append(
                {
                    "bbox": detections[det_index]["bbox"],
                    "frame": self.current_frame,
                }
            )

            unmatched_tracks.pop(track_idx)
            unmatched_detections.pop(det_idx)
            score_matrix = np.delete(score_matrix, track_idx, axis=0)
            score_matrix = np.delete(score_matrix, det_idx, axis=1)

        for det_idx in unmatched_detections:
            detections[det_idx]["track_id"] = self.next_track_id
            self.track_classes[self.next_track_id] = detections[det_idx]["class_name"]
            self.track_history[self.next_track_id].append(
                {
                    "bbox": detections[det_idx]["bbox"],
                    "frame": self.current_frame,
                }
            )
            self.next_track_id += 1

        for track_id in list(self.track_history.keys()):
            if len(self.track_history[track_id]) > self.max_history:
                self.track_history[track_id] = self.track_history[track_id][-self.max_history :]

        return detections

    def detect_frame(self, frame: np.ndarray, frame_number: int) -> List[Dict]:
        self.current_frame = frame_number

        if self.enhancer:
            enhanced_frame = self.enhancer.enhance_for_trunk_detection(frame)
        else:
            enhanced_frame = frame

        orig_shape = enhanced_frame.shape[:2]
        input_tensor = np.ascontiguousarray(self.preprocess(enhanced_frame))
        outputs = self._run_inference(input_tensor)
        detections = self.postprocess(outputs, orig_shape)

        detections = self.track_detections(detections)

        return detections

    def _run_inference(self, input_tensor: np.ndarray) -> List[np.ndarray]:
        if not self._use_gpu_iobinding:
            return self.session.run(self.output_names, {self.input_name: input_tensor})

        if self._input_ort is None or tuple(self._input_ort.shape()) != tuple(input_tensor.shape):
            self._input_ort = ort.OrtValue.ortvalue_from_numpy(
                input_tensor, "cuda", self._cuda_device_id
            )
        else:
            self._input_ort.update_inplace(input_tensor)

        self._io_binding.bind_ortvalue_input(self.input_name, self._input_ort)
        self.session.run_with_iobinding(self._io_binding)
        return self._io_binding.copy_outputs_to_cpu()

    def process_video(
        self,
        video_path: str,
        frame_interval: int = 4,
        on_progress: Optional[Callable[[Dict], None]] = None,
    ) -> Dict:
        return self._process_video_impl(video_path, frame_interval, on_progress)

    def _process_video_impl(
        self,
        video_path: str,
        frame_interval: int = 4,
        on_progress: Optional[Callable[[Dict], None]] = None,
    ) -> Dict:
        self.reset_tracker()

        cap = cv2.VideoCapture(video_path, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            raise RuntimeError(f"Не удалось открыть видео: {video_path}")

        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        skip_decode = _env_skip_frame_decode()
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0:
            fps = 25.0

        frame_count = 0
        processed_frames = 0
        last_progress_report = 0.0
        interval = max(1, frame_interval)

        def report_progress(force: bool = False) -> None:
            nonlocal last_progress_report
            if not on_progress:
                return
            now = time.time()
            if not force and processed_frames > 0 and (now - last_progress_report) < 1.5:
                return
            last_progress_report = now
            on_progress(
                build_progress_payload(
                    frame_interval=interval,
                    total_frames=total_frames,
                    processed_frames=processed_frames,
                    elapsed_seconds=now - start_time,
                )
            )

        unique_bushes = set()
        unique_gaps = set()

        bushes_positions = []
        gaps_positions = []

        row_sequence = []
        tracked_objects = {}

        start_time = time.time()
        report_progress(force=True)

        while True:
            if frame_count % interval == 0:
                ret, frame = cap.read()
                if not ret:
                    break
                detections = self.detect_frame(frame, frame_count)

                detections.sort(key=lambda d: (d["bbox"][0] + d["bbox"][2]) / 2)

                for det in detections:
                    x1, y1, x2, y2 = det["bbox"]
                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2

                    if det["class_name"] == "grape_bush":
                        unique_bushes.add(det["track_id"])

                        bushes_positions.append(
                            {
                                "track_id": det["track_id"],
                                "frame": frame_count,
                                "x": center_x,
                                "y": center_y,
                                "confidence": det["confidence"],
                            }
                        )

                        if det["track_id"] not in tracked_objects:
                            tracked_objects[det["track_id"]] = {
                                "order": len(row_sequence) + 1,
                                "type": "bush",
                            }
                            row_sequence.append(
                                {
                                    "track_id": det["track_id"],
                                    "order": len(row_sequence) + 1,
                                    "type": "bush",
                                }
                            )

                    elif det["class_name"] == "gap":
                        unique_gaps.add(det["track_id"])
                        gaps_positions.append(
                            {
                                "track_id": det["track_id"],
                                "frame": frame_count,
                                "x": center_x,
                                "y": center_y,
                                "confidence": det["confidence"],
                            }
                        )

                        if det["track_id"] not in tracked_objects:
                            tracked_objects[det["track_id"]] = {
                                "order": len(row_sequence) + 1,
                                "type": "gap",
                            }
                            row_sequence.append(
                                {
                                    "track_id": det["track_id"],
                                    "order": len(row_sequence) + 1,
                                    "type": "gap",
                                }
                            )

                processed_frames += 1
                report_progress()
            elif skip_decode:
                if not cap.grab():
                    break
            else:
                ret, _ = cap.read()
                if not ret:
                    break

            frame_count += 1
            if total_frames <= 0 and frame_count % 120 == 0:
                total_frames = frame_count

        cap.release()
        processing_time = time.time() - start_time

        if on_progress:
            on_progress(
                build_progress_payload(
                    frame_interval=interval,
                    total_frames=max(total_frames, frame_count),
                    processed_frames=processed_frames,
                    elapsed_seconds=processing_time,
                    status="completed",
                )
            )

        statistics = self.calculate_statistics(
            unique_bushes,
            unique_gaps,
            bushes_positions,
            gaps_positions,
            frame_count,
            fps,
            interval,
            processed_frames,
        )

        raw_bushes = len(unique_bushes)
        raw_gaps = len(unique_gaps)
        raw_total_tracks = raw_bushes + raw_gaps
        spatial_threshold = _spatial_count_threshold()

        track_display_sequence = [
            item["type"] for item in sorted(row_sequence, key=lambda x: x["order"])
        ]
        spatial_display, spatial_details, spatial_bushes, spatial_gaps = build_spatial_row_sequence(
            bushes_positions,
            gaps_positions,
            frame_interval=interval,
            processed_frames=processed_frames,
        )

        stable_tracker = (
            raw_total_tracks <= 90
            and spatial_bushes > 0
            and raw_bushes <= spatial_bushes + 5
            and raw_bushes >= int(spatial_bushes * 0.9)
        )
        use_spatial = raw_total_tracks > spatial_threshold or not stable_tracker

        if use_spatial:
            display_sequence = spatial_display
            sequence_details = spatial_details
            statistics["bushes_count"] = spatial_bushes
            statistics["gaps_count"] = spatial_gaps
            count_source = "spatial"
        else:
            display_sequence = track_display_sequence
            sequence_details = [
                {
                    "position": item["order"],
                    "type": item["type"],
                    "track_id": item["track_id"],
                }
                for item in sorted(row_sequence, key=lambda x: x["order"])
            ]
            statistics["bushes_count"] = raw_bushes
            statistics["gaps_count"] = raw_gaps
            count_source = "tracker"

        raw_track_sequence_len = len(row_sequence)
        if raw_bushes > statistics["bushes_count"] * 2 and raw_bushes > 100:
            _logger.info(
                "Bush count: source=%s spatial=%s raw_track_ids=%s raw_row_sequence=%s positions=%s threshold=%s",
                count_source,
                statistics["bushes_count"],
                raw_bushes,
                raw_track_sequence_len,
                len(bushes_positions),
                spatial_threshold,
            )
        elif raw_bushes > 200:
            _logger.warning(
                "High bush track count: bushes=%s gaps=%s row_sequence=%s positions=%s processed_frames=%s",
                raw_bushes,
                raw_gaps,
                raw_track_sequence_len,
                len(bushes_positions),
                processed_frames,
            )

        duration = (total_frames / fps) if fps > 0 else 0.0
        return {
            "video_info": {
                "total_frames": total_frames,
                "fps": fps,
                "duration": duration,
                "processed_frames": processed_frames,
                "processing_time": processing_time,
            },
            "statistics": statistics,
            "tracking_stats": {
                "unique_bushes": raw_bushes,
                "unique_gaps": raw_gaps,
                "spatial_bushes": statistics["bushes_count"],
                "spatial_gaps": statistics["gaps_count"],
                "count_source": count_source,
                "raw_row_sequence_len": raw_track_sequence_len,
                "spatial_row_sequence_len": len(spatial_display),
                "total_tracks": raw_total_tracks,
            },
            "row_sequence": display_sequence,
            "sequence_details": sequence_details,
            "row_length": len(display_sequence),
        }

    def calculate_statistics(
        self,
        unique_bushes,
        unique_gaps,
        bushes_positions,
        gaps_positions,
        total_frames,
        fps,
        frame_interval=4,
        processed_frames=0,
    ):
        row_spacing = self._calculate_row_spacing(bushes_positions)
        min_bush, min_gap = _min_track_hits()
        _, _, spatial_bushes, spatial_gaps = build_spatial_row_sequence(
            bushes_positions,
            gaps_positions,
            frame_interval=frame_interval,
            processed_frames=processed_frames,
        )

        return {
            "bushes_count": spatial_bushes,
            "gaps_count": spatial_gaps,
            "row_spacing": row_spacing,
            "bushes_positions": bushes_positions,
            "gaps_positions": gaps_positions,
            "details": {
                "processed_frames": len(set(p["frame"] for p in bushes_positions)),
                "total_positions": len(bushes_positions),
                "raw_track_bushes": len(unique_bushes),
                "raw_track_gaps": len(unique_gaps),
                "spatial_bushes": spatial_bushes,
                "spatial_gaps": spatial_gaps,
                "min_bush_hits": min_bush,
                "min_gap_hits": min_gap,
                "enhancement_enabled": self.enhance_frames,
            },
        }

    def _calculate_row_spacing(self, positions):
        if len(positions) < 10:
            return 0.0

        y_positions = sorted(list(set([p["y"] for p in positions])))

        if len(y_positions) < 2:
            return 0.0

        distances = []
        for i in range(1, min(5, len(y_positions))):
            distances.append(abs(y_positions[i] - y_positions[i - 1]))

        if distances:
            return sum(distances) / len(distances)

        return 0.0


class DummyVideoDetector:
    """Без ONNX: проверяет чтение видео, возвращает нулевые метрики (dev / CI)."""

    is_dummy = True
    class_names = {0: "grape_bush", 1: "gap"}
    enhance_frames = False
    input_width = 640
    input_height = 640
    conf_threshold = 0.25
    iou_threshold = 0.45

    def process_video(
        self,
        video_path: str,
        frame_interval: int = 4,
        on_progress: Optional[Callable[[Dict], None]] = None,
    ) -> Dict:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError(f"Не удалось открыть видео: {video_path}")

        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if fps <= 0:
            fps = 25.0
        total_frames_meta = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        interval = max(1, frame_interval)

        start = time.time()
        frame_count = 0
        processed_frames = 0
        last_progress_report = 0.0

        def report_progress(force: bool = False) -> None:
            nonlocal last_progress_report
            if not on_progress:
                return
            now = time.time()
            if not force and processed_frames > 0 and (now - last_progress_report) < 1.5:
                return
            last_progress_report = now
            total = total_frames_meta if total_frames_meta > 0 else frame_count
            on_progress(
                build_progress_payload(
                    frame_interval=interval,
                    total_frames=total,
                    processed_frames=processed_frames,
                    elapsed_seconds=now - start,
                )
            )

        report_progress(force=True)

        while True:
            ret, _ = cap.read()
            if not ret:
                break
            if frame_count % interval == 0:
                processed_frames += 1
                report_progress()
            frame_count += 1
        cap.release()

        elapsed = time.time() - start
        if on_progress:
            on_progress(
                build_progress_payload(
                    frame_interval=interval,
                    total_frames=max(total_frames_meta, frame_count),
                    processed_frames=processed_frames,
                    elapsed_seconds=elapsed,
                    status="completed",
                )
            )

        duration = (
            (total_frames_meta / fps)
            if total_frames_meta > 0 and fps > 0
            else (frame_count / fps if fps > 0 else 0.0)
        )

        statistics: Dict = {
            "bushes_count": 0,
            "gaps_count": 0,
            "row_spacing": 0.0,
            "bushes_positions": [],
            "gaps_positions": [],
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
_detector_pool: Optional["DetectorPool"] = None


def _resolve_model_path(model_path: Optional[str] = None) -> str:
    raw = (model_path or default_onnx_path()).strip()
    return raw if os.path.isabs(raw) else str(_CV_ROOT / raw)


def _build_detector(model_path: Optional[str] = None, enhance_frames: Optional[bool] = None):
    if enhance_frames is None:
        enhance_frames = _env_enhance_frames()

    path = _resolve_model_path(model_path)

    if os.path.isfile(path):
        return ONNXYOLODetector(path, enhance_frames)

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

    return DummyVideoDetector()


class DetectorPool:
    """Отдельный ONNX+трекер на каждое параллельное видео (без гонок track_id)."""

    def __init__(self, size: int):
        self._size = max(1, size)
        self._slots = threading.Semaphore(self._size)
        self._available: queue.Queue = queue.Queue()

    def warmup(self) -> None:
        for _ in range(self._size):
            self._available.put(_build_detector())
        _logger.info("Detector pool ready: size=%s", self._size)

    @contextmanager
    def borrow(self):
        self._slots.acquire()
        detector = None
        created = False
        try:
            try:
                detector = self._available.get_nowait()
            except queue.Empty:
                detector = _build_detector()
                created = True
            yield detector
        finally:
            if detector is not None:
                if hasattr(detector, "reset_tracker"):
                    detector.reset_tracker()
                elif hasattr(detector, "track_history"):
                    detector.track_history.clear()
                    detector.next_track_id = 0
                    if hasattr(detector, "track_classes"):
                        detector.track_classes.clear()
                if not created:
                    self._available.put(detector)
            self._slots.release()


def init_detector_pool(size: Optional[int] = None) -> None:
    global _detector_pool
    pool_size = max(1, min(size or max_concurrent_videos(), 8))
    _detector_pool = DetectorPool(pool_size)
    _detector_pool.warmup()


@contextmanager
def borrow_detector():
    global _detector_pool
    if _detector_pool is None:
        init_detector_pool()
    with _detector_pool.borrow() as detector:
        yield detector


def get_detector(model_path: Optional[str] = None, enhance_frames: Optional[bool] = None):
    global _detector
    if _detector is not None:
        return _detector

    _detector = _build_detector(model_path, enhance_frames)
    return _detector
