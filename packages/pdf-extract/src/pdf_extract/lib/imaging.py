"""OpenCV image-processing helpers: deskew, denoise, upscale, contrast."""
from __future__ import annotations

from typing import Any

import cv2
import numpy as np
import structlog

log = structlog.get_logger(__name__)


def detect_skew_angle(gray: np.ndarray[Any, Any]) -> float:
    """Detect document skew angle in degrees using Hough line transform.

    Returns a small angle (typically -10..+10). Returns 0.0 if no reliable
    angle can be determined.
    """
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100, minLineLength=100, maxLineGap=10)
    if lines is None:
        log.debug("skew_detect.no_lines")
        return 0.0

    angles: list[float] = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        # Only consider near-horizontal lines (within 15 degrees)
        if abs(angle) < 15:
            angles.append(angle)

    if not angles:
        log.debug("skew_detect.no_horizontal_lines")
        return 0.0

    median_angle = float(np.median(angles))
    log.debug("skew_detect.result", angle=median_angle, num_lines=len(angles))
    return median_angle


def deskew(gray: np.ndarray[Any, Any], angle: float) -> np.ndarray[Any, Any]:
    """Rotate image to correct skew by the given angle (degrees)."""
    h, w = gray.shape[:2]
    center = (w / 2, h / 2)
    rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated: np.ndarray[Any, Any] = cv2.warpAffine(
        gray, rotation_matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated


def denoise(gray: np.ndarray[Any, Any], h: int = 10) -> np.ndarray[Any, Any]:
    """Apply non-local means denoising."""
    result: np.ndarray[Any, Any] = cv2.fastNlMeansDenoising(gray, None, h, 7, 21)
    return result


def upscale_fsrcnn(gray: np.ndarray[Any, Any], scale: int = 3) -> np.ndarray[Any, Any]:
    """Upscale using FSRCNN via cv2.dnn_superres, falling back to bicubic.

    FSRCNN is lightweight (~100KB model) and avoids hallucination artifacts
    that plague GAN-based super-resolution on document text.
    """
    try:
        sr = cv2.dnn_superres.DnnSuperResImpl.create()  # type: ignore[attr-defined]
        model_path = f"FSRCNN_x{scale}.pb"
        sr.readModel(model_path)
        sr.setModel("fsrcnn", scale)
        result: np.ndarray[Any, Any] = sr.upsample(gray)
        log.debug("upscale.fsrcnn.ok", scale=scale)
        return result
    except Exception:
        log.warning("upscale.fsrcnn.fallback_to_bicubic", scale=scale)
        h, w = gray.shape[:2]
        result = cv2.resize(gray, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
        return result


def check_contrast(gray: np.ndarray[Any, Any]) -> float:
    """Return the standard deviation of pixel intensities as a contrast measure."""
    return float(np.std(gray))


def estimate_dpi(page_pixmap_width: int, page_rect_width: float) -> float:
    """Estimate effective DPI from a rendered pixmap width and the page rect width (in points).

    PDF points are 1/72 inch, so: dpi = pixmap_width / (rect_width / 72).
    """
    if page_rect_width <= 0:
        return 0.0
    return page_pixmap_width / (page_rect_width / 72.0)
