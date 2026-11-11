#!/usr/bin/env python3
"""Pack photo-made fish from the CC0 "Fish Kit" by なちゃっと (https://cda-social.github.io/fish/, CC0 1.0) for 栖境.

Only the kit's models and photographs are used (its own program is not): for each species, the detailed model
(~5,000 triangles) and the far one (~700) go into one GLB, already in the fish frame of our swim shader
(lib/fish.js: head toward +X, length 1, centred), with the attribute it reads, aFin = (region, distance from the
fin's base 0..1): body 0, tail 1, dorsal 2, anal 3, pectoral 4, eye 6. They share one texture atlas:
- the texels under the body are made fully opaque (only fins are see-through: the iPad's fin pass draws exactly
  the fin triangles' translucent part, so a body texel below 1 would leave a crack);
- colour is bled into every clear texel, so edges that sample them do not turn dark;
- it is padded to a power of two (WebGL 1 mipmaps), the UVs scaled to match, and can be halved for fish only seen
  small (a school in the blue).
Where the tail meets the body, the fin is made solid up to the body's outline (tail_root: the water showed through a
thin gap there as a bright arc), and the end of the body is shaded like its flanks (tail_stock).

    python3 idle-world-3d/tools/photofish_pack.py <fish-kit>/fish madai:1024 kamasu:512 ...

Writes assets/models/fish_<id>.glb and fish_<id>.glb.js (the base64 module app.js loads, as for the other models).
"""
import base64, io, json, math, os, struct, sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'models')
FILES = {'seabass': 'suzuki'}  # kit id -> file name where they differ


def read_glb(path):
    b = open(path, 'rb').read()
    magic, _, _ = struct.unpack_from('<III', b, 0)
    if magic != 0x46546C67:
        raise SystemExit(f'{path}: not a GLB')
    off, chunks = 12, []
    while off < len(b):
        ln, _ = struct.unpack_from('<II', b, off)
        chunks.append(b[off + 8: off + 8 + ln])
        off += 8 + ln
    return json.loads(chunks[0]), chunks[1]


def accessor(j, binc, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    size = np.dtype(dt).itemsize * n
    stride = bv.get('byteStride', size)
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    if stride == size:
        arr = np.frombuffer(binc, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)
    else:
        raw = np.frombuffer(binc, dtype=np.uint8, count=stride * a['count'], offset=off).reshape(a['count'], stride)
        arr = raw[:, :size].copy().view(dt).reshape(a['count'], n)
    return arr.astype(np.float32 if dt == np.float32 else np.uint32)


def load_mesh(path):
    j, binc = read_glb(path)
    prim = j['meshes'][0]['primitives'][0]
    at = prim['attributes']
    mesh = {k: accessor(j, binc, at[g]) for k, g in (('pos', 'POSITION'), ('nor', 'NORMAL'), ('uv', 'TEXCOORD_0'), ('fin', '_FIN'))}
    mesh['idx'] = accessor(j, binc, prim['indices']).reshape(-1)
    img = j['images'][j['textures'][0].get('extensions', {}).get('EXT_texture_webp', {}).get('source', j['textures'][0].get('source', 0))]
    bv = j['bufferViews'][img['bufferView']]
    mesh['image'] = Image.open(io.BytesIO(binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGBA')
    return mesh


def fin_regions(m, frame):
    """aFin (region, distance from the fin's base) from the kit's _FIN (x: 0 body, 1 median fins, 4 paired fins,
    6 eyes; y: 0..1 along a paired fin) and the shape of the body."""
    pos, code = m['pos'], np.rint(m['fin'][:, 0]).astype(int)
    body = pos[code == 0]
    x_tail = body[:, 0].min()
    # the body's height along its length (64 slices), for how far a dorsal or anal fin vertex stands off it
    bins = np.linspace(body[:, 0].min(), body[:, 0].max(), 65)
    top = np.full(64, np.nan); bot = np.full(64, np.nan)
    k = np.clip(np.searchsorted(bins, body[:, 0]) - 1, 0, 63)
    for i in range(64):
        s = body[k == i]
        if len(s):
            top[i] = s[:, 1].max(); bot[i] = s[:, 1].min()
    ok = ~np.isnan(top)
    xs = 0.5 * (bins[:-1] + bins[1:])
    top = np.interp(xs, xs[ok], top[ok]); bot = np.interp(xs, xs[ok], bot[ok])
    out = np.zeros((len(pos), 2), np.float32)
    out[code == 6, 0] = 6
    paired = code == 4
    out[paired, 0] = 4
    out[paired, 1] = np.clip(m['fin'][paired, 1], 0, 1)
    med = np.where(code == 1)[0]
    L = frame['len']
    for i in med:
        x, y = pos[i, 0], pos[i, 1]
        if x < x_tail + 0.03 * L:
            out[i] = (1, (x_tail + 0.03 * L - x))
        else:
            t, b = np.interp(x, xs, top), np.interp(x, xs, bot)
            out[i] = (2, y - t) if y > 0.5 * (t + b) else (3, b - y)
    for r in (1, 2, 3):
        sel = out[:, 0] == r
        if sel.any():
            span = max(out[sel, 1].max(), 1e-6)
            out[sel, 1] = np.clip(out[sel, 1] / span, 0, 1)
    return out


def tail_stock(p, n, uv, afin, idx):
    """The kit closes the body at the root of the tail with a small cap whose normals point straight back. Seen from
    the side it stands edge-on, and the reef's rim light (scenes/reef/uw.js: strongest where the normal is across the
    view) drew it as a thin bright line across the tail's root. Give the end of the body the normals of its flanks
    instead, the narrow tail stock it closes, leaning back a little: each half its own, the vertices on the mid-plane
    split between the halves (a normal turning smoothly from one flank to the other would pass across the view again,
    or through zero). In the fish frame (length 1); returns the new p, n, uv, afin and indices."""
    body = afin[:, 0] == 0
    x_tail = p[body, 0].min()
    end = body & (p[:, 0] < x_tail + 0.02) & (n[:, 0] < -0.3)
    if not end.any():
        return p, n, uv, afin, idx
    tri = idx.reshape(-1, 3).astype(np.int64)
    on_mid = np.abs(p[:, 2]) < 1e-4
    # the body's two halves meet only along the mid-plane (no triangle crosses it): the far half's triangles at the
    # end take copies of its mid-plane vertices
    far = (p[tri, 2].mean(1) < 0) & end[tri].any(1)
    dup = {}
    for t in np.where(far)[0]:
        for k in range(3):
            v = tri[t, k]
            if end[v] and on_mid[v]:
                tri[t, k] = dup.setdefault(v, len(p) + len(dup))
    src = np.array(sorted(dup, key=dup.get), np.int64)
    if len(p) + len(src) > 65535:
        raise SystemExit('too many vertices for 16-bit indices')
    p, n, uv, afin = (np.concatenate([a, a[src]]) for a in (p, n, uv, afin))
    side = np.where(p[:, 2] < -1e-4, -1.0, 1.0)
    side[len(p) - len(src):] = -1.0
    sel = np.where(np.concatenate([end, np.ones(len(src), bool)]))[0]
    nn = np.stack([np.full(len(sel), -0.45), 0.3 * n[sel, 1], side[sel]], 1)
    n = n.copy()
    n[sel] = nn / np.linalg.norm(nn, axis=1, keepdims=True)
    return p, n, uv, afin, tri.reshape(-1)


def raster_mask(shape, uv, idx, keep, attr=None):
    """Texels under the triangles whose three corners pass `keep` (UV space, glTF top-left origin). With `attr` (a
    row per vertex), also returns its value interpolated at each of those texels (NaN elsewhere)."""
    h, w = shape
    mask = np.zeros((h, w), bool)
    val = None if attr is None else np.full((h, w, attr.shape[1]), np.nan)
    tri = idx.reshape(-1, 3)
    for a, b, c in tri:
        if not (keep[a] and keep[b] and keep[c]):
            continue
        p = np.array([uv[a], uv[b], uv[c]], np.float64) * [w, h]
        x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        x0, y0 = max(x0 - 1, 0), max(y0 - 1, 0); x1, y1 = min(x1 + 1, w - 1), min(y1 + 1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
        if abs(d) < 1e-12:
            continue
        l1 = ((p[1, 1] - p[2, 1]) * (gx - p[2, 0]) + (p[2, 0] - p[1, 0]) * (gy - p[2, 1])) / d
        l2 = ((p[2, 1] - p[0, 1]) * (gx - p[2, 0]) + (p[0, 0] - p[2, 0]) * (gy - p[2, 1])) / d
        l3 = 1 - l1 - l2
        e = -0.6 / max(abs(d), 1) ** 0.5  # a little over half a texel outside the edge too
        inside = (l1 >= e) & (l2 >= e) & (l3 >= e)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside
        if val is not None:
            for k in range(attr.shape[1]):
                sub = val[y0:y1 + 1, x0:x1 + 1, k]
                sub[inside] = (l1 * attr[a, k] + l2 * attr[b, k] + l3 * attr[c, k])[inside]
    return mask if attr is None else (mask, val)


def tail_root(shape, m, frame, reach=0.012, margin=0.003, step=0.0005):
    """Texels of the median fin sheet to make solid where the tail meets the body. The kit cuts the tail fin's base as
    a notch around the rounded end of the body, a little loose and soft-edged: through that thin gap (up to ~0.4% of
    the length) the water showed as a bright arc across the tail's root. Everything on the sheet within `margin` of
    the body's side outline near its end is made solid (it keeps the colour bled into it, the fin's own); the part
    inside the outline stays hidden by the body. Fish frame: length 1."""
    p = (m['pos'] - frame['c']) / frame['len']
    region = m['afin'][:, 0]
    tri = m['idx'].reshape(-1, 3)
    x_tail = p[region == 0, 0].min()
    # the body's side outline near its end, on a fine grid (x, y), grown by `margin`
    x0, y0 = x_tail - 2 * margin, p[region == 0, 1].min() - 2 * margin
    nx = int(np.ceil((reach + 4 * margin) / step))
    ny = int(np.ceil((p[region == 0, 1].max() + 2 * margin - y0) / step))
    gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * step, y0 + (np.arange(ny) + 0.5) * step)
    side = np.zeros((ny, nx), bool)
    for t in tri[(region[tri] == 0).all(1)]:
        (ax, ay), (bx, by), (cx, cy) = p[t, :2]
        if min(ax, bx, cx) > x0 + nx * step:
            continue
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-14:
            continue
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        side |= (l1 >= 0) & (l2 >= 0) & (1 - l1 - l2 >= 0)
    r = int(round(margin / step))
    pad = np.zeros((ny + 2 * r, nx + 2 * r), bool)
    pad[r:r + ny, r:r + nx] = side
    grown = np.zeros((ny, nx), bool)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                grown |= pad[r + dy:r + dy + ny, r + dx:r + dx + nx]
    # the tail fin's texels, with the point of the fish each one shows: the triangles of its own piece of the median
    # sheet (connected to the tip of the tail; its base inside the body is labelled dorsal or anal by position), not
    # the dorsal and anal fins, some of which end near the tail too
    med = (region >= 1) & (region <= 3)
    mt = tri[med[tri].all(1)]
    root = np.arange(len(p))
    def find(v):
        while root[v] != v:
            root[v] = root[root[v]]
            v = root[v]
        return v
    for a, b, c in mt:
        ra, rb, rc = find(a), find(b), find(c)
        root[rb] = ra; root[rc] = ra
    tip = np.where(med)[0][np.argmin(p[med, 0])]
    caudal = mt[np.array([find(t[0]) == find(tip) for t in mt], bool)]
    sheet, xy = raster_mask(shape, m['uv'], caudal.reshape(-1), np.ones(len(p), bool), p[:, :2])
    ix = np.floor((np.nan_to_num(xy[..., 0], nan=-9) - x0) / step).astype(int)
    iy = np.floor((np.nan_to_num(xy[..., 1], nan=-9) - y0) / step).astype(int)
    ok = sheet & (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) & (xy[..., 0] <= x_tail + reach)
    out = np.zeros(sheet.shape, bool)
    out[ok] = grown[iy[ok], ix[ok]]
    return out


def bleed(rgba, thr=8, rounds=96):
    """Give every (nearly) clear texel the colour of the opaque texels next to it, spreading outward."""
    a = rgba[:, :, 3]
    rgb = rgba[:, :, :3].astype(np.float32)
    filled = a >= thr
    for _ in range(rounds):
        if filled.all():
            break
        acc = np.zeros_like(rgb); cnt = np.zeros(a.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            f = np.roll(np.roll(filled, dy, 0), dx, 1)
            c = np.roll(np.roll(rgb, dy, 0), dx, 1)
            acc += c * f[:, :, None]; cnt += f
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled = filled | grow
    rgb[~filled] = rgb[filled].mean(0)
    out = rgba.copy()
    out[:, :, :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    return out


def pack(folder, fid, tex):
    name = FILES.get(fid, fid)
    hi = load_mesh(os.path.join(folder, name + '.glb'))
    lo = load_mesh(os.path.join(folder, name + '_lo.glb'))
    # the fish frame: the bounding box of the detailed model (fins included), length 1 along +X (the head)
    lo_x, hi_x = hi['pos'].min(0), hi['pos'].max(0)
    frame = {'c': 0.5 * (lo_x + hi_x), 'len': float(hi_x[0] - lo_x[0])}
    for m in (hi, lo):
        m['afin'] = fin_regions(m, frame)
    img = np.array(hi['image'])
    h0, w0 = img.shape[:2]
    # body texels opaque: the body is solid, only fins are see-through
    for m in (hi, lo):
        keep = (m['afin'][:, 0] == 0) | (m['afin'][:, 0] == 6)
        mask = raster_mask((h0, w0), m['uv'], m['idx'], keep)
        img[mask, 3] = 255
    img = bleed(img)
    # the root of the tail closed (after the bleed, so the texels made solid there carry the fin's colour)
    for m in (hi, lo):
        img[tail_root((h0, w0), m, frame), 3] = 255
    im = Image.fromarray(img, 'RGBA')
    w = tex
    h = round(h0 * w / w0)
    if w != w0:
        im = im.resize((w, h), Image.LANCZOS)
    hp = 1 << (h - 1).bit_length()
    canvas = Image.new('RGBA', (w, hp), (0, 0, 0, 0))
    canvas.paste(im, (0, 0))
    atlas = bleed(np.array(canvas))
    buf = io.BytesIO()
    Image.fromarray(atlas, 'RGBA').save(buf, 'WEBP', quality=90, method=6, alpha_quality=100)
    webp = buf.getvalue()
    vscale = h / hp

    blob = bytearray()
    views, accs = [], []

    def view(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        v = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
        if target:
            v['target'] = target
        blob.extend(data)
        views.append(v)
        return len(views) - 1

    def acc(arr, kind, comp, target, minmax=False):
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': comp, 'count': int(arr.shape[0]), 'type': kind}
        if minmax:
            a['min'] = [float(v) for v in arr.min(0)]; a['max'] = [float(v) for v in arr.max(0)]
        accs.append(a)
        return len(accs) - 1

    meshes = []
    for tag, m in (('hi', hi), ('lo', lo)):
        p = ((m['pos'] - frame['c']) / frame['len']).astype(np.float32)
        n = m['nor'] / np.maximum(np.linalg.norm(m['nor'], axis=1, keepdims=True), 1e-8)
        uv = m['uv'].copy(); uv[:, 1] *= vscale
        p, n, uv, afin, idx = tail_stock(p, n, uv, m['afin'], m['idx'])
        attrs = {
            'POSITION': acc(p.astype(np.float32), 'VEC3', 5126, 34962, True),
            'NORMAL': acc(n.astype(np.float32), 'VEC3', 5126, 34962),
            'TEXCOORD_0': acc(uv.astype(np.float32), 'VEC2', 5126, 34962),
            '_AFIN': acc(afin.astype(np.float32), 'VEC2', 5126, 34962),
        }
        ind = acc(idx.astype(np.uint16).reshape(-1, 1), 'SCALAR', 5123, 34963)
        meshes.append({'name': tag, 'primitives': [{'attributes': attrs, 'indices': ind, 'material': 0}]})
    img_view = view(webp)
    gltf = {
        'asset': {'version': '2.0', 'generator': '栖境 photofish_pack.py (Fish Kit, CC0 1.0, by なちゃっと)'},
        'extensionsUsed': ['EXT_texture_webp'], 'extensionsRequired': ['EXT_texture_webp'],
        'scene': 0, 'scenes': [{'nodes': [0, 1]}],
        'nodes': [{'name': 'hi', 'mesh': 0}, {'name': 'lo', 'mesh': 1}],
        'meshes': meshes,
        'materials': [{'name': fid, 'doubleSided': True, 'alphaMode': 'MASK', 'alphaCutoff': 0.5,
                       'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 0.45}}],
        'textures': [{'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': 0}}}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}],
        'images': [{'bufferView': img_view, 'mimeType': 'image/webp', 'name': fid}],
        'accessors': accs, 'bufferViews': views,
        'buffers': [{'byteLength': 0}],
        'extras': {'source': 'Fish Kit by なちゃっと, CC0 1.0, https://cda-social.github.io/fish/', 'lengthM': round(frame['len'], 4)},
    }
    while len(blob) % 4:
        blob.append(0)
    gltf['buffers'][0]['byteLength'] = len(blob)
    js = json.dumps(gltf, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    while len(js) % 4:
        js += b' '
    glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    base = os.path.join(OUT, f'fish_{fid}.glb')
    open(base, 'wb').write(glb)
    open(base + '.js', 'w').write(f'// fish_{fid}.glb packed as base64 so it can be served as a script module (see app.js loadGLTF).\n'
                                  f'// Fish Kit by なちゃっと, CC0 1.0 (https://cda-social.github.io/fish/); packed by tools/photofish_pack.py.\n'
                                  f'export default "{base64.b64encode(glb).decode()}";\n')
    regions = {r: int((hi['afin'][:, 0] == r).sum()) for r in (0, 1, 2, 3, 4, 6)}
    print(f'{fid}: {len(glb) // 1024} KB (texture {w}x{hp}, {len(webp) // 1024} KB), hi {len(hi["idx"]) // 3} tris, lo {len(lo["idx"]) // 3} tris, '
          f'length {frame["len"]:.3f} m, regions {regions}')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    for spec in sys.argv[2:]:
        fid, _, tex = spec.partition(':')
        pack(sys.argv[1], fid, int(tex or 1024))
