"""摄像头 + 人脸识别引擎：在后台线程里持续读取摄像头、识别员工并自动打卡。"""
import os
import platform
import threading
import time
from collections import deque
from datetime import datetime

import cv2
import numpy as np

import db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")
DET_MODEL = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
REC_MODEL = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")
PHOTO_DIR = os.path.join(db.DATA_DIR, "photos")
FACE_DIR = os.path.join(db.DATA_DIR, "faces")

PROC_WIDTH = 640  # 识别时缩小到这个宽度，旧电脑也跑得动
HIT_WINDOW = 3.0  # 秒：在这段时间内连续识别到 N 次才算数，防止误认


class FaceModel:
    """包装 YuNet 检测 + SFace 识别，线程安全。"""

    def __init__(self):
        if not (os.path.exists(DET_MODEL) and os.path.exists(REC_MODEL)):
            raise FileNotFoundError("找不到模型文件，请先运行: python download_models.py")
        self.detector = cv2.FaceDetectorYN.create(DET_MODEL, "", (320, 320), 0.8, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(REC_MODEL, "")
        self.lock = threading.Lock()

    def detect(self, img):
        """返回检测到的人脸数组（每行：x, y, w, h, 5 个关键点, 置信度），坐标对应传入的 img。"""
        h, w = img.shape[:2]
        with self.lock:
            self.detector.setInputSize((w, h))
            _, faces = self.detector.detect(img)
        return faces if faces is not None else np.zeros((0, 15), dtype=np.float32)

    def embed(self, img, face):
        with self.lock:
            aligned = self.recognizer.alignCrop(img, face)
            feat = self.recognizer.feature(aligned).flatten().astype(np.float32)
        return feat / (np.linalg.norm(feat) + 1e-9), aligned

    def largest_face(self, img):
        """用于登记：取画面中最大的一张脸，返回 (特征, 对齐后的人脸图) 或 (None, 错误原因)。"""
        scale = 1.0
        small = img
        if img.shape[1] > PROC_WIDTH:
            scale = PROC_WIDTH / img.shape[1]
            small = cv2.resize(img, None, fx=scale, fy=scale)
        faces = self.detect(small)
        if len(faces) == 0:
            return None, "画面里没有检测到人脸"
        face = max(faces, key=lambda f: f[2] * f[3]).copy()
        face[:14] /= scale  # 坐标换回原图，用原图对齐更清晰
        if face[2] < 60:
            return None, "人脸太小，请靠近一点"
        return self.embed(img, face)


def _open_camera(source):
    if isinstance(source, str) and source.isdigit():
        source = int(source)
    if isinstance(source, int) and platform.system() == "Windows":
        cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)  # Windows 上打开 USB 摄像头更快
    else:
        cap = cv2.VideoCapture(source)
    return cap


class Engine:
    def __init__(self, cfg):
        self.cfg = cfg
        self.model = FaceModel()
        self.running = False
        self.status = "starting"
        self.error = ""
        self.frame = None            # 最新原始画面
        self.jpeg = None             # 最新带框画面（给网页看）
        self.frame_lock = threading.Lock()
        self.current = []            # 当前画面里的人
        self.recent = deque(maxlen=20)
        self.hits = {}               # emp_id -> [时间戳...]
        self.last_punch = {}         # emp_id -> 上次打卡时间（秒）
        self.last_unknown = 0.0
        self.unknown_streak = 0      # 连续多少次处理都是陌生人
        self.reload_gallery()
        os.makedirs(PHOTO_DIR, exist_ok=True)
        os.makedirs(FACE_DIR, exist_ok=True)

    def reload_gallery(self):
        self.ids, self.names, self.feats = db.load_gallery()

    # ---------- 线程 ----------

    def start(self):
        self.running = True
        threading.Thread(target=self._loop, daemon=True, name="camera").start()

    def stop(self):
        self.running = False

    def _loop(self):
        source = self.cfg.get("camera_source", 0)
        every = max(1, int(self.cfg.get("process_every_n_frames", 3)))
        while self.running:
            cap = _open_camera(source)
            if isinstance(source, int) or (isinstance(source, str) and source.isdigit()):
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.cfg.get("camera_width", 1280))
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.cfg.get("camera_height", 720))
            if not cap.isOpened():
                self.status, self.error = "error", f"打不开摄像头 {source}，5 秒后重试"
                time.sleep(5)
                continue
            self.status, self.error = "running", ""
            n = 0
            boxes = []
            last_jpeg = 0.0
            while self.running:
                ok, frame = cap.read()
                if not ok:
                    if isinstance(source, str) and not source.isdigit() and os.path.exists(source):
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # 测试用视频文件：循环播放
                        continue
                    self.status, self.error = "error", "摄像头断开，正在重连…"
                    break
                with self.frame_lock:
                    self.frame = frame
                n += 1
                if n % every == 0:
                    try:
                        boxes = self._process(frame)
                    except Exception as e:  # 单帧出错不影响整体运行
                        self.error = f"识别出错: {e}"
                now = time.time()
                if now - last_jpeg > 0.08:  # 网页画面约 12fps，节省 CPU
                    self.jpeg = self._annotate(frame, boxes)
                    last_jpeg = now
                if isinstance(source, str) and os.path.exists(source):
                    time.sleep(0.03)  # 视频文件按正常速度播放
            cap.release()
            time.sleep(1)

    # ---------- 识别 ----------

    def _process(self, frame):
        scale = min(1.0, PROC_WIDTH / frame.shape[1])
        small = cv2.resize(frame, None, fx=scale, fy=scale) if scale < 1 else frame
        faces = self.model.detect(small)
        min_size = self.cfg.get("min_face_size", 60) * scale
        threshold = self.cfg.get("match_threshold", 0.42)
        now = time.time()
        boxes, current = [], []
        saw_unknown = saw_known = False

        for face in faces:
            if face[2] < min_size:
                continue
            feat, _ = self.model.embed(small, face)
            emp_id, name, score = None, None, 0.0
            if len(self.ids):
                sims = self.feats @ feat
                i = int(np.argmax(sims))
                score = float(sims[i])
                if score >= threshold:
                    emp_id, name = int(self.ids[i]), self.names[i]
            box = (face[:4] / scale).astype(int)

            if emp_id is None:
                boxes.append((box, (0, 0, 255)))
                current.append({"name": "陌生人", "state": "unknown", "score": round(score, 2)})
                if not saw_unknown:
                    saw_unknown = True
                    unknown_box, unknown_score = box, score
                continue
            saw_known = True

            hits = [t for t in self.hits.get(emp_id, []) if now - t < HIT_WINDOW] + [now]
            self.hits[emp_id] = hits
            state = "checking"
            if len(hits) >= self.cfg.get("confirm_hits", 3):
                state = self._punch(emp_id, name, score, frame, box, now)
            boxes.append((box, (0, 200, 0) if state != "checking" else (0, 200, 255)))
            current.append({"name": name, "state": state, "score": round(score, 2), "employee_id": emp_id})

        # 连续多次都认不出来才算陌生人，避免员工侧脸/走动时一两帧没认出被误拍
        self.unknown_streak = self.unknown_streak + 1 if saw_unknown and not saw_known else 0
        if self.unknown_streak >= self.cfg.get("confirm_hits", 3) * 2:
            self._maybe_save_unknown(frame, unknown_box, unknown_score, now)
        self.current = current
        return boxes

    def _punch(self, emp_id, name, score, frame, box, now):
        cooldown = self.cfg.get("cooldown_minutes", 3) * 60
        last = self.last_punch.get(emp_id)
        if last is None:
            ev = db.last_event(emp_id)
            last = datetime.strptime(ev["ts"], "%Y-%m-%d %H:%M:%S").timestamp() if ev else 0
            self.last_punch[emp_id] = last
        if now - last < cooldown:
            return "already"
        photo = self._save_snapshot(frame, box, PHOTO_DIR)
        _, event_type = db.record_event(emp_id, round(score, 3), photo)
        self.last_punch[emp_id] = now
        self.hits[emp_id] = []
        self.recent.appendleft({
            "name": name, "employee_id": emp_id, "type": event_type,
            "time": datetime.now().strftime("%H:%M:%S"), "photo": photo,
        })
        return "recorded"

    def _maybe_save_unknown(self, frame, box, score, now):
        if not self.cfg.get("save_unknown_faces", True):
            return
        if now - self.last_unknown < self.cfg.get("unknown_cooldown_seconds", 30):
            return
        self.last_unknown = now
        photo = self._save_snapshot(frame, box, PHOTO_DIR)
        db.record_event(None, round(score, 3), photo, event_type="UNKNOWN")

    @staticmethod
    def _save_snapshot(frame, box, folder):
        """保存带人脸框的抓拍照，返回相对 data 目录的路径。"""
        day = datetime.now().strftime("%Y-%m-%d")
        sub = os.path.join(folder, day)
        os.makedirs(sub, exist_ok=True)
        x, y, w, h = box
        pad = int(max(w, h) * 0.6)
        H, W = frame.shape[:2]
        crop = frame[max(0, y - pad):min(H, y + h + pad), max(0, x - pad):min(W, x + w + pad)]
        if crop.size == 0:
            crop = frame
        if crop.shape[1] > 400:
            crop = cv2.resize(crop, None, fx=400 / crop.shape[1], fy=400 / crop.shape[1])
        fname = datetime.now().strftime("%H%M%S_%f") + ".jpg"
        cv2.imwrite(os.path.join(sub, fname), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return os.path.relpath(os.path.join(sub, fname), db.DATA_DIR).replace("\\", "/")

    @staticmethod
    def _annotate(frame, boxes):
        img = frame
        if img.shape[1] > 960:
            s = 960 / img.shape[1]
            img = cv2.resize(img, None, fx=s, fy=s)
            boxes = [((b * s).astype(int), c) for b, c in boxes]
        else:
            img = img.copy()
        for (x, y, w, h), color in boxes:
            cv2.rectangle(img, (x, y), (x + w, y + h), color, 3)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return buf.tobytes() if ok else None

    # ---------- 登记 ----------

    def snapshot(self):
        with self.frame_lock:
            return None if self.frame is None else self.frame.copy()

    def enroll_image(self, emp_id, img):
        """从一张图片（摄像头抓拍或上传）登记人脸。返回 (成功?, 信息)。"""
        feat, aligned = self.model.largest_face(img)
        if feat is None:
            return False, aligned
        # 检查这张脸是否已经属于别人，防止登记错人
        if len(self.ids):
            sims = self.feats @ feat
            i = int(np.argmax(sims))
            if sims[i] >= self.cfg.get("match_threshold", 0.42) and int(self.ids[i]) != emp_id:
                return False, f"这张脸和「{self.names[i]}」很像（相似度 {sims[i]:.2f}），请确认没有选错员工"
        fname = f"{emp_id}_{int(time.time() * 1000)}.jpg"
        cv2.imwrite(os.path.join(FACE_DIR, fname), aligned)
        db.add_face(emp_id, feat, f"faces/{fname}")
        self.reload_gallery()
        return True, "登记成功"
