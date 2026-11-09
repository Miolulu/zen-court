# -*- coding: utf-8 -*-
"""
静照院 · 全场景静态环境建模（court.glb）

Blender Z-up -> glTF Y-up 坐标约定：
    game (x, y_up, z_front)  <->  Blender (x, -z_front, y_up)
    即 G(x, y, z) = (x, -z, y)；export_yup=True 后回到 game 坐标。

只包含【静态环境】：
    地面铺装 / 御道 / 台基须弥座 / 月台石阶望柱 / 后墙侧墙 /
    前檐车削柱 / 斗拱 / 棂条格扇 / 额枋匾额框 /
    举折起翘屋面 + 筒瓦瓦垄 + 瓦当滴水 + 正脊垂脊鸱吻脊兽 /
    佛座须弥台 / 舟形背光 / 松树银杏 / 六角石灯 / 荷池石沿

【不含】拜垫、香炉、长明灯、猫、金蟾、大佛、水面 —— 它们是动态交互物，
由 game.js 保留在完全相同的坐标上，本模型不得侵占。

材质按语义命名（court* 前缀），游戏端 applyCourtMaterials() 统一接清雅色板。
同类几何按 (组, 材质) join 成单个 mesh，把 draw call 压到 ~30。

运行：
  blender-4.2.14-windows-x64/blender.exe --background --python gen_court.py
"""
import bpy, math, os, random

random.seed(20261109)

ROOT = os.path.dirname(os.path.abspath(__file__))
# 脚本既可能放在会话根 tools/，也可能随仓库放在 zen-court/blender/；两处都能正确输出
_SIBLING = os.path.join(ROOT, '..', 'zen-court', 'assets', 'models')
OUT = _SIBLING if os.path.isdir(os.path.join(ROOT, '..', 'zen-court', 'assets')) \
      else os.path.join(ROOT, '..', 'assets', 'models')
PREV = os.path.join(ROOT, 'previews')
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREV, exist_ok=True)


# ---------------------------------------------------------------- 基础工具
def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m, do_unlink=True)


def srgb(h):
    v = [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v)


def mat(name, hexcolor, rough=0.86, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    n = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value = (*srgb(hexcolor), 1.0)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Metallic'].default_value = metal
    return m


def G(x, y, z):
    """game 坐标 -> Blender 坐标"""
    return (x, -z, y)


GROUPS = {}


def _reg(ob, group, material):
    key = (group, material.name if material else '_')
    GROUPS.setdefault(key, []).append(ob)
    return ob


def box(name, size, loc, material, group='misc', rot=None):
    """size / loc 都是 Blender 坐标；size=(sx, sy, sz)"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    if rot:
        ob.rotation_euler = rot
    if material:
        ob.data.materials.append(material)
    return _reg(ob, group, material)


def cyl(name, r, h, loc, material, group='misc', verts=12, rot=None, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=loc, rotation=rot or (0, 0, 0))
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, vertices=verts, location=loc, rotation=rot or (0, 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    if material:
        ob.data.materials.append(material)
    return _reg(ob, group, material)


def mesh(name, verts, faces, material, group='misc', smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material:
        me.materials.append(material)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return _reg(ob, group, material)


def revolve(name, profile, loc, material, group='misc', segs=16, smooth=True):
    """回转体，profile=[(r, bz), ...]，绕 Blender Z 轴；loc 为 Blender 坐标"""
    vs, fs = [], []
    for (r, bz) in profile:
        for i in range(segs):
            a = 2 * math.pi * i / segs
            vs.append((max(r, 0.002) * math.cos(a), max(r, 0.002) * math.sin(a), bz))
    for j in range(len(profile) - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            fs.append((j * segs + i, j * segs + i2, (j + 1) * segs + i2, (j + 1) * segs + i))
    ob = mesh(name, vs, fs, material, group, smooth)
    ob.location = loc
    return ob


def icosphere(name, r, loc, material, group='misc', sub=0, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    if material:
        ob.data.materials.append(material)
    return _reg(ob, group, material)


def join_groups():
    # 关键：join 前把 location / rotation / scale 全部烘进顶点。
    # 否则 Blender 会把其他对象的顶点换算到 active 的局部空间（除以 active.scale），
    # 导出后 accessor 里出现几百单位的病态坐标，靠 node.scale 反向补偿才能看对，
    # Three.js 的法线矩阵与包围球都会因此失真。
    all_objs = [o for objs in GROUPS.values() for o in objs if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in all_objs:
        o.select_set(True)
    if all_objs:
        bpy.context.view_layer.objects.active = all_objs[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')

    out = []
    for (group, mname), objs in GROUPS.items():
        if len(objs) < 2:
            ob = objs[0]
            ob.name = group + '__' + mname
            out.append(ob)
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = group + '__' + mname
        out.append(joined)
    return out


# ---------------------------------------------------------------- 色板
M = {}
def build_materials():
    # 三档石色刻意收得很近：远看是一整片宣纸灰石板，不是棋盘格瓷砖
    M['stone']      = mat('courtStone',      0xC6C1B3, 0.95)
    M['stoneDark']  = mat('courtStoneDark',  0xB7B2A5, 0.94)
    M['stoneLight'] = mat('courtStoneLight', 0xCEC9BB, 0.93)
    M['moss']       = mat('courtMoss',       0xA9AE9B, 0.98)
    M['wood']       = mat('courtWood',       0x96574C, 0.84)
    M['woodDark']   = mat('courtWoodDark',   0x6B443C, 0.86)
    M['woodLight']  = mat('courtWoodLight',  0xAE7D6C, 0.84)
    M['tile']       = mat('courtTile',       0x3C4541, 0.80)
    M['tileLight']  = mat('courtTileLight',  0x51605A, 0.82)
    M['gold']       = mat('courtGold',       0xB49A68, 0.55, 0.32)
    M['goldDark']   = mat('courtGoldDark',   0x8C7448, 0.62, 0.22)
    M['plaster']    = mat('courtPlaster',    0xBEAE98, 0.94)
    M['pine']       = mat('courtPine',       0x4A5C4E, 0.92)
    M['pineLight']  = mat('courtPineLight',  0x66795F, 0.92)
    M['pineDark']   = mat('courtPineDark',   0x39483D, 0.92)
    M['trunk']      = mat('courtTrunk',      0x5A4638, 0.94)
    M['ginkgo']     = mat('courtGinkgo',     0xB49A68, 0.92)
    M['ginkgoLt']   = mat('courtGinkgoLt',   0xC9B27E, 0.92)


# ---------------------------------------------------------------- 1. 地面铺装
def paving():
    """院落石板分块。上千块石板用【批量网格】一次生成，不逐块调用 bpy.ops（否则导出要几分钟）。"""
    stone3 = [M['stone'], M['stoneLight'], M['stoneDark']]
    # 铺到雾里，边界不落在画面内
    x0, x1, z0, z1 = -34.0, 34.0, -30.0, 30.0

    def blocked(x, z):
        if -13.1 < x < 13.1 and -15.9 < z < -4.7:
            return True
        if x * x + (z - 7.0) ** 2 < 3.1 ** 2:
            return True
        return False

    buckets = {}

    def slab(cx, cz, w, d, top, material):
        key = material.name
        if key not in buckets:
            buckets[key] = ([], [], material)
        vs, fs, _ = buckets[key]
        h, b = 0.055, len(vs)
        xa, xb = cx - w / 2, cx + w / 2
        ya, yb = -cz - d / 2, -cz + d / 2
        z0_, z1_ = top - h, top
        vs.extend([(xa, ya, z0_), (xb, ya, z0_), (xb, yb, z0_), (xa, yb, z0_),
                   (xa, ya, z1_), (xb, ya, z1_), (xb, yb, z1_), (xa, yb, z1_)])
        fs.extend([(b, b + 3, b + 2, b + 1), (b + 4, b + 5, b + 6, b + 7),
                   (b, b + 1, b + 5, b + 4), (b + 1, b + 2, b + 6, b + 5),
                   (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)])

    z = z0
    row = 0
    while z < z1:
        dz = 1.75 + random.random() * 0.5
        x = x0 + (0.4 if row % 2 else 0.0)
        while x < x1:
            dx = 1.75 + random.random() * 0.55
            cx, cz = x + dx * 0.5, z + dz * 0.5
            if not blocked(cx, cz):
                m = stone3[(row + int(x * 3)) % 3] if random.random() > 0.02 else M['moss']
                slab(cx, cz, dx - 0.05, dz - 0.05, 0.012 + random.uniform(-0.004, 0.005), m)
            x += dx
        z += dz
        row += 1

    for key, (vs, fs, material) in buckets.items():
        mesh('pavingSlab', vs, fs, material, 'paving')

    # 中轴御道：从月台阶下一直铺到院南，两侧镶边
    z = -4.4
    i = 0
    while z < 16.5:
        d = 1.25
        # 御道必须绕开荷池：否则石板铺到水面下，半透明池水会透出一个方形线框
        if not blocked(0, z + d * 0.5):
            box('dao', (3.5, d - 0.06, 0.062), G(0, 0.014, z + d * 0.5),
                M['stoneLight'] if i % 3 else M['stone'], 'paving_dao')
            for s in (-1, 1):
                box('daoEdge', (0.14, d - 0.05, 0.075), G(s * 1.86, 0.02, z + d * 0.5), M['stoneDark'], 'paving_dao')
        z += d
        i += 1


# ---------------------------------------------------------------- 2. 台基 / 月台 / 石阶 / 望柱
def platform():
    """须弥座式台基：下枋 / 下枭 / 束腰 / 上枭 / 上枋，束腰带间柱与壶门。"""
    # 主台基 game z 中心 -11.5，进深 7.8，宽 25.4，高 0.7
    cz = -11.5
    layers = [
        (0.00, 0.13, 25.6, 8.0, M['stoneDark']),
        (0.13, 0.09, 25.3, 7.9, M['stone']),
        (0.22, 0.10, 25.0, 7.8, M['stoneLight']),
        (0.32, 0.22, 24.7, 7.65, M['stone']),      # 束腰
        (0.54, 0.09, 25.0, 7.8, M['stoneLight']),
        (0.63, 0.10, 25.3, 7.9, M['stone']),
        (0.73, 0.08, 25.6, 8.0, M['stoneLight']),   # 上枋压顶
    ]
    for (y0, h, w, d, m) in layers:
        box('plinth', (w, d, h), G(0, y0 + h * 0.5, cz), m, 'platform')

    # 束腰间柱：前后两面各一排短柱 + 壶门凹板
    for s in (-1, 1):
        zz = cz + s * 3.83
        for i in range(13):
            xx = -11.9 + i * 1.98
            box('waistPost', (0.16, 0.10, 0.22), G(xx, 0.43, zz), M['stoneDark'], 'platform_trim')
            box('humen', (1.55, 0.035, 0.15), G(xx + 0.99, 0.43, zz + (-0.05 if s > 0 else 0.05)),
                M['stoneDark'], 'platform_trim')

    # 月台：game z -6.8，进深 3.6，高 0.16
    tz = -6.8
    for (y0, h, w, d, m) in [
        (0.00, 0.055, 25.6, 3.75, M['stoneDark']),
        (0.055, 0.075, 25.4, 3.65, M['stone']),
        (0.13, 0.035, 25.5, 3.70, M['stoneLight']),
    ]:
        box('terrace', (w, d, h), G(0, y0 + h * 0.5, tz), m, 'platform')

    # 中轴石阶 3 级：与原 game 坐标一致（TERRACE_FRONT=-5.0）
    for i in range(3):
        zz = -5.0 + 0.16 + i * 0.33
        yy = 0.16 - 0.045 - i * 0.05
        box('step', (2.5, 0.34, 0.09), G(0, yy, zz), M['stoneLight'], 'platform_step')
        box('stepNose', (2.6, 0.06, 0.10), G(0, yy + 0.02, zz + 0.16), M['stoneDark'], 'platform_step')
    # 台阶两侧垂带
    for s in (-1, 1):
        box('stepCheek', (0.22, 1.15, 0.16), G(s * 1.42, 0.02, -4.5), M['stone'], 'platform_step')

    # 月台前沿压边（拜垫区界线），中轴留出台阶口
    for s in (-1, 1):
        box('edge', (9.4, 0.30, 0.20), G(s * 7.6, 0.09, -4.88), M['stoneDark'], 'platform_edge')

    # 望柱栏板：台基东西两端
    for s in (-1, 1):
        xx = s * 12.35
        for i in range(4):
            zz = -8.5 + i * 1.3
            # 柱础 / 柱身 / 柱头（带束腰与宝珠）
            cyl('balBase', 0.19, 0.10, G(xx, 0.86, zz), M['stoneDark'], 'balustrade', verts=8)
            cyl('balPost', 0.115, 0.62, G(xx, 1.22, zz), M['stone'], 'balustrade', verts=8, r2=0.10)
            cyl('balCap', 0.17, 0.08, G(xx, 1.57, zz), M['stoneLight'], 'balustrade', verts=8)
            icosphere('balOrb', 0.085, G(xx, 1.66, zz), M['stoneLight'], 'balustrade', sub=0)
            if i < 3:
                box('railTop', (0.10, 1.30, 0.10), G(xx, 1.44, zz + 0.65), M['stoneLight'], 'balustrade')
                box('railMid', (0.07, 1.30, 0.075), G(xx, 1.10, zz + 0.65), M['stone'], 'balustrade')
                box('railPanel', (0.055, 1.18, 0.30), G(xx, 1.27, zz + 0.65), M['stoneDark'], 'balustrade')


# ---------------------------------------------------------------- 3. 墙体 / 佛座 / 背光
def walls_and_altar():
    # 后墙 + 壁柱 + 墙裙 + 上枋
    box('backWall', (24.6, 0.62, 6.6), G(0, 3.9, -14.6), M['plaster'], 'walls')
    box('backSkirt', (24.8, 0.72, 0.95), G(0, 1.16, -14.35), M['stoneDark'], 'walls_trim')
    box('backHead', (25.0, 0.74, 0.34), G(0, 7.05, -14.2), M['woodDark'], 'walls_trim')
    for i in range(9):
        xx = -12.0 + i * 3.0
        box('wallPilaster', (0.30, 0.18, 5.6), G(xx, 3.9, -14.22), M['woodDark'], 'walls_trim')
        box('wallCap', (0.44, 0.24, 0.16), G(xx, 6.75, -14.22), M['goldDark'], 'walls_trim')
    # 侧墙
    for s in (-1, 1):
        box('sideWall', (0.62, 7.4, 6.6), G(s * 12.1, 3.9, -11.5), M['plaster'], 'walls')
        box('sideSkirt', (0.72, 7.5, 0.95), G(s * 12.1, 1.16, -11.5), M['stoneDark'], 'walls_trim')
        box('sideHead', (0.74, 7.5, 0.34), G(s * 12.1, 7.05, -11.5), M['woodDark'], 'walls_trim')

    # 佛座须弥台：game (0, ?, -11.4)，宽 6.4 深 2.5，高 1.15
    az = -11.4
    # 顶面严格对齐原 altarEdge 的 y=1.14，否则会把 buddha.glb 的莲台与坐佛下半截埋进去
    for (y0, h, w, d, m) in [
        (0.35, 0.10, 6.9, 2.9, M['stoneDark']),
        (0.45, 0.08, 6.7, 2.8, M['goldDark']),
        (0.53, 0.42, 6.4, 2.5, M['woodDark']),
        (0.95, 0.09, 6.6, 2.65, M['gold']),
        (1.04, 0.10, 6.9, 2.9, M['wood']),
    ]:
        box('altar', (w, d, h), G(0, y0 + h * 0.5, az), m, 'altar')
    # 束腰壶门与间柱
    for i in range(6):
        xx = -2.55 + i * 1.02
        box('altarPost', (0.075, 0.06, 0.40), G(xx, 0.74, az - 1.27), M['gold'], 'altar_trim')
        box('altarHumen', (0.80, 0.03, 0.24), G(xx + 0.51, 0.74, az - 1.285), M['goldDark'], 'altar_trim')
    # 台面仰覆莲瓣一圈
    for i in range(30):
        a = 2 * math.pi * i / 30
        px, pz = math.cos(a) * 3.36, az + math.sin(a) * 1.42
        icosphere('lotusPetal', 0.16, G(px, 1.12, pz), M['gold'], 'altar_trim', sub=0, scale=(1.0, 0.55, 0.5))

    # 舟形背光：佛龛外圈一道金色镂空轮廓（不遮中心壁画）
    hx, hy0, hy1 = 3.05, 1.6, 7.6
    for s in (-1, 1):
        pts = []
        for k in range(11):
            t = k / 10
            yy = hy0 + (hy1 - hy0) * t
            xx = s * (hx * (0.62 + 0.38 * math.sin(math.pi * (0.15 + 0.78 * t))))
            pts.append((xx, yy))
        for k in range(len(pts) - 1):
            (x1, y1), (x2, y2) = pts[k], pts[k + 1]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            ln = math.hypot(x2 - x1, y2 - y1)
            ang = math.atan2(y2 - y1, x2 - x1)
            box('haloArc', (ln + 0.02, 0.075, 0.12), G(cx, cy, -13.72), M['goldDark'], 'halo',
                rot=(0, 0, ang))
    for k in range(9):
        a = math.pi * (0.12 + 0.76 * k / 8)
        px, py = 2.92 * math.cos(a), hy0 + (hy1 - hy0) * 0.5 + 2.9 * math.sin(a)
        icosphere('haloFlame', 0.13, G(px, py, -13.72), M['gold'], 'halo', sub=0, scale=(0.7, 1.5, 0.6))


# ---------------------------------------------------------------- 4. 柱 / 斗拱 / 格扇 / 额枋
COL_X = [-11.0, -8.25, -5.5, -2.75, 2.75, 5.5, 8.25, 11.0]
COL_Z = -8.0


def columns_and_brackets():
    # 车削柱：覆盆柱础 + 收分柱身 + 卷杀柱头
    prof = [
        (0.50, 0.78), (0.49, 0.83), (0.42, 0.91), (0.365, 0.97),
        (0.335, 1.02), (0.325, 2.0), (0.312, 3.4), (0.300, 4.8),
        (0.292, 6.0), (0.288, 6.45), (0.300, 6.62), (0.335, 6.72),
    ]
    for x in COL_X:
        revolve('column', prof, G(x, 0, COL_Z), M['wood'], 'columns', segs=18)
        # 柱础方座与柱头栌斗
        cyl('colBase', 0.56, 0.10, G(x, 0.82, COL_Z), M['stoneDark'], 'columns_trim', verts=8)
        box('ludou', (0.86, 0.86, 0.24), G(x, 6.84, COL_Z), M['woodDark'], 'brackets')
        box('ludouLip', (0.96, 0.96, 0.06), G(x, 6.99, COL_Z), M['woodLight'], 'brackets')

    # 斗拱：柱头铺作 + 补间铺作
    dougong_x = COL_X + [-9.625, -6.875, -4.125, -1.375, 1.375, 4.125, 6.875, 9.625]
    for x in dougong_x:
        z = COL_Z
        # 第一跳华拱（沿进深，即 game z / Blender y）
        box('huagong1', (0.26, 1.9, 0.17), G(x, 7.10, z), M['woodDark'], 'brackets')
        for s in (-1, 1):
            box('sandou1', (0.30, 0.30, 0.13), G(x, 7.22, z + s * 0.78), M['woodLight'], 'brackets')
        # 瓜子拱（沿面阔 x）
        box('guazigong', (1.55, 0.24, 0.16), G(x, 7.30, z), M['wood'], 'brackets')
        for s in (-1, 1):
            box('sandou2', (0.28, 0.28, 0.12), G(x + s * 0.66, 7.41, z), M['woodLight'], 'brackets')
        # 第二跳 + 令拱
        box('huagong2', (0.22, 2.5, 0.14), G(x, 7.48, z - 0.18), M['woodDark'], 'brackets')
        box('linggong', (1.95, 0.22, 0.14), G(x, 7.56, z), M['wood'], 'brackets')
        for s in (-1, 1):
            box('sandou3', (0.26, 0.26, 0.11), G(x + s * 0.85, 7.67, z), M['woodLight'], 'brackets')
        # 昂与耍头只给柱头铺作，补间铺作从简：檐口才不会变成一排红色锯齿
        if x in COL_X:
            box('ang', (0.18, 0.95, 0.13), G(x, 7.52, z - 0.92), M['woodLight'], 'brackets',
                rot=(math.radians(14), 0, 0))
            box('shuato', (0.22, 0.38, 0.14), G(x, 7.55, z - 1.52), M['woodDark'], 'brackets')

    # 檐下椽子 + 飞椽（沿进深方向铺，从额枋到檐口）
    for i in range(56):
        xx = -13.2 + i * 0.48
        box('rafter', (0.075, 3.1, 0.085), G(xx, 7.02, -9.6), M['woodDark'], 'rafters')
        box('flyRafter', (0.065, 1.35, 0.07), G(xx, 6.90, -7.65), M['wood'], 'rafters',
            rot=(math.radians(-7), 0, 0))

    # 额枋（通长）+ 平板枋 + 柱间雀替
    box('lintel', (25.6, 0.42, 0.56), G(0, 6.42, COL_Z), M['woodDark'], 'lintel')
    box('lintelLip', (25.8, 0.48, 0.10), G(0, 6.68, COL_Z), M['goldDark'], 'lintel')
    box('pingbanfang', (26.0, 0.50, 0.18), G(0, 6.80, COL_Z), M['wood'], 'lintel')
    for i in range(len(COL_X) - 1):
        cx = (COL_X[i] + COL_X[i + 1]) / 2
        for s in (-1, 1):
            box('queti', (0.62, 0.09, 0.34), G(cx + s * 1.12, 6.10, COL_Z - 0.02), M['woodDark'], 'lintel',
                rot=(0, 0, math.radians(-18 * s)))

    # 棂条格扇：8 格，中轴 2 格留空保证大佛可见
    for i in range(8):
        if i in (3, 4):
            continue
        px = -9.6 + i * 2.75
        zz = -8.10
        w, h = 2.30, 4.35
        y0 = 1.05
        # 外框
        for s in (-1, 1):
            box('geFrameV', (0.11, 0.11, h), G(px + s * w / 2, y0 + h / 2, zz), M['woodDark'], 'lattice')
        for s in (0, 1):
            box('geFrameH', (w, 0.11, 0.11), G(px, y0 + s * h, zz), M['woodDark'], 'lattice')
        box('geMid', (w, 0.11, 0.09), G(px, y0 + 1.55, zz), M['woodDark'], 'lattice')
        # 格心：横竖棂条 + 斜菱
        gy0, gy1 = y0 + 1.62, y0 + h - 0.10
        # 棂条刻意疏：殿内大佛与壁画要透得出来，不能糊成铁栅栏
        for k in range(1, 5):
            box('geBarV', (0.042, 0.05, gy1 - gy0), G(px - w / 2 + k * w / 5, (gy0 + gy1) / 2, zz),
                M['wood'], 'lattice')
        for k in range(1, 4):
            box('geBarH', (w, 0.05, 0.042), G(px, gy0 + k * (gy1 - gy0) / 4, zz), M['wood'], 'lattice')
        box('geDiamond', (0.055, 0.05, 0.56), G(px, (gy0 + gy1) / 2, zz), M['woodLight'], 'lattice',
            rot=(0, math.radians(36), 0))
        # 裙板 + 雕纹
        box('geSkirt', (w - 0.16, 0.075, 1.42), G(px, y0 + 0.76, zz), M['wood'], 'lattice')
        for s in (-1, 1):
            box('geCarve', (0.72, 0.085, 0.05), G(px + s * 0.55, y0 + 0.76, zz - 0.055),
                M['goldDark'], 'lattice', rot=(0, 0, math.radians(-24 * s)))

    # 匾额木框（文字由 game.js plaqueTexture() 贴在最前面，此处只做框）
    # 三层木框的前表面必须停在 z=-7.62 之前：game.js 的「静 照 院」文字平面在 z=-7.59
    box('plaqueFrame', (5.9, 0.22, 1.90), G(0, 6.42, -7.80), M['woodDark'], 'plaque')
    box('plaqueGold', (5.6, 0.10, 1.62), G(0, 6.42, -7.72), M['gold'], 'plaque')
    box('plaqueInner', (5.4, 0.08, 1.48), G(0, 6.42, -7.66), M['woodDark'], 'plaque')
    for s in (-1, 1):
        for t in (-1, 1):
            icosphere('plaqueStud', 0.075, G(s * 2.72, 6.42 + t * 0.74, -7.58), M['gold'], 'plaque', sub=0)


# ---------------------------------------------------------------- 5. 举折起翘屋面
RIDGE_Z = -11.8
EAVE_FZ, EAVE_BZ = -7.0, -16.6
Y_EAVE, Y_RIDGE = 7.16, 8.62
ROOF_HALF_X = 13.9


def roof_y(x, z):
    """举折曲面：脊部陡、檐部缓（f=t^1.55），四角起翘。"""
    half = max(RIDGE_Z - EAVE_BZ, EAVE_FZ - RIDGE_Z)
    t = 1.0 - min(1.0, abs(z - RIDGE_Z) / half)
    y = Y_EAVE + (Y_RIDGE - Y_EAVE) * (t ** 1.55)
    # 翼角起翘：靠两山、靠檐口处抬升
    ax = abs(x)
    if ax > 8.6 and t < 0.55:
        k = (ax - 8.6) / (ROOF_HALF_X - 8.6)
        kt = (0.55 - t) / 0.55
        y += 0.62 * (k ** 2) * (kt ** 1.6)
    return y


def roof():
    NX, NZ = 30, 26
    zs = [EAVE_BZ + (EAVE_FZ - EAVE_BZ) * j / (NZ - 1) for j in range(NZ)]
    xs = [-ROOF_HALF_X + 2 * ROOF_HALF_X * i / (NX - 1) for i in range(NX)]
    # 屋面基底（板瓦层）
    vs = [(x, -z, roof_y(x, z)) for z in zs for x in xs]
    fs = []
    for j in range(NZ - 1):
        for i in range(NX - 1):
            a = j * NX + i
            fs.append((a, a + 1, a + NX + 1, a + NX))
    mesh('roofDeck', vs, fs, M['tile'], 'roof_deck')

    # 板瓦：沿 x 每垄之间的浅槽（用细长曲面条表现），与筒瓦交错
    # 筒瓦：沿 z 方向的半圆拱条，截面在 x-y 平面
    NR = 51
    SEG = 7
    for k in range(NR):
        x0 = -13.4 + k * (26.8 / (NR - 1))
        rows, faces = [], []
        for z in zs:
            y = roof_y(x0, z) + 0.035
            for a in range(SEG + 1):
                ang = math.pi * a / SEG
                rows.append((x0 + 0.135 * math.cos(ang), -z, y + 0.135 * math.sin(ang)))
        W = SEG + 1
        for j in range(NZ - 1):
            for a in range(SEG):
                p = j * W + a
                faces.append((p, p + 1, p + W + 1, p + W))
        mesh('tileRoll', rows, faces, M['tileLight'] if k % 3 == 0 else M['tile'], 'roof_tiles')

        # 檐口瓦当（前后两端）：圆盘 + 中心乳钉
        for zz in (EAVE_FZ + 0.03, EAVE_BZ - 0.03):
            yy = roof_y(x0, zz) + 0.10
            cyl('wadang', 0.145, 0.055, G(x0, yy, zz), M['goldDark'], 'roof_wadang',
                verts=10, rot=(math.radians(90), 0, 0))
            icosphere('wadangNail', 0.052, G(x0, yy, zz + (0.04 if zz > -12 else -0.04)),
                      M['gold'], 'roof_wadang', sub=0, scale=(1, 1, 0.45))

    # 滴水：檐口两垄之间一枚如意形小板
    for k in range(NR - 1):
        x0 = -13.4 + (k + 0.5) * (26.8 / (NR - 1))
        for zz in (EAVE_FZ - 0.05, EAVE_BZ + 0.05):
            yy = roof_y(x0, zz) - 0.04
            v = [(x0 - 0.115, -zz, yy + 0.02), (x0 + 0.115, -zz, yy + 0.02),
                 (x0 + 0.075, -zz, yy - 0.14), (x0, -zz, yy - 0.20), (x0 - 0.075, -zz, yy - 0.14)]
            mesh('dishui', v, [(0, 1, 2, 3, 4)], M['tileLight'], 'roof_wadang')

    # 正脊：脊筒 + 上盖 + 脊刹宝珠；两端鸱吻
    box('ridgeBase', (27.2, 0.46, 0.28), G(0, Y_RIDGE + 0.04, RIDGE_Z), M['tile'], 'roof_ridge')
    box('ridgeCap', (27.4, 0.56, 0.14), G(0, Y_RIDGE + 0.22, RIDGE_Z), M['tileLight'], 'roof_ridge')
    for i in range(27):
        xx = -13.0 + i * 1.0
        box('ridgeJoint', (0.08, 0.60, 0.30), G(xx, Y_RIDGE + 0.13, RIDGE_Z), M['goldDark'], 'roof_ridge')
    revolve('ridgeOrb', [(0.02, 0), (0.28, 0.10), (0.34, 0.28), (0.22, 0.52), (0.03, 0.68)],
            G(0, Y_RIDGE + 0.30, RIDGE_Z), M['gold'], 'roof_ridge', segs=12)
    for s in (-1, 1):
        # 鸱吻：张口吞脊的鱼龙轮廓，用层叠块 + 背鳍构成
        xx = s * 13.5
        for k in range(6):
            t = k / 5
            box('chiwen', (0.52 - t * 0.16, 0.42 - t * 0.10, 0.34),
                G(xx + s * t * 0.16, Y_RIDGE + 0.10 + t * 0.92, RIDGE_Z), M['tileLight'], 'roof_chiwen',
                rot=(0, math.radians(s * 12 * t), 0))
        for k in range(4):
            box('chiFin', (0.10, 0.30 - k * 0.04, 0.28),
                G(xx - s * 0.28, Y_RIDGE + 0.30 + k * 0.24, RIDGE_Z), M['tile'], 'roof_chiwen',
                rot=(0, math.radians(-s * 28), 0))
        icosphere('chiEye', 0.075, G(xx + s * 0.20, Y_RIDGE + 0.62, RIDGE_Z - 0.20),
                  M['gold'], 'roof_chiwen', sub=0)

    # 垂脊 / 戗脊：从正脊两端沿屋面下到四角，带小脊兽
    for sx in (-1, 1):
        for ez in (EAVE_FZ, EAVE_BZ):
            for j in range(11):
                t = j / 10
                xx = sx * (13.35 - 0.0 * t)
                zz = RIDGE_Z + (ez - RIDGE_Z) * t
                yy = roof_y(xx, zz) + 0.16
                box('diagonalRidge', (0.30, 0.44, 0.20), G(xx, yy, zz),
                    M['tileLight'], 'roof_ridge')
                if 2 <= j <= 6 and j % 2 == 0:
                    icosphere('ridgeBeast', 0.16, G(xx, yy + 0.20, zz),
                              M['stoneDark'], 'roof_chiwen', sub=0, scale=(0.8, 0.8, 1.3))

    # 两山博风板与悬鱼
    for s in (-1, 1):
        box('bofeng', (0.16, 9.8, 0.30), G(s * 13.85, 7.55, -11.8), M['woodDark'], 'roof_gable',
            rot=(math.radians(-8), 0, 0))
        box('xuanyu', (0.12, 0.42, 0.72), G(s * 13.85, 6.85, -7.55), M['goldDark'], 'roof_gable')


# ---------------------------------------------------------------- 6. 松树 / 银杏
PINE_SPOTS = [
    (-15, -12, 1.25), (-16.5, -3, 1.0), (-15, 6, 1.15), (-17, 14, 1.35),
    (15.5, -12, 1.3), (16.5, -2, 1.05), (18.2, 11.2, 1.2), (17.5, 16, 1.4),
    (-8, -19, 1.1), (0, -20, 1.25), (8, -19, 1.1), (-19, 1, 1.2), (19, 3, 1.15),
    (-13, 12.5, 1.0), (14.6, -6.4, 0.95), (-11.3, 1.4, 1.0), (10.4, -3.6, 0.95), (10.4, 1.2, 1.0)
]
GINKGO_SPOTS = [(-14.3, 9.6, 1.05), (16.8, 13.4, 1.0), (-11.4, 10.2, 0.85)]


def leaf_pad(name, cx, cy, cz, rx, rz, thickness, material, group, tilt=0.0):
    """写意块叶：中心略高的八边形棱面盘，替代圆滚滚的西兰花球。"""
    n = 8
    top = []
    for i in range(n):
        a = 2 * math.pi * i / n
        top.append((cx + rx * math.cos(a), -cz + rz * math.sin(a), cy + thickness * 0.35 * math.sin(a * 2 + tilt)))
    v = [(cx, -cz, cy + thickness)] + top + [(cx, -cz, cy - thickness * 0.55)]
    f = []
    for i in range(n):
        f.append((0, 1 + i, 1 + (i + 1) % n))
        f.append((n + 1, 1 + (i + 1) % n, 1 + i))
    return mesh(name, v, f, material, group)


def tree(px, pz, sc, ginkgo=False):
    H = 4.7 * sc
    # 分叉主干：三段渐细、略斜，带 1~2 条侧枝
    segs = [(0.0, 0.30, 0.0, 0.0), (H * 0.28, 0.25, 0.16 * sc, 0.10 * sc),
            (H * 0.60, 0.19, -0.10 * sc, 0.22 * sc), (H * 0.88, 0.12, -0.20 * sc, 0.30 * sc)]
    for i in range(len(segs) - 1):
        (y0, r0, dx0, dz0), (y1, r1, dx1, dz1) = segs[i], segs[i + 1]
        cyl('trunk', r0, (y1 - y0) * 1.06, G(px + (dx0 + dx1) / 2, (y0 + y1) / 2, pz + (dz0 + dz1) / 2),
            M['trunk'], 'trees_trunk', verts=7, r2=r1,
            rot=(math.atan2(dz1 - dz0, y1 - y0), -math.atan2(dx1 - dx0, y1 - y0), 0))
    # 侧枝
    for s in (-1, 1):
        by = H * (0.42 if s > 0 else 0.60)
        bx, bz = px + s * 0.95 * sc, pz + (0.28 if s > 0 else -0.22) * sc
        cyl('branch', 0.085 * sc, 1.55 * sc,
            G(px + s * 0.47 * sc, by + 0.16 * sc, pz + 0.10 * sc), M['trunk'], 'trees_trunk',
            verts=6, r2=0.05 * sc, rot=(math.radians(12), 0, math.radians(s * 62)))
        # 枝端一簇叶
        for k in range(2):
            m = M['ginkgo'] if ginkgo else (M['pine'] if k % 2 else M['pineDark'])
            leaf_pad('leafPad', bx, by + 0.62 * sc + k * 0.22 * sc, bz,
                     0.82 * sc, 0.72 * sc, 0.20 * sc, m,
                     'trees_ginkgo' if ginkgo else 'trees_foliage', tilt=k)
    # 层叠伞状树冠
    levels = [(H * 0.52, 1.55, 5), (H * 0.70, 1.30, 5), (H * 0.85, 0.98, 4), (H * 0.97, 0.60, 3)]
    for li, (yy, rr, cnt) in enumerate(levels):
        for k in range(cnt):
            a = 2 * math.pi * k / cnt + li * 0.42 + px * 0.13
            rad = rr * sc * (0.42 + 0.30 * (k % 2))
            cx = px + math.cos(a) * rad
            cz = pz + math.sin(a) * rad * 0.85
            if ginkgo:
                m = M['ginkgo'] if (k + li) % 3 else M['ginkgoLt']
            else:
                m = [M['pine'], M['pineLight'], M['pineDark']][(k + li) % 3]
            leaf_pad('leafPad', cx, yy + (k % 2) * 0.10 * sc, cz,
                     (0.92 - li * 0.10) * sc, (0.80 - li * 0.08) * sc, 0.17 * sc, m,
                     'trees_ginkgo' if ginkgo else 'trees_foliage', tilt=k * 0.7)
    # 顶端收尖
    m = M['ginkgoLt'] if ginkgo else M['pineLight']
    leaf_pad('leafPad', px - 0.20 * sc, H * 1.06, pz + 0.30 * sc,
             0.48 * sc, 0.42 * sc, 0.14 * sc, m,
             'trees_ginkgo' if ginkgo else 'trees_foliage')


# ---------------------------------------------------------------- 7. 石灯笼 / 荷池石沿
def stone_lantern(px, pz):
    z = pz
    # 六角基座 -> 束腰竿 -> 中台 -> 火袋 -> 六角笠 -> 宝珠
    cyl('slBase', 0.56, 0.16, G(px, 0.08, z), M['stoneDark'], 'lantern', verts=6, r2=0.50)
    cyl('slBase2', 0.46, 0.10, G(px, 0.20, z), M['stone'], 'lantern', verts=6, r2=0.40)
    revolve('slPole', [(0.17, 0), (0.135, 0.12), (0.13, 0.72), (0.17, 0.88)],
            G(px, 0.25, z), M['stone'], 'lantern', segs=8)
    cyl('slMid', 0.36, 0.11, G(px, 1.20, z), M['stoneLight'], 'lantern', verts=6, r2=0.28)
    # 火袋：六根角柱 + 上环，中间留空透出暖光（game.js 的 fire mesh 独立）
    for k in range(6):
        a = 2 * math.pi * k / 6
        cyl('slFirePost', 0.055, 0.52, G(px + math.sin(a) * 0.30, 1.52, z + math.cos(a) * 0.30),
            M['stone'], 'lantern', verts=5)
    cyl('slFireRingTop', 0.36, 0.07, G(px, 1.80, z), M['stoneLight'], 'lantern', verts=6, r2=0.32)
    cyl('slFireRingBot', 0.36, 0.07, G(px, 1.25, z), M['stoneLight'], 'lantern', verts=6, r2=0.32)
    # 六角笠 + 六角起翘檐角
    cyl('slRoof', 0.16, 0.32, G(px, 2.00, z), M['stoneDark'], 'lantern', verts=6, r2=0.62)
    for k in range(6):
        a = 2 * math.pi * k / 6
        icosphere('slTip', 0.085, G(px + math.sin(a) * 0.60, 2.10, z + math.cos(a) * 0.60),
                  M['stoneLight'], 'lantern', sub=0, scale=(1, 1, 1.5))
    revolve('slOrb', [(0.02, 0), (0.10, 0.05), (0.11, 0.16), (0.02, 0.25)],
            G(px, 2.18, z), M['gold'], 'lantern', segs=10)


def pond_rim():
    cx, cz, r = 0.0, 7.0, 2.35
    n = 26
    for i in range(n):
        a = 2 * math.pi * i / n
        px, pz = cx + math.cos(a) * (r + 0.11), cz + math.sin(a) * (r + 0.11)
        h = 0.15 + random.uniform(-0.012, 0.016)
        m = [M['stone'], M['stoneLight'], M['stone']][i % 3]
        # 长边沿【切向】：不加 90° 会让每块石头长边朝径向，形成一圈放射状碎块
        box('pondStone', (0.60, 0.36, h), G(px, h * 0.5 - 0.005, pz), m, 'pond_rim',
            rot=(0, 0, -a + math.pi / 2))
    # 外圈改成一条连续压边环，而不是第二圈碎块
    revolve('pondLip',
            [(r + 0.28, 0.0), (r + 0.35, 0.012), (r + 0.35, 0.075), (r + 0.28, 0.09)],
            G(cx, 0, cz), M['stoneDark'], 'pond_rim', segs=48)


# ---------------------------------------------------------------- 主流程
def main():
    clear()
    build_materials()

    paving()
    platform()
    walls_and_altar()
    columns_and_brackets()
    roof()
    for (px, pz, sc) in PINE_SPOTS:
        tree(px, pz, sc, ginkgo=False)
    for (px, pz, sc) in GINKGO_SPOTS:
        tree(px, pz, sc, ginkgo=True)
    for sx in (-9.6, 9.6):
        stone_lantern(sx, -2.6)
    pond_rim()

    objs = join_groups()
    total = sum(len(o.data.polygons) for o in objs if o.type == 'MESH')
    print('[court] joined objects:', len(objs), '| polygons:', total)

    # 预览渲染（迭代时用 COURT_NO_PREVIEW=1 跳过，EEVEE 软件渲染很慢）
    try:
        if os.environ.get('COURT_NO_PREVIEW'):
            raise RuntimeError('preview skipped by env')
        import mathutils
        cam_data = bpy.data.cameras.new('cam')
        cam_data.lens = 42
        cam = bpy.data.objects.new('cam', cam_data)
        bpy.context.collection.objects.link(cam)
        eye = mathutils.Vector(G(17, 12.5, 25))
        target = mathutils.Vector(G(0, 3.6, -9.5))
        cam.location = eye
        cam.rotation_euler = (target - eye).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.camera = cam
        sun_data = bpy.data.lights.new('sun', 'SUN')
        sun_data.energy = 2.4
        sun = bpy.data.objects.new('sun', sun_data)
        bpy.context.collection.objects.link(sun)
        sun.rotation_euler = (math.radians(38), math.radians(-18), math.radians(-28))
        sc = bpy.context.scene
        sc.world.color = (0.72, 0.72, 0.68)
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
        sc.render.resolution_x, sc.render.resolution_y = 1100, 700
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'PNG'
        sc.render.filepath = os.path.join(PREV, 'court-preview.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        bpy.data.objects.remove(sun, do_unlink=True)
    except Exception as e:
        print('[court] preview skipped:', e)

    for o in bpy.data.objects:
        o.select_set(o.type == 'MESH')
    path = os.path.join(OUT, 'court.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True,
                              use_selection=True, export_apply=False)
    print('[court] exported:', path, os.path.getsize(path), 'bytes')


main()
