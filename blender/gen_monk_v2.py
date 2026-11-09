# -*- coding: utf-8 -*-
"""静照院 · 和尚 v2（美术宪章 v3 / 国风写意写实）

取代 v1 的「球头 + 锥袍 + 胸口两颗球手」：
  * 袍身 = 一条连续 loft 曲面，带重力褶皱（腰紧、下摆外扬、10 条纵向衣纹）
  * 头 = 有颅骨/下颌/耳廓/眼睑/鼻梁/眉的结构体，不是标准球 + 贴片
  * 袖臂 = 从肩到袖口的连续曲面链（sleeveL/R 本身是可旋转 Group），袖口成布兜
  * 合十 = grpHands 里两片扁平手掌相贴；靠 sleeveL/R 旋转抬起整条手臂，不再「手穿袍」
  * 比例：总高 1.95 锁死；头高 0.60（≈3.25 头高）；头顶到眉线 ≥ 头高 45%

坐标：Blender Z 向上，脸朝 -Y；export_yup=True 后 game(x, y_up, z) ↔ Blender(x, z, -y)。
节点名严格对齐 game.js buildMonk() 的 13 项完整性校验。
材质一律用语义名，交给 game.js GLB_MATS / applyGameMaterials() 统一接到 v3 色板。

用法： blender.exe --background --python gen_monk_v2.py
"""
import bpy
import math
import os
import random

random.seed(20261109)
ROOT = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [
    os.path.join(ROOT, '..', 'assets', 'models'),
    os.path.join(ROOT, '..', 'zen-court', 'assets', 'models'),
]
OUT = next((p for p in CANDIDATES if os.path.isdir(p)), CANDIDATES[0])
os.makedirs(OUT, exist_ok=True)
OUT_FILE = os.path.join(OUT, 'monk_v2.glb')

TAU = math.pi * 2


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


def mat(name, rgb, rough=0.9, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    n = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value = (*rgb, 1.0)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Metallic'].default_value = metal
    return m


MATS = {
    'robe': mat('robe', (0.47, 0.55, 0.50), 0.9),
    'robeDark': mat('robeDark', (0.37, 0.44, 0.40), 0.9),
    'skin': mat('skin', (0.95, 0.90, 0.82), 0.88),
    'ink': mat('ink', (0.18, 0.20, 0.19), 0.9),
    'sash': mat('sash', (0.80, 0.74, 0.60), 0.9),
    'bead': mat('bead', (0.51, 0.34, 0.21), 0.85),
    'goldtrim': mat('goldtrim', (0.70, 0.60, 0.41), 0.62, 0.2),
    'hi': mat('hi', (1.0, 1.0, 1.0), 0.5),
    'blush': mat('blush', (0.78, 0.55, 0.50), 0.9),
}


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = 0.08
    o.location = loc
    if parent:
        o.parent = parent
    return o


def mesh(name, verts, faces, material, parent=None, loc=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(material)
    o.location = loc
    if parent:
        o.parent = parent
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    # 只烘 scale / rotation，保留 location 作为 glTF node translation
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def uv_sphere(name, radius, material, parent=None, loc=(0, 0, 0),
              scale=(1, 1, 1), segs=20, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings,
                                         radius=radius, location=(0, 0, 0))
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


def loft_rings(name, rings, material, parent=None, segs=32, cap_bottom=True):
    """rings: [(center_xyz, radius, radial_scale_y, wrinkle_amp, wrinkle_k), ...]
    从上到下依次连接，生成连续曲面（不封顶，肩部由领口件盖住）。"""
    verts, faces = [], []
    for (cx, cy, cz), r, sy, amp, k in rings:
        for i in range(segs):
            a = TAU * i / segs
            rr = r + amp * math.sin(k * a + cz * 1.7)
            verts.append((cx + rr * math.cos(a), cy + rr * sy * math.sin(a), cz))
    for j in range(len(rings) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            a, b = j * segs + i, j * segs + i2
            c, d = (j + 1) * segs + i2, (j + 1) * segs + i
            faces.append((a, b, c, d))
    if cap_bottom:
        base = len(verts)
        cz = rings[-1][0][2]
        verts.append((rings[-1][0][0], rings[-1][0][1], cz))
        for i in range(segs):
            faces.append((base, (len(rings) - 1) * segs + (i + 1) % segs,
                          (len(rings) - 1) * segs + i))
    return mesh(name, verts, faces, material, parent)


def tube_along(name, path, radii, material, parent=None, segs=14):
    """稳定版：用固定参考轴构造每个截面的正交基。"""
    verts, faces = [], []
    for k, (p, r) in enumerate(zip(path, radii)):
        prev = path[max(0, k - 1)]
        nxt = path[min(len(path) - 1, k + 1)]
        t = (nxt[0] - prev[0], nxt[1] - prev[1], nxt[2] - prev[2])
        tl = math.sqrt(sum(x * x for x in t)) or 1.0
        t = tuple(x / tl for x in t)
        ref = (0, 0, 1) if abs(t[2]) < 0.92 else (0, 1, 0)
        u = (t[1] * ref[2] - t[2] * ref[1],
             t[2] * ref[0] - t[0] * ref[2],
             t[0] * ref[1] - t[1] * ref[0])
        ul = math.sqrt(sum(x * x for x in u)) or 1.0
        u = tuple(x / ul for x in u)
        v = (t[1] * u[2] - t[2] * u[1],
             t[2] * u[0] - t[0] * u[2],
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
    return mesh(name, verts, faces, material, parent)


def build():
    clear()
    root = empty('monk')
    lower = empty('lower', root)
    bow = empty('bowPivot', root)

    # ---- 袍身：连续 loft，肩→腰收→下摆外扬，10 条纵向重力褶 ----
    robe_rings = []
    profile = [
        (1.34, 0.235, 0.004), (1.28, 0.375, 0.006), (1.14, 0.445, 0.009),
        (0.96, 0.455, 0.012), (0.78, 0.425, 0.016), (0.58, 0.455, 0.022),
        (0.36, 0.510, 0.032), (0.16, 0.570, 0.042), (0.03, 0.605, 0.048),
    ]
    for z, r, amp in profile:
        robe_rings.append(((0, 0, z), r, 0.88, amp, 10))
    robe = loft_rings('robe', robe_rings, MATS['robe'], bow, segs=48)

    # 领口：交领右衽，两条斜向的连续滚边（不是独立圆柱）
    for side, sign in [('lapelA', -1), ('lapelB', 1)]:
        path = [(sign * 0.02, -0.225, 1.31),
                (sign * 0.10, -0.255, 1.18),
                (sign * 0.19, -0.255, 1.02),
                (sign * 0.26, -0.215, 0.86)]
        tube_along(side, path, [0.035, 0.038, 0.040, 0.035],
                   MATS['robeDark'], bow)

    # 腰带
    waist = loft_rings('sash', [((0, 0, 0.80), 0.435, 0.88, 0.004, 10),
                                ((0, 0, 0.73), 0.432, 0.88, 0.004, 10)],
                       MATS['sash'], bow, segs=40, cap_bottom=False)

    # ---- 头：结构体（颅骨略扁、下颌收、脸朝 -Y）----
    head = uv_sphere('head', 1.0, MATS['skin'], bow,
                     loc=(0, -0.01, 1.65), scale=(0.295, 0.275, 0.30),
                     segs=28, rings=20)
    # 顶点级塑形：下颌收窄、后脑略鼓、额头饱满
    for v in head.data.vertices:
        x, y, z = v.co
        if z < -0.15:
            k = 1.0 + (z + 0.15) * 0.55
            v.co.x *= max(0.55, k)
            v.co.y *= max(0.65, k)
        if y > 0.1:
            v.co.y *= 1.06
        if z > 0.45:
            v.co.z *= 0.97

    # 耳廓：带厚度的扁环（不是圆锥/球）
    for sign, nm in [(-1, 'earL'), (1, 'earR')]:
        path = [(sign * 0.275, 0.0, 1.66), (sign * 0.305, -0.01, 1.70),
                (sign * 0.315, -0.02, 1.62), (sign * 0.285, -0.01, 1.585)]
        tube_along(nm, path, [0.045, 0.052, 0.048, 0.032], MATS['skin'], bow, segs=10)

    # 眉（细弧）、眼（小球 + 高光）、鼻梁、嘴
    eyes = []
    for sign, nm in [(-1, 'eyeL'), (1, 'eyeR')]:
        hn = 'hiL' if sign < 0 else 'hiR'
        brow_path = [(sign * 0.055, -0.265, 1.685),
                     (sign * 0.115, -0.272, 1.700),
                     (sign * 0.170, -0.255, 1.690)]
        tube_along('brow' + nm[-1], brow_path, [0.010, 0.012, 0.009],
                   MATS['ink'], bow, segs=8)
        e = uv_sphere(nm, 0.030, MATS['ink'], bow,
                      loc=(sign * 0.115, -0.262, 1.638),
                      scale=(1.0, 0.55, 1.15), segs=14, rings=10)
        uv_sphere(hn, 0.010, MATS['hi'], bow,
                  loc=(sign * 0.108, -0.283, 1.650), segs=8, rings=6)
        eyes.append(e)

    tube_along('nose', [(0, -0.255, 1.650), (0, -0.285, 1.605),
                        (0, -0.270, 1.585)],
               [0.018, 0.026, 0.020], MATS['skin'], bow, segs=10)
    tube_along('mouth', [(-0.052, -0.255, 1.548), (0, -0.268, 1.540),
                         (0.052, -0.255, 1.548)],
               [0.007, 0.009, 0.007], MATS['ink'], bow, segs=8)
    for sign in (-1, 1):
        uv_sphere('blush' + ('L' if sign < 0 else 'R'), 0.042, MATS['blush'], bow,
                  loc=(sign * 0.195, -0.238, 1.585),
                  scale=(1.0, 0.25, 0.55), segs=12, rings=8)

    # 脖子（补袍口到头的空隙）
    tube_along('neck', [(0, 0, 1.30), (0, -0.01, 1.40)],
               [0.115, 0.105], MATS['skin'], bow, segs=14)

    # ---- 袖臂：sleeveL/R 本身是可旋转 Group，内含一条连续曲面链 ----
    sleeves = []
    for sign, nm in [(-1, 'sleeveL'), (1, 'sleeveR')]:
        arm = empty(nm, bow, loc=(sign * 0.365, 0.0, 1.255))
        path = [(0, 0, 0.02),
                (sign * 0.045, -0.055, -0.10),
                (sign * 0.075, -0.135, -0.22),
                (sign * 0.065, -0.205, -0.31),
                (sign * 0.040, -0.235, -0.345)]
        radii = [0.135, 0.150, 0.175, 0.215, 0.205]
        tube_along('sleeveSurf' + nm[-1], path, radii, MATS['robeDark'], arm, segs=16)
        # 袖口内衬（布兜的一圈浅色滚边）
        tube_along('cuff' + nm[-1],
                   [(sign * 0.040, -0.235, -0.342), (sign * 0.038, -0.240, -0.350)],
                   [0.202, 0.190], MATS['sash'], arm, segs=16)
        sleeves.append(arm)

    # ---- 合十双掌：grpHands 里两片扁平掌相贴，家位已在袍外可见 ----
    hands = empty('grpHands', bow, loc=(0, -0.455, 1.075))
    for sign, nm in [(-1, 'palmL'), (1, 'palmR')]:
        uv_sphere(nm, 1.0, MATS['skin'], hands,
                  loc=(sign * 0.032, 0, 0),
                  scale=(0.030, 0.058, 0.118), segs=14, rings=10)
        uv_sphere('thumb' + nm[-1], 0.024, MATS['skin'], hands,
                  loc=(sign * 0.012, -0.030, -0.055),
                  scale=(1.0, 1.0, 1.7), segs=10, rings=8)
    # 掌间一串小念珠（合十时捧珠，沿用旧意象但不再是两颗大球）
    for i in range(5):
        a = (i / 4.0 - 0.5) * 1.5
        uv_sphere('beadClasp%02d' % i, 0.020, MATS['bead'], hands,
                  loc=(math.sin(a) * 0.055, -0.055, -0.02 + math.cos(a) * 0.012),
                  segs=8, rings=6)

    # 挂脖念珠：贴合领口的椭圆链，比 v1 的一圈等径球更有层级
    for i in range(14):
        a = TAU * i / 14
        uv_sphere('bead%02d' % i, 0.026 if i % 7 else 0.032, MATS['bead'], bow,
                  loc=(math.sin(a) * 0.30, -math.cos(a) * 0.25 - 0.01,
                       1.29 - abs(math.sin(a)) * 0.02),
                  segs=10, rings=8)
    uv_sphere('beadGuru', 0.040, MATS['goldtrim'], bow,
              loc=(0, -0.265, 1.04), scale=(1, 0.8, 1.3), segs=12, rings=10)

    # ---- 下身：鞋 / 膝（契约节点，代码里默认隐藏）/ 袍脚内衬 ----
    for sign, nm in [(-1, 'shoeL'), (1, 'shoeR')]:
        uv_sphere(nm, 0.16, MATS['ink'], lower,
                  loc=(sign * 0.19, -0.10, 0.065),
                  scale=(1.0, 1.55, 0.52), segs=14, rings=10)
    knees = []
    for sign, nm in [(-1, 'kneeL'), (1, 'kneeR')]:
        knees.append(uv_sphere(nm, 0.15, MATS['robe'], lower,
                               loc=(sign * 0.22, -0.20, 0.14),
                               scale=(1.0, 1.0, 0.85), segs=12, rings=10))
    loft_rings('hemLining', [((0, 0, 0.075), 0.585, 0.88, 0.045, 10),
                             ((0, 0, 0.025), 0.600, 0.88, 0.048, 10)],
               MATS['robeDark'], lower, segs=40, cap_bottom=False)

    return root


def main():
    root = build()
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=OUT_FILE, export_format='GLB', export_yup=True,
        use_selection=True, export_apply=False,
        export_morph=False, export_animations=False)
    print('[monk_v2] exported:', OUT_FILE, os.path.getsize(OUT_FILE), 'bytes')


main()
