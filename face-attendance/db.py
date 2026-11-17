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
    event_type TEXT NOT NULL,          -- IN / OUT（员工）、VISITOR（访客/陌生人）
    ts TEXT NOT NULL,                  -- YYYY-MM-DD HH:MM:SS（本地时间）
    day TEXT NOT NULL,                 -- YYYY-MM-DD
    score REAL,
    photo TEXT,
    note TEXT DEFAULT '',
    synced INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',              -- 管理员可以给常客起名字，例如“快递小哥”
    note TEXT DEFAULT '',
    photo TEXT,
    first_seen TEXT,
    last_seen TEXT,
    visit_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS visitor_faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER NOT NULL,
    embedding BLOB NOT NULL
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
        # 旧版本数据库升级：给 events 加 visitor_id，旧的 UNKNOWN 记录归为访客
        cols = [r["name"] for r in c.execute("PRAGMA table_info(events)")]
        if "visitor_id" not in cols:
            c.execute("ALTER TABLE events ADD COLUMN visitor_id INTEGER")
            c.execute("UPDATE events SET event_type = 'VISITOR' WHERE event_type = 'UNKNOWN'")


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


def record_event(emp_id, score, photo, ts=None, event_type=None, note="", visitor_id=None):
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
            "INSERT INTO events(employee_id, event_type, ts, day, score, photo, note, visitor_id)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (emp_id, event_type, ts, day, score, photo, note, visitor_id),
        )
        if visitor_id is not None:
            c.execute("UPDATE visitors SET last_seen = ?, visit_count = visit_count + 1 WHERE id = ?",
                      (ts, visitor_id))
        return cur.lastrowid, event_type


def delete_event(event_id):
    with _lock, connect() as c:
        c.execute("DELETE FROM events WHERE id = ?", (event_id,))


EVENT_SELECT = """SELECT ev.*, e.emp_no, e.department,
       CASE WHEN ev.event_type = 'VISITOR'
            THEN COALESCE(NULLIF(v.name, ''), '访客 #' || COALESCE(ev.visitor_id, '?'))
            ELSE e.name END AS name
FROM events ev
LEFT JOIN employees e ON e.id = ev.employee_id
LEFT JOIN visitors v ON v.id = ev.visitor_id"""


def list_events(day_from, day_to, emp_id=None, include_visitors=False, limit=None, visitor_id=None):
    sql = EVENT_SELECT + " WHERE ev.day BETWEEN ? AND ?"
    args = [day_from, day_to]
    if emp_id:
        sql += " AND ev.employee_id = ?"
        args.append(emp_id)
    if visitor_id:
        sql += " AND ev.visitor_id = ?"
        args.append(visitor_id)
    elif not include_visitors:
        sql += " AND ev.event_type != 'VISITOR'"
    sql += " ORDER BY ev.ts DESC, ev.id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    with connect() as c:
        return [dict(r) for r in c.execute(sql, args)]


def unsynced_events(limit=50):
    with connect() as c:
        return [dict(r) for r in c.execute(
            EVENT_SELECT + " WHERE ev.synced = 0 ORDER BY ev.id LIMIT ?", (limit,))]


def mark_synced(event_id):
    with _lock, connect() as c:
        c.execute("UPDATE events SET synced = 1 WHERE id = ?", (event_id,))


# ---------- 访客（不是员工的人） ----------

def load_visitor_gallery():
    """返回 (访客id数组, 已归一化特征矩阵)。"""
    with connect() as c:
        rows = c.execute("SELECT visitor_id, embedding FROM visitor_faces").fetchall()
    if not rows:
        return np.zeros(0, dtype=np.int64), np.zeros((0, 128), dtype=np.float32)
    ids = np.array([r["visitor_id"] for r in rows], dtype=np.int64)
    feats = np.stack([np.frombuffer(r["embedding"], dtype=np.float32) for r in rows])
    return ids, feats / np.linalg.norm(feats, axis=1, keepdims=True)


def add_visitor(embedding, photo):
    ts = now()
    with _lock, connect() as c:
        cur = c.execute("INSERT INTO visitors(photo, first_seen, last_seen) VALUES (?,?,?)", (photo, ts, ts))
        c.execute("INSERT INTO visitor_faces(visitor_id, embedding) VALUES (?,?)",
                  (cur.lastrowid, np.asarray(embedding, dtype=np.float32).tobytes()))
        return cur.lastrowid


def add_visitor_face(visitor_id, embedding):
    with _lock, connect() as c:
        c.execute("INSERT INTO visitor_faces(visitor_id, embedding) VALUES (?,?)",
                  (visitor_id, np.asarray(embedding, dtype=np.float32).tobytes()))


def visitor_embeddings(visitor_id):
    with connect() as c:
        return [np.frombuffer(r["embedding"], dtype=np.float32) for r in c.execute(
            "SELECT embedding FROM visitor_faces WHERE visitor_id = ?", (visitor_id,))]


def get_visitor(visitor_id):
    with connect() as c:
        r = c.execute("SELECT * FROM visitors WHERE id = ?", (visitor_id,)).fetchone()
        return dict(r) if r else None


def list_visitors(day=None, limit=300):
    """day 给了就只列那天出现过的访客，并带上当天的次数和首末时间。"""
    with connect() as c:
        if day:
            sql = """SELECT v.*, COUNT(ev.id) AS day_count, MIN(ev.ts) AS day_first, MAX(ev.ts) AS day_last
                     FROM visitors v JOIN events ev ON ev.visitor_id = v.id AND ev.day = ?
                     GROUP BY v.id ORDER BY day_last DESC LIMIT ?"""
            return [dict(r) for r in c.execute(sql, (day, limit))]
        return [dict(r) for r in c.execute("SELECT * FROM visitors ORDER BY last_seen DESC LIMIT ?", (limit,))]


def update_visitor(visitor_id, name, note):
    with _lock, connect() as c:
        c.execute("UPDATE visitors SET name = ?, note = ? WHERE id = ?", (name, note, visitor_id))


def delete_visitor(visitor_id):
    """删除访客和 TA 的全部记录，返回需要删除的照片路径。"""
    with _lock, connect() as c:
        photos = [r["photo"] for r in c.execute("SELECT photo FROM events WHERE visitor_id = ?", (visitor_id,))]
        photos += [r["photo"] for r in c.execute("SELECT photo FROM visitors WHERE id = ?", (visitor_id,))]
        c.execute("DELETE FROM events WHERE visitor_id = ?", (visitor_id,))
        c.execute("DELETE FROM visitor_faces WHERE visitor_id = ?", (visitor_id,))
        c.execute("DELETE FROM visitors WHERE id = ?", (visitor_id,))
    return [p for p in photos if p]


def purge_visitors(days):
    """隐私保护：删除超过 days 天的访客记录；很久没再出现的访客连同人脸特征一起删除。返回要删的照片。"""
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    with _lock, connect() as c:
        photos = [r["photo"] for r in c.execute(
            "SELECT photo FROM events WHERE event_type = 'VISITOR' AND ts < ?", (cutoff,))]
        photos += [r["photo"] for r in c.execute("SELECT photo FROM visitors WHERE last_seen < ?", (cutoff,))]
        c.execute("DELETE FROM events WHERE event_type = 'VISITOR' AND ts < ?", (cutoff,))
        c.execute("DELETE FROM visitor_faces WHERE visitor_id IN (SELECT id FROM visitors WHERE last_seen < ?)",
                  (cutoff,))
        c.execute("DELETE FROM visitors WHERE last_seen < ?", (cutoff,))
    return [p for p in photos if p]


def traffic(day_from, day_to):
    """人流统计：每天有多少员工、多少访客、一共经过多少人次。"""
    with connect() as c:
        return [dict(r) for r in c.execute(
            """SELECT day,
                      COUNT(DISTINCT employee_id) AS employees,
                      COUNT(DISTINCT CASE WHEN event_type = 'VISITOR' THEN COALESCE(visitor_id, -id) END) AS visitors,
                      SUM(event_type = 'VISITOR') AS visitor_passes,
                      COUNT(*) AS passes
               FROM events WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day DESC""", (day_from, day_to))]


def hourly(day):
    """某一天每个小时的人次：[(小时, 员工人次, 访客人次)]，用来画人流高峰图。"""
    with connect() as c:
        rows = {int(r["h"]): r for r in c.execute(
            """SELECT substr(ts, 12, 2) AS h, SUM(event_type != 'VISITOR') AS emp, SUM(event_type = 'VISITOR') AS vis
               FROM events WHERE day = ? GROUP BY h""", (day,))}
    return [(h, rows[h]["emp"] if h in rows else 0, rows[h]["vis"] if h in rows else 0) for h in range(24)]


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
