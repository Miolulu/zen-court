# -*- coding: utf-8 -*-
"""静照院 · 动态资产 v2：锦鲤 / 方孔铜钱 / 三足金蟾 / 寺猫

美术宪章 v3：全部用连续曲面与分件结构，不再用「球 + 圆锥 + 圆柱」堆砌。
  koi  : 纺锤体曲面 + 有厚度的尾鳍/背鳍/胸鳍，红白朱砂斑用面级材质分区
  coin : 真·方孔圆钱（外缘轮 + 内侧方孔壁 + 上下环面），不再是实心金色圆柱
  toad : 一体 loft 鼓腹 + 顶点级癞瘤位移 + 前二后一三足 + 同心金环眼 + 口衔方孔钱
  cat  : 连续躯干曲面（头肩髋一张皮）+ 有厚度的耳廓 + 锥形尾 + 分趾

用法： blender.exe --background --python gen_assets_v2.py
"""
import bpy
import math
import os
import random

random.seed(20261109)
ROOT = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [os.path.join(ROOT, '..', 'assets', 'models'),
              os.path.join(ROOT, '..', 'zen-court', 'assets', 'models')]
OUT = next((p for p in CANDIDATES if os.path.isdir(p)), CANDIDATES[0])
os.makedirs(OUT, exist_ok=True)
TAU = math.pi * 2


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def mat(name, rgb, rough=0.85, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    n = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value = (*rgb, 1.0)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Metallic'].default_value = metal
    # 薄鳍 / loft 曲面从俯视可能看到背面，关闭背面剔除避免「只剩月牙」
    m.use_backface_culling = False
    return m


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = 0.06
    o.location = loc
    if parent:
        o.parent = parent
    return o


def mesh(name, verts, faces, materials, parent=None, loc=(0, 0, 0), face_mats=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for m in materials:
        me.materials.append(m)
    if face_mats:
        for poly, mi in zip(me.polygons, face_mats):
            poly.material_index = mi
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    for p in me.polygons:
        p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def uv_sphere(name, radius, material, parent=None, loc=(0, 0, 0),
              scale=(1, 1, 1), segs=16, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=radius)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.location = loc
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def loft(name, sections, material, parent=None, segs=24, cap=True, cap_top=False,
         materials=None, face_mats=None):
    """sections: [(cx,cy,cz, rx, ry, wrinkle_amp, wrinkle_k), ...] 沿 Z 从上到下。"""
    verts, faces, fmat = [], [], []
    for k, (cx, cy, cz, rx, ry, amp, wk) in enumerate(sections):
        for i in range(segs):
            a = TAU * i / segs
            r = 1 + amp * math.sin(wk * a + cz * 2.1)
            verts.append((cx + rx * r * math.cos(a), cy + ry * r * math.sin(a), cz))
    for j in range(len(sections) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            faces.append((j * segs + i, j * segs + i2,
                          (j + 1) * segs + i2, (j + 1) * segs + i))
            if face_mats:
                fmat.append(face_mats(j, i))
    if cap:
        base = len(verts)
        cx, cy, cz = sections[-1][0], sections[-1][1], sections[-1][2]
        verts.append((cx, cy, cz))
        for i in range(segs):
            faces.append((base, (len(sections) - 1) * segs + (i + 1) % segs,
                          (len(sections) - 1) * segs + i))
            if face_mats:
                fmat.append(0)
    # 顶面封口：否则从俯视镜头会看到一个黑色空碗（金蟾头顶的硬伤）
    if cap_top:
        base = len(verts)
        cx, cy, cz = sections[0][0], sections[0][1], sections[0][2]
        verts.append((cx, cy, cz))
        for i in range(segs):
            faces.append((base, i, (i + 1) % segs))
            if face_mats:
                fmat.append(0)
    return mesh(name, verts, faces, materials or [material], parent,
                face_mats=fmat if face_mats else None)


def tube(name, path, radii, material, parent=None, segs=12):
    verts, faces = [], []
    for k, (p, r) in enumerate(zip(path, radii)):
        prev, nxt = path[max(0, k - 1)], path[min(len(path) - 1, k + 1)]
        t = (nxt[0] - prev[0], nxt[1] - prev[1], nxt[2] - prev[2])
        tl = math.sqrt(sum(x * x for x in t)) or 1.0
        t = tuple(x / tl for x in t)
        ref = (0, 0, 1) if abs(t[2]) < 0.92 else (0, 1, 0)
        u = (t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2],
             t[0] * ref[1] - t[1] * ref[0])
        ul = math.sqrt(sum(x * x for x in u)) or 1.0
        u = tuple(x / ul for x in u)
        v = (t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2],
             t[0] * u[1] - t[1] * u[0])
        for i in range(segs):
            a = TAU * i / segs
            ca, sa = math.cos(a) * r, math.sin(a) * r
            verts.append((p[0] + u[0] * ca + v[0] * sa,
                          p[1] + u[1] * ca + v[1] * sa,
                          p[2] + u[2] * ca + v[2] * sa))
    for j in range(len(path) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            faces.append((j * segs + i, j * segs + i2,
                          (j + 1) * segs + i2, (j + 1) * segs + i))
    return mesh(name, verts, faces, [material], parent)


def export(name):
    path = os.path.join(OUT, name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True,
                              use_selection=True, export_apply=False,
                              export_morph=False, export_animations=False)
    print('[v2] exported', name, os.path.getsize(path), 'bytes')


# ---------------------------------------------------------------- 锦鲤
def build_koi():
    clear()
    white = mat('v3_koiWhite', (0.92, 0.89, 0.82), 0.5)
    red = mat('v3_koiRed', (0.58, 0.31, 0.26), 0.55)      # 低饱和朱砂
    ink = mat('v3_koiInk', (0.18, 0.21, 0.20), 0.6)
    fin = mat('v3_koiFin', (0.86, 0.83, 0.78), 0.5)

    def patch(j, i):
        # 沿体轴与周向的低频噪声，做出不规则红白/墨斑（面级分区，不做贴片球）
        n = math.sin(j * 1.7 + i * 0.55) + 0.6 * math.sin(j * 3.1 - i * 0.9)
        if 3 <= j <= 7 and n > 0.55 and (i // 3) % 3 != 1:
            return 1
        if 9 <= j <= 12 and n < -0.8:
            return 2
        return 0

    root = empty('koiRoot')
    # 头在 +X：沿 X 轴的连续纺锤体，用截面环放样
    profile = [(0.52, 0.010), (0.44, 0.075), (0.30, 0.115), (0.12, 0.135),
               (-0.06, 0.120), (-0.24, 0.085), (-0.40, 0.045), (-0.50, 0.022)]
    verts, faces, fmat = [], [], []
    segs = 20
    for j, (x, r) in enumerate(profile):
        for i in range(segs):
            a = TAU * i / segs
            # 俯视池水：Y 横向宽、Z(高度) 略扁
            verts.append((x, r * math.cos(a), r * math.sin(a) * 0.62))
    for j in range(len(profile) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            faces.append((j * segs + i, j * segs + i2,
                          (j + 1) * segs + i2, (j + 1) * segs + i))
            fmat.append(patch(j, i))
    body = mesh('koiBody', verts, faces, [white, red, ink], root, face_mats=fmat)

    # 尾鳍 / 背鳍 / 胸鳍：带厚度的薄曲面（双面三角扇）
    def fin_mesh(name, pts):
        vs = [(p[0], p[1], p[2] + 0.006) for p in pts] + [(p[0], p[1], p[2] - 0.006) for p in pts]
        n = len(pts)
        fs = []
        for i in range(n - 1):
            fs.append((i, i + 1, n + i + 1, n + i))
        return mesh(name, vs, fs, [fin], root)

    fin_mesh('koiTail', [(-0.48, 0, 0), (-0.72, 0.20, 0.02),
                         (-0.68, 0.0, 0), (-0.72, -0.20, -0.02)])
    fin_mesh('koiDorsal', [(0.14, 0, 0.10), (0.00, 0, 0.22), (-0.18, 0, 0.08)])
    for s in (-1, 1):
        fin_mesh('koiPectoral' + ('L' if s < 0 else 'R'),
                 [(0.22, s * 0.08, -0.02), (0.06, s * 0.22, -0.05), (-0.06, s * 0.10, -0.02)])
    for s in (-1, 1):
        uv_sphere('koiEye' + ('L' if s < 0 else 'R'), 0.018, ink, root,
                  loc=(0.43, s * 0.055, 0.035), segs=10, rings=8)
    export('koi.glb')


# ---------------------------------------------------------------- 方孔铜钱
def build_coin():
    clear()
    gold = mat('v3_coinGold', (0.70, 0.60, 0.41), 0.62, 0.28)
    dark = mat('v3_coinRim', (0.55, 0.46, 0.30), 0.72, 0.20)
    R, H, T = 0.105, 0.032, 0.024     # 外半径 / 方孔半边长 / 厚度
    N = 32
    verts, faces, fmat = [], [], []

    def inner(a):
        c, s = abs(math.cos(a)), abs(math.sin(a))
        t = H / max(c, s)              # 射线与正方形边界的交点距离
        return (t * math.cos(a), t * math.sin(a))

    # 上下两个环面 + 外侧壁 + 方孔内壁
    for k, z in enumerate((T / 2, -T / 2)):
        for i in range(N):
            a = TAU * i / N
            verts.append((R * math.cos(a), R * math.sin(a), z))
        for i in range(N):
            a = TAU * i / N
            x, y = inner(a)
            verts.append((x, y, z))
    for k in (0, 1):
        off = k * 2 * N
        for i in range(N):
            i2 = (i + 1) % N
            faces.append((off + i, off + i2, off + N + i2, off + N + i))
            fmat.append(0 if (i // 4) % 5 else 1)
    for i in range(N):
        i2 = (i + 1) % N
        faces.append((i, i2, 2 * N + i2, 2 * N + i))
        fmat.append(1)                                  # 外缘轮
        faces.append((N + i, N + i2, 3 * N + i2, 3 * N + i))
        fmat.append(1)                                  # 方孔内壁
    mesh('coinBase', verts, faces, [gold, dark], face_mats=fmat)
    export('coin.glb')


# ---------------------------------------------------------------- 三足金蟾
def build_toad():
    clear()
    # 旧铜包浆（不是纯白泥胎）：凸起磨亮的暗铜 + 凹处暗褐铜锈 + 少量旧金描线
    clay = mat('v3_toadClay', (0.52, 0.43, 0.30), 0.66, 0.24)
    shade = mat('v3_toadShade', (0.33, 0.30, 0.23), 0.84, 0.16)
    trim = mat('v3_toadTrim', (0.72, 0.61, 0.42), 0.55, 0.28)
    ink = mat('v3_toadInk', (0.16, 0.18, 0.17), 0.8)
    root = empty('toad')
    # 一体 loft：鼓腹低伏，前宽后收；顶点级正弦位移做癞瘤，不用独立球
    sections = [
        (0, -0.02, 0.62, 0.30, 0.26, 0.030, 7),
        (0, 0.00, 0.52, 0.47, 0.40, 0.038, 9),
        (0, 0.02, 0.36, 0.55, 0.46, 0.045, 11),
        (0, 0.03, 0.20, 0.54, 0.45, 0.050, 13),
        (0, 0.02, 0.08, 0.46, 0.39, 0.045, 11),
    ]
    body = loft('toadBody', sections, clay, root, segs=40, cap_top=True)
    # 下巴与浅色腹部：连续曲面的一部分，不另起球
    loft('toadBelly', [(0, -0.10, 0.28, 0.40, 0.26, 0.01, 7),
                       (0, -0.11, 0.14, 0.38, 0.24, 0.01, 7)], shade, root, segs=28, cap=False)
    # 蟾头宽扁（不是圆球），与鼓腹连成低伏剪影
    head = loft('toadHead', [(0, -0.32, 0.44, 0.43, 0.30, 0.02, 7),
                             (0, -0.36, 0.34, 0.45, 0.31, 0.02, 7),
                             (0, -0.34, 0.24, 0.39, 0.27, 0.02, 7)],
                            clay, root, segs=32, cap_top=True)
    # 同心金环 + 圆形大瞳（按 1 号定稿图形态）
    eyes = []
    for s, nm in ((-1, 'toadEyeL'), (1, 'toadEyeR')):
        e = empty(nm, root, loc=(s * 0.22, -0.28, 0.46))
        uv_sphere('ring' + nm[-1], 0.095, trim, e, scale=(1, 0.7, 1), segs=14, rings=10)
        uv_sphere('pupil' + nm[-1], 0.052, ink, e, loc=(0, -0.05, 0.01),
                  scale=(1, 0.6, 1), segs=12, rings=8)
        eyes.append(e)
    # 阔口微张
    tube('toadMouth', [(-0.22, -0.47, 0.30), (0, -0.52, 0.27), (0.22, -0.47, 0.30)],
         [0.016, 0.020, 0.016], shade, root, segs=8)
    # 三足：前二后一，趾端圆钝
    for s in (-1, 1):
        tube('toadLeg' + ('L' if s < 0 else 'R'),
             [(s * 0.36, -0.10, 0.30), (s * 0.44, -0.28, 0.16), (s * 0.46, -0.40, 0.06)],
             [0.13, 0.11, 0.115], clay, root, segs=12)
        uv_sphere('toadToe' + ('L' if s < 0 else 'R'), 0.10, shade, root,
                  loc=(s * 0.46, -0.42, 0.045), scale=(1.1, 1.3, 0.55), segs=12, rings=8)
    tube('toadHind', [(0, 0.34, 0.24), (0.10, 0.46, 0.12), (0.12, 0.50, 0.05)],
         [0.15, 0.12, 0.11], clay, root, segs=12)
    # 口中方孔钱（真几何挖孔，缩放到 0.62）
    grp = empty('grpCoin', root, loc=(0, -0.53, 0.30))
    R, H, T, N = 0.16, 0.048, 0.022, 24
    vs, fs = [], []
    for z in (T / 2, -T / 2):
        for i in range(N):
            a = TAU * i / N
            vs.append((R * math.cos(a), R * math.sin(a), z))
        for i in range(N):
            a = TAU * i / N
            c, s2 = abs(math.cos(a)), abs(math.sin(a))
            t = H / max(c, s2)
            vs.append((t * math.cos(a), t * math.sin(a), z))
    for k in (0, 1):
        off = k * 2 * N
        for i in range(N):
            i2 = (i + 1) % N
            fs.append((off + i, off + i2, off + N + i2, off + N + i))
    for i in range(N):
        i2 = (i + 1) % N
        fs.append((i, i2, 2 * N + i2, 2 * N + i))
        fs.append((N + i, N + i2, 3 * N + i2, 3 * N + i))
    mesh('toadCoin', vs, fs, [trim], grp)
    export('toad_v2.glb')


# ---------------------------------------------------------------- 寺猫
def build_cat():
    clear()
    fur = mat('v3_catFur', (0.91, 0.87, 0.79), 0.94)
    point = mat('v3_catPoint', (0.36, 0.27, 0.21), 0.94)
    white = mat('v3_catWhite', (0.96, 0.93, 0.86), 0.94)
    ink = mat('v3_catInk', (0.16, 0.14, 0.12), 0.8)
    pink = mat('v3_catPink', (0.76, 0.53, 0.50), 0.9)
    g = empty('catGroup')
    # 躯干：头肩髋连成一张皮（沿 X 的 loft，不是三颗相切球）
    sections = [(-0.46, 0.30), (-0.34, 0.36), (-0.14, 0.34),
                (0.10, 0.30), (0.30, 0.28), (0.46, 0.24)]
    verts, faces = [], []
    segs = 20
    for x, r in sections:
        for i in range(segs):
            a = TAU * i / segs
            # Blender (x, y=横向, z=高度)；导出 y-up 后高度回到 game 的 Y
            verts.append((x, r * math.sin(a), r * 0.82 * math.cos(a) + 0.42))
    for j in range(len(sections) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            faces.append((j * segs + i, j * segs + i2, (j + 1) * segs + i2, (j + 1) * segs + i))
    body = mesh('body', verts, faces, [fur], g)
    loft('belly', [(0.12, 0, 0.20, 0.26, 0.16, 0, 1),
                   (0.12, -0.02, 0.12, 0.24, 0.14, 0, 1)], white, g, segs=16, cap=False)
    head = uv_sphere('head', 0.28, fur, g, loc=(0.52, 0, 0.72),
                     scale=(1.0, 1.0, 0.95), segs=24, rings=16)
    # 耳廓：有厚度的三角曲面（用 tube 圈出轮廓，不是四棱锥）
    ears = []
    for s in (-1, 1):
        e = empty('ear' + ('L' if s < 0 else 'R'), g, loc=(0.48, s * 0.17, 0.95))
        tube('earShell' + ('L' if s < 0 else 'R'),
             [(0, 0, 0), (0.02, s * 0.02, 0.12), (-0.02, s * 0.03, 0.20)],
             [0.085, 0.065, 0.012], point, e, segs=10)
        ears.append(e)
    # 眼 / 鼻 / 口鼻体积
    eyes = []
    for s in (-1, 1):
        eyes.append(uv_sphere('eye' + ('L' if s < 0 else 'R'), 0.045, ink, g,
                              loc=(0.755, s * 0.12, 0.75), scale=(0.6, 1.0, 1.1),
                              segs=12, rings=10))
    nose = uv_sphere('nose', 0.035, pink, g, loc=(0.795, 0, 0.66),
                     scale=(1, 1, 0.7), segs=10, rings=8)
    # 前爪 / 后腿（分趾用小球做趾端，但腿是连续管）
    paws, hind = [], []
    for s in (-1, 1):
        leg = empty('paw' + ('L' if s < 0 else 'R'), g, loc=(0.34, s * 0.17, 0.14))
        tube('foreleg' + ('L' if s < 0 else 'R'),
             [(0, 0, 0.22), (0.02, 0, 0.10), (0.03, 0, 0)],
             [0.075, 0.065, 0.085], fur, leg, segs=10)
        paws.append(leg)
        hind.append(uv_sphere('hind' + ('L' if s < 0 else 'R'), 0.15, fur, g,
                              loc=(-0.30, s * 0.23, 0.28), scale=(1.0, 0.9, 0.9),
                              segs=14, rings=10))
    tail = empty('tailPivot', g, loc=(-0.48, 0, 0.52))
    tube('tail', [(0, 0, 0), (-0.18, 0.03, 0.10), (-0.30, 0.06, 0.32), (-0.26, 0.02, 0.50)],
         [0.070, 0.062, 0.052, 0.038], point, tail, segs=10)
    export('cat_v2.glb')


def main():
    build_koi()
    build_coin()
    build_toad()
    build_cat()
    print('[v2] all assets exported to', OUT)


main()
