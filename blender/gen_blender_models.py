# -*- coding: utf-8 -*-
# 静照院 Blender 建模脚本：生成 monk.glb / cushion.glb / toad.glb + 预览渲染
# 约定：Blender Z 轴向上；glTF 导出后 game 坐标 (x, y, z_up, z_front) 对应 Blender (x, z_up, -z_front)
# 材质按语义命名（robe/skin/ink/cloth/gold...），游戏端按名字覆盖为 toon/贴图材质
import bpy, math, os

ROOT = os.path.dirname(os.path.abspath(__file__))
_SIBLING = os.path.join(ROOT, '..', 'zen-court', 'assets', 'models')
OUT = _SIBLING if os.path.isdir(os.path.join(ROOT, '..', 'zen-court', 'assets')) \
      else os.path.join(ROOT, '..', 'assets', 'models')
PREV = os.path.join(ROOT, 'previews')
os.makedirs(OUT, exist_ok=True); os.makedirs(PREV, exist_ok=True)

def W():
    return bpy.context.scene.objects.active

def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)

def mat(name, color, rough=0.8, metal=0.0, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    n = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    n.inputs['Base Color'].default_value = (*color, 1.0)
    n.inputs['Roughness'].default_value = rough
    n.inputs['Metallic'].default_value = metal
    if emit > 0:
        n.inputs['Emission Color'].default_value = (*color, 1.0)
        n.inputs['Emission Strength'].default_value = emit
    return m

def link(ob, parent=None):
    if parent:
        ob.parent = parent
    return ob

def revolve(name, profile, segs=28, material=None, smooth=True):
    """回转体：profile = [(r, z), ...]（z 向上），生成带柱面 UV 的网格"""
    verts, faces = [], []
    n = len(profile)
    for (r, z) in profile:
        for i in range(segs):
            a = 2 * math.pi * i / segs
            verts.append((max(r, 0.002) * math.cos(a), max(r, 0.002) * math.sin(a), z))
    for j in range(n - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            faces.append((j*segs+i, j*segs+i2, (j+1)*segs+i2, (j+1)*segs+i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uvs = []
    for j in range(n):
        for i in range(segs):
            uvs.append((i / segs, j / max(n - 1, 1)))
    uvl = me.uv_layers.new(name='UVMap')
    for f in me.polygons:
        for li in f.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = uvs[vi]
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material: me.materials.append(material)
    return ob

def sphere(name, r, loc, scale=(1,1,1), material=None, seg=(24,16)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg[0], ring_count=seg[1], location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    for p in ob.data.polygons: p.use_smooth = True
    if material: ob.data.materials.append(material)
    return ob

def torus(name, R, r, loc, rot=(0,0,0), material=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.rotation_euler = rot
    for p in ob.data.polygons: p.use_smooth = True
    if material: ob.data.materials.append(material)
    return ob

def arc_tube(name, R, r, loc, rot=(0,0,0), arc=3.1416, material=None):
    """部分圆弧（XY 平面 0..arc），用曲线 + bevel 出管，替代 THREE.TorusGeometry 的 arc"""
    cu = bpy.data.curves.new(name, 'CURVE')
    sp = cu.splines.new('POLY')
    n = 14
    sp.points.add(n - 1)
    for i in range(n):
        a = arc * i / (n - 1)
        sp.points[i].co = (R * math.cos(a), R * math.sin(a), 0, 1)
    cu.bevel_depth = r; cu.bevel_resolution = 3
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.location = loc; ob.rotation_euler = rot
    if material: cu.materials.append(material)
    return ob

def cyl(name, r, h, loc, rot=(0,0,0), verts=20, material=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    if material: ob.data.materials.append(material)
    return ob

def empty(name, loc=(0,0,0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.05
    e.location = loc
    bpy.context.collection.objects.link(e)
    if parent: e.parent = parent
    return e


def loft(name, rings, segs=24, material=None, smooth=True):
    """沿 Y 轴放样：rings = [(y, rx, rz, cz), ...]，截面为 XZ 椭圆，用于拱背身形"""
    verts, faces = [], []
    n = len(rings)
    for (y, rx, rz, cz) in rings:
        for i in range(segs):
            a = 2 * math.pi * i / segs
            verts.append((max(rx, 0.002) * math.cos(a), y, cz + max(rz, 0.002) * math.sin(a)))
    for j in range(n - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            faces.append((j*segs+i, j*segs+i2, (j+1)*segs+i2, (j+1)*segs+i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uvl = me.uv_layers.new(name='UVMap')
    for f in me.polygons:
        for li in f.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = ((vi % segs) / segs, me.vertices[vi].co.y * 0.5 + 0.5)
    if smooth:
        for pp in me.polygons: pp.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material: me.materials.append(material)
    return ob

def wave_bottom(ob, amp=0.05, waves=6, zmax=0.10):
    """下摆周向波浪：对 z 低于 zmax 的顶点做径向位移"""
    for v in ob.data.vertices:
        if v.co.z < zmax:
            a = math.atan2(v.co.y, v.co.x)
            k = 1.0 + amp * math.cos(waves * a) * (1.0 - v.co.z / zmax)
            v.co.x *= k; v.co.y *= k
    ob.data.update()

def snap(ob, sx=1, sy=1, sz=1):
    with bpy.context.temp_override(active_object=ob, selected_objects=[ob]):
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# ---------- 渲染辅助 ----------
def render_preview(name):
    sc = bpy.context.scene
    cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 60
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    import mathutils
    target = mathutils.Vector((0, 0, 0.9))
    eye = mathutils.Vector((2.6, -2.6, 1.9))
    d = target - eye
    cam.location = eye
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 3.0
    sun = bpy.data.objects.new('sun', sun_data)
    sun.rotation_euler = (0.7, 0.2, 0.5)
    sc.collection.objects.link(sun)
    sc.camera = cam
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'RenderSettings') and 'BLENDER_EEVEE_NEXT' in [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = 560
    sc.render.filepath = os.path.join(PREV, name + '.png')
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)

def export(name):
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', export_yup=True)

C = lambda h: ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)

# ===================== 1. 小沙弥 monk.glb =====================
# 上下身分离（跪拜只动上身）；正面朝 Blender -Y（导出后即 game +Z）
clear()
robeM   = mat('robe', C(0x4f7aa6), rough=0.9)
robeDk  = mat('robeDark', C(0x3d5f81), rough=0.9)
skinM   = mat('skin', C(0xf8dcbf), rough=0.85)
inkM    = mat('ink', C(0x332a23), rough=0.7)
beadM   = mat('bead', C(0x8f4d2d), rough=0.8)
ropeM   = mat('rope', C(0x6b4a2a), rough=0.9)
hiM     = mat('hi', C(0xffffff), rough=0.4)
sashM   = mat('sash', C(0xd8c08a), rough=0.85)
trimM   = mat('trim', C(0xefe6d2), rough=0.85)
blushM  = mat('blush', C(0xe99a92), rough=1.0, emit=0.25)

root = empty('monk')
lower = empty('lower', parent=root)
bow = empty('bowPivot', parent=root)
handsG = empty('grpHands', parent=bow); handsG.hide_render = False

# 下身：袍脚（回转体，裙摆外扬）、腰带玉扣、僧鞋、双膝（跪时显示）
hem = revolve('hem', [(0.80,0.0),(0.76,0.06),(0.70,0.16),(0.66,0.30),(0.62,0.42),(0.575,0.52)], 30, robeDk)
wave_bottom(hem, amp=0.055, waves=7, zmax=0.12)
hem.parent = lower
for s in (-1, 1):
    sh = sphere('shoeL' if s<0 else 'shoeR', 0.20, (s*0.28, -0.16, 0.10), (1,1.45,0.5), inkM); sh.parent = lower
    toe = sphere('toeL' if s<0 else 'toeR', 0.12, (s*0.28, -0.42, 0.12), (1.05,1,0.75), inkM); toe.parent = lower
    kn = sphere('kneeL' if s<0 else 'kneeR', 0.24, (s*0.29, -0.42, 0.24), (1,1.15,0.68), robeM); kn.parent = lower

# 上身：袍身回转体（腰收肩圆）、领口、斜襟、广袖 + 袖口箍
revolve('robe', [(0.62,0.50),(0.58,0.62),(0.55,0.76),(0.545,0.90),(0.46,1.05),(0.34,1.18),(0.16,1.28),(0.002,1.30)], 30, robeM).parent = bow
torus('collar', 0.21, 0.05, (0,0,1.30), material=robeDk).parent = bow
# V 形交领：两根细滚边圆管沿领口斜线交叉
for s in (-1, 1):
    lp = cyl('lapel%d' % (s+2), 0.024, 0.34, (-s*0.13, -0.435, 1.10), (0.55, 0, -s*0.42), verts=8, material=robeDk)
    lp.parent = bow
    lw = cyl('lapelTrim%d' % (s+2), 0.026, 0.26, (-s*0.115, -0.465, 1.13), (0.55, 0, -s*0.42), verts=8, material=trimM)
    lw.parent = bow
for s in (-1, 1):
    sl = revolve('sleeveL' if s<0 else 'sleeveR', [(0.36,0.55),(0.37,0.68),(0.35,0.84),(0.31,1.02),(0.26,1.18),(0.12,1.30)], 20, robeDk)
    sl.location = (s*0.58, -0.02, 0)
    sl.rotation_euler = (0, 0, s*0.10)
    sl.parent = bow
    cuff = torus('cuffL' if s<0 else 'cuffR', 0.345, 0.032, (s*0.62, -0.02, 0.55), material=trimM)
    cuff.parent = bow

# 头：颅顶球 + 下颌收形 + 耳 + 眼 + 高光 + 眉 + 嘴 + 腮红
head = sphere('head', 0.56, (0,0,1.82), (1,0.97,1.04), skinM, seg=(32,24)); head.parent = bow
chin = sphere('chin', 0.32, (0,0.10,1.60), (0.92,0.82,0.60), skinM); chin.parent = bow
for s in (-1, 1):
    e = sphere('earL' if s<0 else 'earR', 0.13, (s*0.56, -0.01, 1.78), (1.15,0.5,1.1), skinM); e.parent = bow
    eb = sphere('eyeL' if s<0 else 'eyeR', 0.075, (s*0.19, -0.49, 1.81), (0.85,0.5,1.15), inkM, seg=(14,10)); eb.parent = bow
    hi = sphere('hiL' if s<0 else 'hiR', 0.026, (s*0.172, -0.525, 1.845), (1,1,1), hiM, seg=(8,6)); hi.parent = bow
    br = arc_tube('browL' if s<0 else 'browR', 0.085, 0.012, (s*0.19, -0.49, 1.925), (0,0,s*0.12), material=inkM); br.parent = bow
    bl = sphere('blushL' if s<0 else 'blushR', 0.085, (s*0.36, -0.485, 1.68), (1,0.22,1), blushM, seg=(14,8)); bl.parent = bow
mo = arc_tube('mouth', 0.075, 0.016, (0,-0.505,1.62), (0,0,3.1416), material=inkM); mo.parent = bow

# 挂珠：穿绳曲线 + 16 颗珠
pts = []
for i in range(18):
    a = i / 18 * math.pi * 2
    pts.append((math.sin(a)*0.42, -math.cos(a)*0.36, 1.28 - math.cos(a)*0.16))
cu = bpy.data.curves.new('rope', 'CURVE')
sp = cu.splines.new('POLY'); sp.points.add(len(pts))
for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
sp.use_cyclic_u = True; cu.bevel_depth = 0.013; cu.bevel_resolution = 3
rope = bpy.data.objects.new('rope', cu)
bpy.context.collection.objects.link(rope)
cu.materials.append(ropeM); rope.parent = bow
for i, p in enumerate(pts):
    b = sphere('bead%02d' % i, 0.062, p, (1,1,1), beadM, seg=(12,9)); b.parent = bow

pend = sphere('beadPendant', 0.095, (0, -0.44, 1.05), (1,1,1.15), beadM, seg=(12,9)); pend.parent = bow
# 合十双手（挂在 grpHands，游戏控制显隐）
h1 = sphere('handL', 0.115, (-0.10, -0.52, 1.27), (0.85,0.75,0.85), skinM); h1.parent = handsG
h2 = sphere('handR', 0.115, (0.10, -0.52, 1.27), (0.85,0.75,0.85), skinM); h2.parent = handsG
for i in range(10):
    a2 = i / 10 * math.pi * 2
    hb = sphere('handBead%02d' % i, 0.042, (math.cos(a2)*0.13, -0.55, 1.27 + math.sin(a2)*0.13), (1,1,1), beadM, seg=(8,6)); hb.parent = handsG
# 合十小臂：肘在两侧袖口上方，前臂斜向内上收拢到胸前手位；与手/珠环同组，跪拜时一起显形
for s2 in (-1, 1):
    for seg, (bx, by, bz, br) in enumerate([(0.58, -0.18, 0.82, 0.135), (0.38, -0.42, 1.03, 0.12), (0.175, -0.545, 1.20, 0.10)]):
        ab = sphere('arm%02d%02d' % (s2+2, seg), br, (s2*bx, by, bz), (1,1,1), robeDk, seg=(14,10)); ab.parent = handsG

render_preview('monk')
export('monk')

# ===================== 2. 拜垫 cushion.glb =====================
clear()
clothM = mat('cloth', C(0xe2e8ea), rough=0.96)
bandM2 = mat('band', C(0xc2ab7c), rough=0.85)
stchM  = mat('stitch', C(0xa89468), rough=0.9)
revolve('cushion', [(0.30,0.0),(0.56,0.01),(0.65,0.035),(0.69,0.11),(0.695,0.18),(0.67,0.255),(0.585,0.305),(0.40,0.332),(0.002,0.34)], 26, clothM)
torus('band', 0.655, 0.038, (0,0,0.19), material=bandM2)
torus('stitch', 0.34, 0.012, (0,0,0.335), material=stchM)
sphere('button', 0.035, (0,0,0.345), (1,1,0.6), stchM, seg=(10,6))
render_preview('cushion')
export('cushion')

# ===================== 3. 金蟾 toad.glb（拱背放样 + 环形眼睑 + 三趾） =====================
clear()
goldM   = mat('gold', C(0xd8a94c), rough=0.36, metal=0.62)
goldDk  = mat('goldDark', C(0xa87c30), rough=0.44, metal=0.55)
goldLt  = mat('goldLight', C(0xefd08a), rough=0.3, metal=0.7)
inkM2   = mat('ink2', C(0x2a1e10), rough=0.7)
stoneM  = mat('stone', C(0x8f9290), rough=0.98)

troot = empty('toad')
# 石座：扁圆鹅卵石（平滑回转体）
rock = revolve('rock', [(0.0,0.0),(0.72,0.02),(0.86,0.10),(0.90,0.16),(0.80,0.24),(0.62,0.29),(0.36,0.305),(0.002,0.31)], 30, stoneM)
# 身体：圆胖团子（参考图低拱圆背，前部圆厚）
loft('toadBody', [
  (-0.50, 0.30, 0.18, 0.62), (-0.56, 0.13, 0.08, 0.57), (-0.585, 0.02, 0.03, 0.53), (-0.30, 0.42, 0.26, 0.60), (-0.05, 0.50, 0.32, 0.58),
  (0.20, 0.52, 0.36, 0.58), (0.42, 0.48, 0.37, 0.60), (0.58, 0.36, 0.33, 0.64),
  (0.66, 0.18, 0.22, 0.70), (0.70, 0.06, 0.10, 0.78)], 26, goldM)
# 大白肚（前下方鼓出）
belly = sphere('belly', 0.42, (0, -0.10, 0.36), (1.05, 0.78, 0.60), goldLt, seg=(24,18))
# 头顶大眼 + 睫毛眉
eyes = []
for s2 in (-1, 1):
    bul = sphere('toadBulbL' if s2<0 else 'toadBulbR', 0.14, (s2*0.24, -0.28, 0.97), (1,1,1), goldM, seg=(18,14))
    bul.parent = troot
    lid1 = torus('lidOuterL' if s2<0 else 'lidOuterR', 0.115, 0.020, (s2*0.24, -0.315, 0.97), (1.5708,0,0), material=goldDk); lid1.parent = troot
    pu = sphere('toadEyeL' if s2<0 else 'toadEyeR', 0.095, (s2*0.24, -0.375, 0.97), (1,1,1), inkM2, seg=(14,10)); pu.parent = troot
    eyes.append(pu)
    hi2 = sphere('eyeHiL' if s2<0 else 'eyeHiR', 0.03, (s2*0.19, -0.44, 1.02), (1,1,1), goldLt, seg=(8,6)); hi2.parent = troot
    ns = sphere('noseL' if s2<0 else 'noseR', 0.018, (s2*0.06, -0.52, 0.74), (1,1,1), inkM2, seg=(8,6)); ns.parent = troot
# 短宽嘴线
mo = arc_tube('toadMouth', 0.20, 0.024, (0,-0.485,0.565), (1.45,0,0.1), arc=2.2, material=inkM2); mo.parent = troot
# 口衔小钱
coinG = empty('grpCoin', (0, -0.515, 0.615), parent=troot)
disc = cyl('coinDisc', 0.105, 0.022, (0,0,0), (1.5708,0,0.15), verts=24, material=goldLt); disc.parent = coinG
hole = cyl('coinHole', 0.030, 0.04, (0,0,0.006), (0,0,0.15), verts=4, material=inkM2); hole.parent = coinG
ring = torus('coinRing', 0.098, 0.011, (0,0,0), (1.5708,0,0.15), material=goldDk); ring.parent = coinG
# 前臂自两侧合抱至胸前，双手相抵
for s2 in (-1, 1):
    ua = sphere('armL' if s2<0 else 'armR', 0.13, (s2*0.36, -0.36, 0.44), (0.75,1.0,0.8), goldM); ua.parent = troot
    fa = sphere('forearmL' if s2<0 else 'forearmR', 0.105, (s2*0.20, -0.46, 0.42), (1.35,0.9,0.75), goldM); fa.parent = troot
    hd = sphere('handL' if s2<0 else 'handR', 0.095, (s2*0.055, -0.52, 0.415), (1,0.75,0.85), goldLt); hd.parent = troot
# 两侧后腿髋 + 向前脚掌 + 趾
for s2 in (-1, 1):
    hn = sphere('hindLegL' if s2<0 else 'hindLegR', 0.22, (s2*0.42, 0.24, 0.42), (0.9,1.0,1.0), goldM); hn.parent = troot
    ft = sphere('hindFootL' if s2<0 else 'hindFootR', 0.11, (s2*0.38, -0.02, 0.18), (0.8,1.6,0.7), goldM); ft.parent = troot
    for t in range(3):
        tn = sphere('hindToe%02d' % (s2+3 if s2>0 else s2+4), 0.04, (s2*(0.34+t*0.04), -0.13-t*0.01, 0.16), (0.6,1.2,0.75), goldDk, seg=(8,6)); tn.parent = troot
# 背部稀疏疣粒
for i in range(10):
    a = i * 1.9 + 0.5; r = 0.26 + (i % 3) * 0.09
    w = sphere('wart%02d' % i, 0.032, (math.cos(a) * r * 0.85, 0.12 + math.sin(a) * r * 0.5, 0.88 + (i % 2) * 0.05), (1,1,1), goldDk, seg=(8,6)); w.parent = troot
render_preview('toad')
export('toad')

clear()
# 白瓷材质族（游戏端 GLB_MATS 同名覆盖为对应色）
pM  = mat('buddhaGold', C(0xf3e9db), rough=0.42, metal=0.04)   # 白瓷身体
rM2 = mat('buddhaRobe', C(0xead9c4), rough=0.55)               # 暖白袈裟
lM  = mat('lotusGold', C(0xdccdb8), rough=0.5)                 # 莲座
sM4 = mat('buddhaSkin', C(0xf2d9bd), rough=0.5)                # 手
iM4 = mat('buddhaInk', C(0x8a6a4a), rough=0.6)                 # 五官浅棕

# 莲座：圆盘 + 一圈瓣缘
revolve('lotusBase', [(0.002,0.0),(0.88,0.0),(1.0,0.10),(1.02,0.20),(0.92,0.27),(0.002,0.30)], 30, lM)
for i in range(16):
    a = i / 16 * math.pi * 2
    pt = sphere('lotusPetal%02d' % i, 0.14, (math.cos(a)*0.92, math.sin(a)*0.92, 0.24), (1,1,0.55), lM, seg=(10,8))
    pt.rotation_euler = (0, 0, -a)
# 盘坐：大跨腿 + 双膝
lap = sphere('lap', 0.60, (0, 0.02, 0.42), (1.15,1.0,0.52), rM2, seg=(26,18))
for s3 in (-1, 1):
    kn = sphere('kneeL' if s3<0 else 'kneeR', 0.30, (s3*0.52, 0.02, 0.42), (0.9,1.0,0.85), rM2, seg=(20,14))
    ft = sphere('footL' if s3<0 else 'footR', 0.10, (s3*0.10, -0.30, 0.20), (0.9,0.7,0.6), sM4, seg=(10,8))
# 躯干小 + 偏袒袈裟斜带
revolve('buddhaBody', [(0.30,0.46),(0.35,0.62),(0.34,0.82),(0.28,1.00),(0.15,1.14),(0.002,1.18)], 26, rM2)
kas = torus('kasaya', 0.335, 0.05, (0,0,0.88), (0.55,0,0.4), material=pM)
# 大头 + 三排螺发 + 肉髻
hd = sphere('buddhaHead', 0.42, (0,0,1.50), (1,0.95,1.0), pM, seg=(30,22))
ush = sphere('ushnisha', 0.15, (0,0,1.86), (1,1,0.9), pM, seg=(14,10))
for i in range(6):
    a = i / 6 * math.pi * 2
    sphere('curlA%02d' % i, 0.065, (math.cos(a)*0.13, math.sin(a)*0.13*0.95, 1.90), (1,1,0.9), pM, seg=(8,6))
for i in range(10):
    a = i / 10 * math.pi * 2
    sphere('curlB%02d' % i, 0.062, (math.cos(a)*0.27, math.sin(a)*0.26*0.95, 1.83), (1,1,0.9), pM, seg=(8,6))
for i in range(12):
    a = i / 12 * math.pi * 2
    sphere('curlC%02d' % i, 0.058, (math.cos(a)*0.37, math.sin(a)*0.35*0.95, 1.72), (1,1,0.9), pM, seg=(8,6))
# 长耳垂 + 闭目 + 弯眉 + 眉间点 + 微笑 + 禅定印手
for s3 in (-1, 1):
    e = sphere('buddhaEarL' if s3<0 else 'buddhaEarR', 0.105, (s3*0.40, 0.01, 1.42), (0.5,0.45,1.75), pM, seg=(10,8))
    e.parent = None
    ey = arc_tube('buddhaEyeL' if s3<0 else 'buddhaEyeR', 0.075, 0.011, (s3*0.155, -0.375, 1.47), (0,0,0), material=iM4)
    br = arc_tube('buddhaBrowL' if s3<0 else 'buddhaBrowR', 0.085, 0.010, (s3*0.155, -0.385, 1.565), (0,0,3.1416), material=iM4)
u = sphere('urna', 0.026, (0, -0.40, 1.575), (1,1,1), mat('urnaGold', C(0xc9a25c), rough=0.4, metal=0.4), seg=(8,6))
mo2 = arc_tube('buddhaMouth', 0.075, 0.010, (0, -0.395, 1.335), (0,0,3.1416), material=iM4)
hnd = sphere('dhyanaHands', 0.15, (0, -0.30, 0.60), (1.5,0.75,0.55), sM4); hnd.rotation_euler = (0.15,0,0)
render_preview('buddha')
export('buddha')

clear()
print('BLENDER_MODELS_DONE')
