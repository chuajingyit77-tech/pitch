"""下载人脸检测 (YuNet) 和人脸识别 (SFace) 模型，只需运行一次。"""
import os
import sys
import urllib.request

BASE = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
MODELS = {
    "face_detection_yunet_2023mar.onnx": BASE + "face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx": BASE + "face_recognition_sface/face_recognition_sface_2021dec.onnx",
}
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)
    for name, url in MODELS.items():
        path = os.path.join(MODEL_DIR, name)
        # 小于 100KB 说明是下载失败的占位文件
        if os.path.exists(path) and os.path.getsize(path) > 100_000:
            print(f"[已存在] {name}")
            continue
        print(f"[下载中] {name} ...")
        try:
            urllib.request.urlretrieve(url, path)
        except Exception as e:
            print(f"下载失败: {e}\n请手动下载 {url}\n并放到 {MODEL_DIR}")
            sys.exit(1)
        print(f"[完成] {name} ({os.path.getsize(path) // 1024} KB)")
    print("模型准备好了。")


if __name__ == "__main__":
    main()
