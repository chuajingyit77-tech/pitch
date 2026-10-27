"""SQLite 数据层：员工、人脸特征、打卡记录。"""
import os
import sqlite3
import threading
from datetime import datetime, timedelta

import numpy as np

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.path.join(DATA_DIR, "attendance.db")

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    emp_no TEXT,
    name TEXT NOT NULL,
    department TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    photo TEXT,
    created_at TEXT,
    FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER,
    event_type TEXT NOT NULL,          -- IN / OUT / UNKNOWN
    ts TEXT NOT NULL,                  -- YYYY-MM-DD HH:MM:SS（本地时间）
    day TEXT NOT NULL,                 -- YYYY-MM-DD
    score REAL,
    photo TEXT,
    note TEXT DEFAULT '',
    synced INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
CREATE INDEX IF NOT EXISTS idx_events_emp ON events(employee_id, ts);
"""


def connect():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init():
    os.makedirs(DATA_DIR, exist_ok=True)
    with _lock, connect() as c:
        c.executescript(SCHEMA)


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------- 员工 ----------

def list_employees(include_inactive=False):
    sql = """SELECT e.*, (SELECT COUNT(*) FROM faces f WHERE f.employee_id = e.id) AS face_count,
                    (SELECT photo FROM faces f WHERE f.employee_id = e.id ORDER BY id LIMIT 1) AS photo
             FROM employees e"""
    if not include_inactive:
        sql += " WHERE e.active = 1"
    sql += " ORDER BY e.department, e.name"
    with connect() as c:
        return [dict(r) for r in c.execute(sql)]


def get_employee(emp_id):
    with connect() as c:
        r = c.execute("SELECT * FROM employees WHERE id = ?", (emp_id,)).fetchone()
        return dict(r) if r else None


def add_employee(name, emp_no="", department=""):
    with _lock, connect() as c:
        cur = c.execute(
            "INSERT INTO employees(name, emp_no, department, created_at) VALUES (?,?,?,?)",
            (name, emp_no, department, now()),
        )
        return cur.lastrowid


def update_employee(emp_id, name, emp_no, department, active):
    with _lock, connect() as c:
        c.execute(
            "UPDATE employees SET name=?, emp_no=?, department=?, active=? WHERE id=?",
            (name, emp_no, department, 1 if active else 0, emp_id),
        )


def delete_employee(emp_id):
    with _lock, connect() as c:
        c.execute("DELETE FROM faces WHERE employee_id = ?", (emp_id,))
        c.execute("DELETE FROM employees WHERE id = ?", (emp_id,))


# ---------- 人脸 ----------

def add_face(emp_id, embedding, photo):
    blob = np.asarray(embedding, dtype=np.float32).tobytes()
    with _lock, connect() as c:
        c.execute(
            "INSERT INTO faces(employee_id, embedding, photo, created_at) VALUES (?,?,?,?)",
            (emp_id, blob, photo, now()),
        )


def list_faces(emp_id):
    with connect() as c:
        return [dict(r) for r in c.execute(
            "SELECT id, photo, created_at FROM faces WHERE employee_id = ? ORDER BY id", (emp_id,))]


def delete_face(face_id):
    with _lock, connect() as c:
        c.execute("DELETE FROM faces WHERE id = ?", (face_id,))


def load_gallery():
    """返回 (员工id数组, 姓名列表, 已归一化特征矩阵)，只包含在职员工。"""
    with connect() as c:
        rows = c.execute(
            """SELECT f.employee_id, e.name, f.embedding FROM faces f
               JOIN employees e ON e.id = f.employee_id WHERE e.active = 1"""
        ).fetchall()
    if not rows:
        return np.zeros(0, dtype=np.int64), [], np.zeros((0, 128), dtype=np.float32)
    ids = np.array([r["employee_id"] for r in rows], dtype=np.int64)
    names = [r["name"] for r in rows]
    feats = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
    feats = feats / np.linalg.norm(feats, axis=1, keepdims=True)
    return ids, names, feats


# ---------- 打卡记录 ----------

def last_event(emp_id):
    with connect() as c:
        r = c.execute(
            "SELECT * FROM events WHERE employee_id = ? ORDER BY ts DESC, id DESC LIMIT 1", (emp_id,)
        ).fetchone()
        return dict(r) if r else None


def record_event(emp_id, score, photo, ts=None, event_type=None, note=""):
    """记录一次打卡。没指定类型时：当天第 1、3、5… 次为 IN，第 2、4、6… 次为 OUT。"""
    ts = ts or now()
    day = ts[:10]
    with _lock, connect() as c:
        if event_type is None:
            n = c.execute(
                "SELECT COUNT(*) FROM events WHERE employee_id = ? AND day = ? AND event_type IN ('IN','OUT')",
                (emp_id, day),
            ).fetchone()[0]
            event_type = "IN" if n % 2 == 0 else "OUT"
        cur = c.execute(
            "INSERT INTO events(employee_id, event_type, ts, day, score, photo, note) VALUES (?,?,?,?,?,?,?)",
            (emp_id, event_type, ts, day, score, photo, note),
        )
        return cur.lastrowid, event_type


def delete_event(event_id):
    with _lock, connect() as c:
        c.execute("DELETE FROM events WHERE id = ?", (event_id,))


def list_events(day_from, day_to, emp_id=None, include_unknown=False, limit=None):
    sql = """SELECT ev.*, e.name, e.emp_no, e.department FROM events ev
             LEFT JOIN employees e ON e.id = ev.employee_id
             WHERE ev.day BETWEEN ? AND ?"""
    args = [day_from, day_to]
    if emp_id:
        sql += " AND ev.employee_id = ?"
        args.append(emp_id)
    if not include_unknown:
        sql += " AND ev.event_type != 'UNKNOWN'"
    sql += " ORDER BY ev.ts DESC, ev.id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args)]


def unsynced_events(limit=50):
    with connect() as c:
        return [dict(r) for r in c.execute(
            """SELECT ev.*, e.name, e.emp_no, e.department FROM events ev
               LEFT JOIN employees e ON e.id = ev.employee_id
               WHERE ev.synced = 0 AND ev.event_type != 'UNKNOWN' ORDER BY ev.id LIMIT ?""", (limit,))]


def mark_synced(event_id):
    with _lock, connect() as c:
        c.execute("UPDATE events SET synced = 1 WHERE id = ?", (event_id,))


# ---------- 报表 ----------

def _parse(ts):
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")


def daily_report(day_from, day_to, work_start="09:00", work_end="18:00", grace=5):
    """按员工、按天汇总：首次进入、最后离开、工作时长、迟到、早退、漏打卡。"""
    events = list_events(day_from, day_to)
    events.sort(key=lambda e: (e["ts"], e["id"]))
    grouped = {}
    for ev in events:
        if ev["employee_id"] is None:
            continue
        grouped.setdefault((ev["employee_id"], ev["day"]), []).append(ev)

    rows = []
    for (emp_id, day), evs in grouped.items():
        worked = timedelta()
        open_in = None
        for ev in evs:
            if ev["event_type"] == "IN":
                open_in = _parse(ev["ts"])
            elif ev["event_type"] == "OUT" and open_in is not None:
                worked += _parse(ev["ts"]) - open_in
                open_in = None
        first_in = next((e["ts"][11:16] for e in evs if e["event_type"] == "IN"), "")
        outs = [e["ts"][11:16] for e in evs if e["event_type"] == "OUT"]
        last_out = outs[-1] if outs else ""
        start_limit = (datetime.strptime(work_start, "%H:%M") + timedelta(minutes=grace)).strftime("%H:%M")
        rows.append({
            "employee_id": emp_id,
            "name": evs[0]["name"] or f"#{emp_id}",
            "emp_no": evs[0]["emp_no"] or "",
            "department": evs[0]["department"] or "",
            "day": day,
            "first_in": first_in,
            "last_out": last_out,
            "hours": round(worked.total_seconds() / 3600, 2),
            "punches": len(evs),
            "late": bool(first_in) and first_in > start_limit,
            "early_leave": bool(last_out) and open_in is None and last_out < work_end,
            "missing_out": open_in is not None,
        })
    rows.sort(key=lambda r: (r["day"], r["department"], r["name"]), reverse=False)
    return rows
