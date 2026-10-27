"""人脸考勤系统 —— 启动: python app.py，然后浏览器打开 http://localhost:8000"""
import csv
import io
import json
import os
import socket
import sys
import threading
import time
from datetime import date, datetime, timedelta
from functools import wraps

import cv2
import numpy as np
from flask import (Flask, Response, abort, flash, jsonify, redirect, render_template, request,
                   send_from_directory, session, url_for)

import db
import sync
from engine import Engine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(BASE_DIR, "config.json"), encoding="utf-8") as f:
    CFG = json.load(f)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

db.init()


def load_secret_key():
    """登录用的密钥：第一次启动时随机生成并保存在 data 文件夹。"""
    path = os.path.join(db.DATA_DIR, "secret.key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(os.urandom(24).hex())
    with open(path) as f:
        return f.read().strip()


app.secret_key = load_secret_key()
engine = Engine(CFG)
sync_state = sync.start(CFG)


@app.context_processor
def inject():
    return {"company": CFG.get("company_name", ""), "logged_in": session.get("admin", False)}


def is_local():
    return request.remote_addr in ("127.0.0.1", "::1")


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if not session.get("admin"):
            return redirect(url_for("login", next=request.path))
        return f(*a, **kw)
    return wrapper


def local_or_login(f):
    """柜台电脑本机可以直接看签到屏；其他电脑/手机需要登录。"""
    @wraps(f)
    def wrapper(*a, **kw):
        if not (is_local() or session.get("admin")):
            return redirect(url_for("login", next=request.path))
        return f(*a, **kw)
    return wrapper


def parse_range():
    today = date.today().isoformat()
    d_from = request.args.get("from") or today
    d_to = request.args.get("to") or d_from
    return d_from, d_to


# ---------------- 签到屏（柜台显示） ----------------

@app.route("/")
def index():
    return redirect(url_for("kiosk"))


@app.route("/kiosk")
@local_or_login
def kiosk():
    return render_template("kiosk.html")


@app.route("/video.mjpg")
@local_or_login
def video():
    def gen():
        while True:
            frame = engine.jpeg
            if frame:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            time.sleep(0.08)
    return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")


@app.route("/api/status")
@local_or_login
def api_status():
    return jsonify({
        "status": engine.status,
        "error": engine.error,
        "current": engine.current,
        "recent": list(engine.recent),
        "time": datetime.now().strftime("%H:%M:%S"),
        "date": datetime.now().strftime("%Y年%m月%d日"),
    })


# ---------------- 登录 ----------------

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if request.form.get("password") == CFG.get("admin_password"):
            session["admin"] = True
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") else url_for("dashboard"))
        flash("密码错误")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------------- 管理后台 ----------------

@app.route("/admin")
@login_required
def dashboard():
    today = date.today().isoformat()
    report = {r["employee_id"]: r for r in db.daily_report(
        today, today, CFG["work_start"], CFG["work_end"], CFG.get("late_grace_minutes", 0))}
    last = {}
    for ev in reversed(db.list_events(today, today)):
        last[ev["employee_id"]] = ev
    people = []
    for emp in db.list_employees():
        r = report.get(emp["id"])
        ev = last.get(emp["id"])
        if not ev:
            state = "absent"
        elif ev["event_type"] == "IN":
            state = "in"
        else:
            state = "out"
        people.append({**emp, "state": state, "report": r})
    counts = {k: sum(1 for p in people if p["state"] == k) for k in ("in", "out", "absent")}
    counts["late"] = sum(1 for p in people if p["report"] and p["report"]["late"])
    unknown = db.list_events(today, today, include_unknown=True, limit=200)
    unknown = [e for e in unknown if e["event_type"] == "UNKNOWN"][:12]
    return render_template("dashboard.html", people=people, counts=counts, unknown=unknown,
                           sync=sync_state, webhook=bool(CFG.get("webhook_url")),
                           engine_status=engine.status, engine_error=engine.error)


@app.route("/admin/employees", methods=["GET", "POST"])
@login_required
def employees():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        if not name:
            flash("请填写姓名")
        else:
            emp_id = db.add_employee(name, request.form.get("emp_no", "").strip(),
                                     request.form.get("department", "").strip())
            flash(f"已添加 {name}，现在请给 TA 登记人脸")
            return redirect(url_for("employee", emp_id=emp_id))
    return render_template("employees.html", employees=db.list_employees(include_inactive=True))


@app.route("/admin/employees/<int:emp_id>", methods=["GET", "POST"])
@login_required
def employee(emp_id):
    emp = db.get_employee(emp_id)
    if not emp:
        abort(404)
    if request.method == "POST":
        action = request.form.get("action")
        if action == "save":
            db.update_employee(emp_id, request.form.get("name", emp["name"]).strip(),
                               request.form.get("emp_no", "").strip(),
                               request.form.get("department", "").strip(),
                               request.form.get("active") == "1")
            engine.reload_gallery()
            flash("已保存")
        elif action == "capture":
            img = engine.snapshot()
            if img is None:
                flash("摄像头还没有画面")
            else:
                ok, msg = engine.enroll_image(emp_id, img)
                flash(msg)
        elif action == "upload":
            n_ok = 0
            for f in request.files.getlist("photos"):
                data = np.frombuffer(f.read(), dtype=np.uint8)
                img = cv2.imdecode(data, cv2.IMREAD_COLOR)
                if img is None:
                    flash(f"{f.filename}: 不是有效的图片")
                    continue
                ok, msg = engine.enroll_image(emp_id, img)
                n_ok += ok
                if not ok:
                    flash(f"{f.filename}: {msg}")
            if n_ok:
                flash(f"成功登记 {n_ok} 张照片")
        elif action == "delete_face":
            db.delete_face(int(request.form["face_id"]))
            engine.reload_gallery()
            flash("已删除这张人脸")
        elif action == "delete":
            db.delete_employee(emp_id)
            engine.reload_gallery()
            flash(f"已删除员工 {emp['name']}（打卡历史保留）")
            return redirect(url_for("employees"))
        return redirect(url_for("employee", emp_id=emp_id))
    return render_template("employee.html", emp=emp, faces=db.list_faces(emp_id))


@app.route("/admin/records", methods=["GET", "POST"])
@login_required
def records():
    if request.method == "POST":
        action = request.form.get("action")
        if action == "delete":
            db.delete_event(int(request.form["event_id"]))
            flash("已删除这条记录")
        elif action == "add":
            ts = request.form["day"] + " " + request.form["time"] + ":00"
            db.record_event(int(request.form["employee_id"]), None, None, ts=ts,
                            event_type=request.form["event_type"],
                            note="手动补卡：" + request.form.get("note", ""))
            flash("已补卡")
        return redirect(request.full_path)
    d_from, d_to = parse_range()
    emp_id = request.args.get("emp", type=int)
    show_unknown = request.args.get("unknown") == "1"
    events = db.list_events(d_from, d_to, emp_id, include_unknown=show_unknown, limit=2000)
    return render_template("records.html", events=events, d_from=d_from, d_to=d_to, emp_id=emp_id,
                           show_unknown=show_unknown, employees=db.list_employees(include_inactive=True))


@app.route("/admin/report")
@login_required
def report():
    d_from, d_to = parse_range()
    if "from" not in request.args:  # 默认看本月
        d_from = date.today().replace(day=1).isoformat()
        d_to = date.today().isoformat()
    rows = db.daily_report(d_from, d_to, CFG["work_start"], CFG["work_end"], CFG.get("late_grace_minutes", 0))

    if request.args.get("format") == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["日期", "工号", "姓名", "部门", "上班", "下班", "工时(小时)", "打卡次数", "迟到", "早退", "漏打下班卡"])
        for r in rows:
            w.writerow([r["day"], r["emp_no"], r["name"], r["department"], r["first_in"], r["last_out"],
                        r["hours"], r["punches"], "是" if r["late"] else "", "是" if r["early_leave"] else "",
                        "是" if r["missing_out"] else ""])
        # 加 BOM，Excel 打开中文不会乱码
        return Response("﻿" + buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename=attendance_{d_from}_{d_to}.csv"})

    summary = {}
    for r in rows:
        s = summary.setdefault(r["employee_id"], {"name": r["name"], "department": r["department"],
                                                  "days": 0, "hours": 0.0, "late": 0, "early": 0, "missing": 0})
        s["days"] += 1
        s["hours"] += r["hours"]
        s["late"] += r["late"]
        s["early"] += r["early_leave"]
        s["missing"] += r["missing_out"]
    summary = sorted(summary.values(), key=lambda s: (s["department"], s["name"]))
    return render_template("report.html", rows=rows, summary=summary, d_from=d_from, d_to=d_to, cfg=CFG)


@app.route("/data/<path:path>")
@local_or_login
def data_file(path):
    return send_from_directory(db.DATA_DIR, path)


def open_kiosk(url):
    """优先用 Edge/Chrome 的全屏 kiosk 模式打开签到屏，找不到就用默认浏览器。"""
    import subprocess
    import webbrowser
    candidates = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    time.sleep(3)
    for exe in candidates:
        if os.path.exists(exe):
            subprocess.Popen([exe, "--kiosk", url, "--edge-kiosk-type=fullscreen",
                              "--autoplay-policy=no-user-gesture-required"])
            return
    webbrowser.open(url)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "本机IP"


if __name__ == "__main__":
    engine.start()
    port = CFG.get("port", 8000)
    if "--open-kiosk" in sys.argv:
        threading.Thread(target=open_kiosk, args=(f"http://localhost:{port}/kiosk",), daemon=True).start()
    print("=" * 56)
    print(f"  人脸考勤系统已启动")
    print(f"  柜台签到屏:   http://localhost:{port}/kiosk")
    print(f"  管理后台:     http://{lan_ip()}:{port}/admin  （同一 WiFi 的手机/电脑可打开）")
    print("  关闭这个黑色窗口 = 停止考勤")
    print("=" * 56)
    try:
        from waitress import serve
        serve(app, host=CFG.get("host", "0.0.0.0"), port=port, threads=8)
    except ImportError:
        app.run(host=CFG.get("host", "0.0.0.0"), port=port, threaded=True)
