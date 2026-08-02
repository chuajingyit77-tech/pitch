#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
芙蓉（Seremban）餐厅名单抓取工具
================================

两种数据源，二选一或都跑：

1. OpenStreetMap Overpass API —— 免费、不用 API key，但资料没那么全
   （有店名、坐标、部分有电话/营业时间，很少有评分）

2. Google Places API (Text Search) —— 要 API key（Google Cloud 开通
   "Places API (New)"，每月有 USD200 免费额度，扫一个城市基本免费），
   资料最全：评分、评论数、电话、网站、营业时间

用法:
    # 免费方式（OSM）
    python scrape_seremban_restaurants.py --source osm

    # Google 方式（资料全，推荐用来找客户）
    export GOOGLE_MAPS_API_KEY="你的key"
    python scrape_seremban_restaurants.py --source google

    # 两个都跑，合并输出
    python scrape_seremban_restaurants.py --source both

输出: data/seremban_restaurants.csv
并且会自动做「潜在客户评分」：评论多但没有网站的餐厅 = 最值得去谈的客户。
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request

# 芙蓉市区 + Seremban 2 + Rasah 一带的经纬度范围
SEREMBAN_BBOX = (2.65, 101.87, 2.78, 102.00)  # (south, west, north, east)
SEREMBAN_CENTER = (2.7297, 101.9381)

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "seremban_restaurants.csv")

FIELDS = [
    "name", "category", "address", "phone", "website",
    "rating", "review_count", "lat", "lng",
    "source", "lead_score", "lead_reason",
]


def http_get_json(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------- OSM Overpass

def scrape_osm():
    """从 OpenStreetMap 抓芙蓉范围内所有 restaurant / cafe / fast_food。"""
    s, w, n, e = SEREMBAN_BBOX
    query = f"""
    [out:json][timeout:90];
    (
      node["amenity"~"restaurant|cafe|fast_food|food_court"]({s},{w},{n},{e});
      way["amenity"~"restaurant|cafe|fast_food|food_court"]({s},{w},{n},{e});
    );
    out center tags;
    """
    print("[OSM] 正在查询 Overpass API ...")
    result = http_get_json(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "seremban-restaurant-scraper/1.0"},
    )
    rows = []
    for el in result.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lng = el.get("lon") or el.get("center", {}).get("lon")
        addr = ", ".join(filter(None, [
            tags.get("addr:housenumber"), tags.get("addr:street"),
            tags.get("addr:city"), tags.get("addr:postcode"),
        ]))
        rows.append({
            "name": name,
            "category": tags.get("amenity", "restaurant"),
            "address": addr,
            "phone": tags.get("phone") or tags.get("contact:phone") or "",
            "website": tags.get("website") or tags.get("contact:website")
                       or tags.get("contact:facebook") or "",
            "rating": "",
            "review_count": "",
            "lat": lat, "lng": lng,
            "source": "osm",
        })
    print(f"[OSM] 抓到 {len(rows)} 家")
    return rows


# ---------------------------------------------------------- Google Places API

GOOGLE_QUERIES = [
    "restaurants in Seremban",
    "kopitiam in Seremban",
    "cafe in Seremban",
    "seafood restaurant in Seremban",
    "restoran in Seremban 2",
    "mamak in Seremban",
    "chinese restaurant in Seremban",
    "malay restaurant in Seremban",
    "western food in Seremban",
    "bak kut teh in Seremban",
]


def scrape_google(api_key):
    """用 Places API (New) Text Search，多个关键词扫一遍再去重。"""
    url = "https://places.googleapis.com/v1/places:searchText"
    field_mask = ",".join([
        "places.displayName", "places.formattedAddress",
        "places.nationalPhoneNumber", "places.websiteUri",
        "places.rating", "places.userRatingCount",
        "places.location", "places.primaryType", "places.id",
        "nextPageToken",
    ])
    seen = {}
    for q in GOOGLE_QUERIES:
        page_token = None
        for page in range(3):  # 每个关键词最多 3 页（60 家）
            body = {
                "textQuery": q,
                "locationBias": {"circle": {
                    "center": {"latitude": SEREMBAN_CENTER[0],
                               "longitude": SEREMBAN_CENTER[1]},
                    "radius": 15000.0,
                }},
                "pageSize": 20,
            }
            if page_token:
                body["pageToken"] = page_token
            try:
                result = http_get_json(
                    url,
                    data=json.dumps(body).encode(),
                    headers={
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": api_key,
                        "X-Goog-FieldMask": field_mask,
                    },
                )
            except Exception as exc:
                print(f"[Google] '{q}' 第{page+1}页失败: {exc}")
                break
            for p in result.get("places", []):
                pid = p.get("id")
                if pid in seen:
                    continue
                loc = p.get("location", {})
                seen[pid] = {
                    "name": p.get("displayName", {}).get("text", ""),
                    "category": p.get("primaryType", "restaurant"),
                    "address": p.get("formattedAddress", ""),
                    "phone": p.get("nationalPhoneNumber", ""),
                    "website": p.get("websiteUri", ""),
                    "rating": p.get("rating", ""),
                    "review_count": p.get("userRatingCount", ""),
                    "lat": loc.get("latitude"), "lng": loc.get("longitude"),
                    "source": "google",
                }
            print(f"[Google] '{q}' 累计 {len(seen)} 家")
            page_token = result.get("nextPageToken")
            if not page_token:
                break
            time.sleep(2)
    return list(seen.values())


# ------------------------------------------------------------------ 客户评分

def score_leads(rows):
    """
    给每家餐厅打「值得去谈」分数（0-100）。
    逻辑：生意好（评论多）但数字化程度低（没网站）= 最好的客户。
    """
    for r in rows:
        score, reasons = 0, []
        try:
            reviews = int(r.get("review_count") or 0)
        except (TypeError, ValueError):
            reviews = 0
        try:
            rating = float(r.get("rating") or 0)
        except (TypeError, ValueError):
            rating = 0

        if reviews >= 500:
            score += 40; reasons.append("生意旺(500+评论)")
        elif reviews >= 100:
            score += 30; reasons.append("有稳定客流(100+评论)")
        elif reviews >= 20:
            score += 15; reasons.append("有一定客流")

        if not r.get("website"):
            score += 35; reasons.append("没有网站/线上门面→最需要数字化")
        elif "facebook" in str(r.get("website", "")).lower():
            score += 20; reasons.append("只有FB专页→可升级")

        if 3.8 <= rating <= 4.6:
            score += 15; reasons.append("口碑好但还有增长空间")
        elif rating > 4.6:
            score += 10; reasons.append("口碑极好→适合做内容放大")

        if r.get("phone"):
            score += 10; reasons.append("有电话可直接联系")

        r["lead_score"] = min(score, 100)
        r["lead_reason"] = "；".join(reasons)
    rows.sort(key=lambda x: x["lead_score"], reverse=True)
    return rows


def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        key = r["name"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["osm", "google", "both"], default="osm")
    ap.add_argument("--out", default=OUTPUT_PATH)
    args = ap.parse_args()

    rows = []
    if args.source in ("osm", "both"):
        rows += scrape_osm()
    if args.source in ("google", "both"):
        key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if not key:
            sys.exit("请先 export GOOGLE_MAPS_API_KEY=你的key")
        rows += scrape_google(key)

    rows = score_leads(dedupe(rows))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n完成！共 {len(rows)} 家餐厅 → {args.out}")
    print("CSV 已按 lead_score 排序，从最上面的开始去谈。")
    top = [r for r in rows if r["lead_score"] >= 60][:10]
    if top:
        print("\n最值得先去谈的：")
        for r in top:
            print(f"  [{r['lead_score']}分] {r['name']} — {r['lead_reason']}")


if __name__ == "__main__":
    main()
