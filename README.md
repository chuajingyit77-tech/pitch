# pitch
is to make outstanding and visually and functionable good digital pitch

## 芙蓉餐厅数字化项目

- `scraper/scrape_seremban_restaurants.py` — 抓取芙蓉餐厅名单（OSM 免费 / Google Places API），自动按「值得去谈」程度打分排序
- `data/seremban_restaurants_seed.csv` — 手工整理的种子客户名单（网上调研所得，22 家）
- `docs/收费策略.md` — 收费策略：套餐定价、从哪里开始收费、开单流程

### 快速开始

```bash
# 免费抓取（OpenStreetMap）
python scraper/scrape_seremban_restaurants.py --source osm

# 完整资料（需要 Google Maps API key，有免费额度）
export GOOGLE_MAPS_API_KEY="你的key"
python scraper/scrape_seremban_restaurants.py --source google
```

输出 `data/seremban_restaurants.csv`，按 lead_score 排序 — 从最上面的餐厅开始去谈。
