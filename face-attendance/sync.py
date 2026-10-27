"""把打卡记录推送到云端（Webhook），断网时会自动排队，恢复后补发。"""
import json
import threading
import time
import urllib.request

import db


def _post(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return 200 <= resp.status < 300


def _loop(cfg, state):
    while True:
        url = cfg.get("webhook_url", "").strip()
        if url:
            try:
                for ev in db.unsynced_events():
                    payload = {
                        "id": ev["id"],
                        "company": cfg.get("company_name", ""),
                        "employee_id": ev["employee_id"],
                        "emp_no": ev["emp_no"],
                        "name": ev["name"],
                        "department": ev["department"],
                        "type": ev["event_type"],
                        "time": ev["ts"],
                        "day": ev["day"],
                        "score": ev["score"],
                        "note": ev["note"],
                    }
                    if _post(url, payload):
                        db.mark_synced(ev["id"])
                state["last_ok"] = time.strftime("%Y-%m-%d %H:%M:%S")
                state["error"] = ""
            except Exception as e:
                state["error"] = str(e)
        time.sleep(10)


def start(cfg):
    state = {"last_ok": "", "error": ""}
    threading.Thread(target=_loop, args=(cfg, state), daemon=True, name="sync").start()
    return state
