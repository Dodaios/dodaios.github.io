"""Build, light-bake, export and preview the "desk at night" diorama.

Run headless:
  blender --background --factory-startup --python build.py -- [flags]

Flags:
  --skip-bake      build the set and render quick lit Cycles previews only (out/lit_*.png)
  --regrade        reuse cached bakes from cache/ (same geometry), redo grading, export, previews
  --samples N      bake samples for the lighting passes (default 2048)
  --no-previews    skip the GLB preview renders
  --previews-only  only import out/desk.glb and render the eight previews (no build, no bake)

All positions in this file are given in glTF / three.js coordinates
(X right, Y up, Z toward the viewer, metres) and converted with G().
"""
import bpy
import bmesh
import math
import os
import sys
import time
import hashlib
import numpy as np
from mathutils import Vector, Matrix
from bpy_extras import mesh_utils

ROOT = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
OUT = ROOT + "/out"
CACHE = ROOT + "/cache"
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SKIP_BAKE = "--skip-bake" in ARGS
REGRADE = "--regrade" in ARGS
NO_PREVIEWS = "--no-previews" in ARGS
LIT_VIEWS = ARGS[ARGS.index("--views") + 1].split(",") if "--views" in ARGS else ["hero", "seat", "left", "top"]
SAMPLES = int(ARGS[ARGS.index("--samples") + 1]) if "--samples" in ARGS else 2048
ATLAS = 2048

T0 = time.time()


def log(*a):
    print("[desk %6.1fs]" % (time.time() - T0), *a, flush=True)


def G(x, y, z):
    """glTF (Y up, Z toward viewer) -> Blender (Z up)."""
    return Vector((x, -z, y))


def srgb2lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb2lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


# ---------------------------------------------------------------------------
# GPU
# ---------------------------------------------------------------------------
def setup_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    used = []
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
        if d.use:
            used.append(d.name)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    if not used:
        raise RuntimeError("No OPTIX GPU device found")
    log("Cycles device: GPU / OPTIX ->", used, "scene.cycles.device =", scene.cycles.device)


# ---------------------------------------------------------------------------
# Materials (bake materials; replaced by the atlas materials before export)
# ---------------------------------------------------------------------------
PALETTE = {
    "wall": "#3a3833", "floor": "#2c2a26", "slab_side": "#2a2824",
    "desk": "#4a4238", "desk_leg": "#3b352e", "drawer": "#433c33",
    "plastic": "#1f1e1b", "plastic2": "#2a2824", "keycap": "#34322d",
    "paper": "#e9e7e0", "page": "#d8d3c6", "coffee": "#1c140e",
    "book_a": "#6d6a62", "book_b": "#8a5a34", "book_c": "#46433b",
    "lamp_metal": "#26241f", "brass": "#c08532", "shade_in": "#ddd6c6",
    "bulb": "#fff4e0", "fabric": "#34312c", "rug": "#4a463f", "rug_border": "#3a3731",
    "frame": "#2b2925", "pane": "#10141a", "leaf": "#4a5244", "soil": "#1d1a16",
    "pot": "#cfcbc0", "print_dark": "#3e3b35", "proxy": "#2b2824", "metal_dark": "#2e2c28",
}
MATS = {}


def get_mat(atlas, key):
    name = "%s_%s" % (atlas, key)
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*hexcol(PALETTE[key]), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    m["key"] = key
    MATS[name] = m
    return m


def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


# ---------------------------------------------------------------------------
# Mesh helpers (all built in bmesh, in Blender space)
# ---------------------------------------------------------------------------
COLL = None
PARTS = []  # (object, atlas)


def finish(bm, name, atlas, key, weight=1.0, smooth=True, sharp_deg=50.0, weighted=True,
           drop_bottom=False, mats=None):
    """Turn a bmesh into an object with smooth-but-crisp normals."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if drop_bottom:
        zmin = min(v.co.z for v in bm.verts)
        kill = [f for f in bm.faces if f.normal.z < -0.99 and
                all(abs(v.co.z - zmin) < 1e-4 for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    keys = mats if mats else [key]
    for k in keys:
        me.materials.append(get_mat(atlas, k) if atlas else get_mat("X", k))
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        if weighted:
            mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.weight = 80
            mod.keep_sharp = True
            apply_mods(ob)
            me = ob.data
    else:
        me.shade_flat()
    attr = me.attributes.new("uvw", "FLOAT", "FACE")
    attr.data.foreach_set("value", [weight] * len(me.polygons))
    if atlas:
        PARTS.append((ob, atlas))
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def bevel(bm, width, segs=3, angle=30.0, only=None):
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and
             e.calc_face_angle(0.0) > math.radians(angle)]
    if only:
        edges = [e for e in edges if only(e)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs,
                        profile=0.5, affect="EDGES", clamp_overlap=True)


def bm_box(size, center=(0, 0, 0)):
    """size and center in glTF axes."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy)) + G(*center)
    return bm


def rbox(name, atlas, key, size, center, bev=0.006, segs=3, weight=1.0, drop_bottom=False,
         rot_y=0.0, pivot=None, tilt_x=0.0):
    bm = bm_box(size, (0, 0, 0))
    bevel(bm, min(bev, min(size) * 0.45), segs)
    xf = Matrix.Translation(G(*center)) @ Matrix.Rotation(math.radians(rot_y), 4, "Z") @ \
        Matrix.Rotation(math.radians(tilt_x), 4, "X")
    bm.transform(xf)
    if pivot is not None:
        pass
    return finish(bm, name, atlas, key, weight, drop_bottom=drop_bottom)


def rrect_pts(hx, hz, radii, n=8, cx=0.0, cz=0.0):
    """Rounded rectangle in the glTF XZ plane, CCW seen from above.
    radii: (front-right, back-right, back-left, front-left)."""
    # Built in Blender XY (y = -z), CCW: corner (x>0,y>0) == glTF back-right,
    # (x<0,y>0) == back-left, (x<0,y<0) == front-left, (x>0,y<0) == front-right.
    pts = []
    bl = [((hx, hz), radii[1], 0.0), ((-hx, hz), radii[2], 90.0),
          ((-hx, -hz), radii[3], 180.0), ((hx, -hz), radii[0], 270.0)]
    for (x, y), r, a0 in bl:
        r = max(r, 1e-4)
        ccx = x - math.copysign(r, x)
        ccy = y - math.copysign(r, y)
        for i in range(n + 1):
            a = math.radians(a0 + 90.0 * i / n)
            pts.append((cx + ccx + r * math.cos(a), -cz + ccy + r * math.sin(a)))
    return pts  # Blender XY


def loft(rings, cap_start=True, cap_end=True):
    """rings: list of lists of Blender Vectors with equal counts (closed loops)."""
    bm = bmesh.new()
    vrings = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vrings[:-1], vrings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_start:
        bm.faces.new(list(reversed(vrings[0])))
    if cap_end:
        bm.faces.new(vrings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(profile, segs=32, mat_of_seg=None):
    """profile: list of (r, h) going along the surface; revolved around local +Z.
    Points with r == 0 collapse to a pole."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs),
                                        r * math.sin(2 * math.pi * i / segs), h))
                          for i in range(segs)])
    for k, (a, b) in enumerate(zip(rings[:-1], rings[1:])):
        mi = mat_of_seg[k] if mat_of_seg else 0
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[j], b[0]))
            else:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def align_matrix(origin, axis):
    """Matrix moving local +Z to the given (Blender) axis and origin."""
    axis = Vector(axis).normalized()
    q = Vector((0, 0, 1)).rotation_difference(axis)
    return Matrix.Translation(origin) @ q.to_matrix().to_4x4()


def tube(path, r, sides=10, caps=True):
    """Sweep a circle along a polyline path (Blender Vectors) with parallel transport."""
    rings = []
    n = len(path)
    tangents = []
    for i in range(n):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, n - 1)]
        tangents.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    u = tangents[0].cross(ref).normalized()
    for i in range(n):
        t = tangents[i]
        u = (u - t * u.dot(t)).normalized()
        v = t.cross(u)
        rings.append([path[i] + (u * math.cos(2 * math.pi * k / sides) +
                                 v * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)])
    return loft(rings, caps, caps)


def bm_transform(bm, m):
    bm.transform(m)
    return bm


def merge_bm(dst, src):
    me = bpy.data.meshes.new("tmp")
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    return dst


# ---------------------------------------------------------------------------
# The set
# ---------------------------------------------------------------------------
def build_slab():
    hx, hz, cz = 1.7, 1.2, 0.1
    rad = (0.25, 0.05, 0.05, 0.25)  # front-right, back-right, back-left, front-left
    rb = 0.03
    prof = []
    for i in range(5):  # top bevel quarter circle
        t = math.radians(90.0 * i / 4)
        prof.append((rb - rb * math.sin(t), -(rb - rb * math.cos(t))))
    prof += [(0.0, -0.10), (0.012, -0.112), (0.205, -0.335), (0.225, -0.35)]
    rings = []
    for inset, y in prof:
        rr = tuple(max(r - inset, 0.004) for r in rad)
        pts = rrect_pts(hx - inset, hz - inset, rr, n=8, cx=0.0, cz=cz)
        rings.append([Vector((x, yy, y)) for x, yy in pts])
    bm = loft(rings, cap_start=True, cap_end=True)
    ob = finish(bm, "slab", "Far", "floor", weight=1.0, mats=["floor", "slab_side"], sharp_deg=40)
    # material: top cap + bevel = floor, sides/taper = slab_side
    for p in ob.data.polygons:
        p.material_index = 0 if p.normal.z > 0.5 else 1
    return ob


def build_wall():
    x0, x1, y0, y1, r = -1.7, 1.7, 0.0, 2.0, 0.22
    outer = []
    outer += [(x0, y0), (x1, y0)]
    for i in range(10):
        a = math.radians(0 + 90.0 * i / 9)
        outer.append((x1 - r + r * math.cos(a), y1 - r + r * math.sin(a)))
    for i in range(10):
        a = math.radians(90 + 90.0 * i / 9)
        outer.append((x0 + r + r * math.cos(a), y1 - r + r * math.sin(a)))
    hole = [(0.60, 1.10), (1.25, 1.10), (1.25, 1.75), (0.60, 1.75)]
    bm = bmesh.new()
    zf = -1.0

    def loop(pts):
        vs = [bm.verts.new(G(x, y, zf)) for x, y in pts]
        return [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    e = loop(outer) + loop(hole)
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=True, edges=e)
    faces = list(bm.faces)
    ret = bmesh.ops.extrude_face_region(bm, geom=faces)
    nv = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=G(0, 0, -0.1))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bevel(bm, 0.012, 3, angle=45)
    return finish(bm, "wall", "Far", "wall", weight=1.0, drop_bottom=True)


def build_window():
    x0, x1, y0, y1 = 0.60, 1.25, 1.10, 1.75
    fw, zc, fd = 0.04, -1.05, 0.06
    parts = []
    parts.append(((x1 - x0, fw, fd), ((x0 + x1) / 2, y0 + fw / 2, zc)))
    parts.append(((x1 - x0, fw, fd), ((x0 + x1) / 2, y1 - fw / 2, zc)))
    parts.append(((fw, y1 - y0 - 2 * fw, fd), (x0 + fw / 2, (y0 + y1) / 2, zc)))
    parts.append(((fw, y1 - y0 - 2 * fw, fd), (x1 - fw / 2, (y0 + y1) / 2, zc)))
    parts.append(((0.022, y1 - y0 - 2 * fw, 0.035), ((x0 + x1) / 2, (y0 + y1) / 2, zc)))
    parts.append(((x1 - x0 - 2 * fw, 0.022, 0.035), ((x0 + x1) / 2, (y0 + y1) / 2 + 0.03, zc)))
    for i, (s, c) in enumerate(parts):
        rbox("win_frame%d" % i, "Far", "frame", s, c, bev=0.004, segs=2, weight=0.8)
    rbox("win_sill", "Far", "frame", (x1 - x0 + 0.08, 0.025, 0.11), ((x0 + x1) / 2, y0 - 0.0125, -1.035),
         bev=0.006, weight=0.8)
    # pane: single quad, emissive in the bake materials
    bm = bmesh.new()
    zp = zc - 0.004
    vs = [bm.verts.new(G(x, y, zp)) for x, y in ((x0 + 0.01, y0 + 0.01), (x1 - 0.01, y0 + 0.01),
                                                    (x1 - 0.01, y1 - 0.01), (x0 + 0.01, y1 - 0.01))]
    bm.faces.new(vs)
    ob = finish(bm, "win_pane", "Far", "pane", weight=0.8, smooth=False)
    return ob


def build_shelf():
    rbox("shelf", "Far", "desk", (0.62, 0.026, 0.19), (-1.10, 1.40, -0.905), bev=0.005, weight=1.0)
    for x in (-1.32, -0.88):
        rbox("shelf_bracket", "Far", "frame", (0.018, 0.10, 0.012), (x, 1.335, -0.994), bev=0.003, segs=2,
             weight=0.4)
        rbox("shelf_bracket2", "Far", "frame", (0.018, 0.012, 0.15), (x, 1.381, -0.925), bev=0.003, segs=2,
             weight=0.4)
    y = 1.413
    books = [(-1.37, 0.034, 0.215, 0.15, "book_c", 0.0), (-1.333, 0.03, 0.235, 0.16, "book_a", 0.0),
             (-1.298, 0.036, 0.20, 0.145, "book_b", 0.0)]
    for x, t, h, d, col, rz in books:
        rbox("shelf_book", "Far", col, (t, h, d), (x, y + h / 2, -0.92), bev=0.004, weight=0.8,
             drop_bottom=True)
    # leaning book
    bm = bm_box((0.028, 0.19, 0.14))
    bevel(bm, 0.004, 3)
    bm.transform(Matrix.Translation(G(-1.235, y, -0.92)) @ Matrix.Rotation(math.radians(-18), 4, "Y")
                 @ Matrix.Translation(G(0.014, 0.095, 0)))
    finish(bm, "shelf_book_lean", "Far", "book_a", 0.8)
    # small picture frame leaning against the wall
    fx, fy, fz = -0.98, y, -0.985
    bm = bm_box((0.17, 0.215, 0.016))
    bevel(bm, 0.004, 2)
    lean = Matrix.Translation(G(fx, fy, fz + 0.03)) @ Matrix.Rotation(math.radians(-10), 4, "X") \
        @ Matrix.Translation(G(0, 0.1075, 0))
    bm.transform(lean)
    finish(bm, "pic_frame", "Far", "frame", 0.8)
    bm = bm_box((0.13, 0.175, 0.002))
    bm.transform(lean @ Matrix.Translation(G(0, 0, 0.0085)))
    finish(bm, "pic_paper", "Far", "paper", 0.8, smooth=False)
    # the print: a low horizon and a small moon
    bm = bm_box((0.09, 0.05, 0.001))
    bm.transform(lean @ Matrix.Translation(G(0, -0.035, 0.0098)))
    finish(bm, "pic_print", "Far", "print_dark", 0.6, smooth=False)
    bm = lathe([(0, 0), (0.013, 0), (0.013, 0.001), (0, 0.001)], segs=16)
    bm.transform(lean @ Matrix.Translation(G(0.022, 0.03, 0.0095)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
    finish(bm, "pic_moon", "Far", "print_dark", 0.4, smooth=False)


def build_desk():
    top_y, th = 0.74, 0.035
    rbox("desk_top", "Near", "desk", (1.6, th, 0.72), (0.0, top_y - th / 2, -0.52), bev=0.008, segs=3,
         weight=2.4)
    # tapered legs
    for lx in (-0.74, 0.74):
        for lz in (-0.83, -0.21):
            rings = []
            for y, w in ((0.0, 0.028), (0.002, 0.03), (top_y - th, 0.042)):
                rings.append([G(lx + sx * w / 2, y, lz + sz * w / 2) for sx, sz in
                              ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            bm = loft(rings)
            bevel(bm, 0.004, 2, angle=60)
            finish(bm, "desk_leg", "Near", "desk_leg", 0.7, drop_bottom=True)
    # aprons: sides and back
    ay = top_y - th - 0.035
    for lx in (-0.735, 0.735):
        rbox("apron_side", "Near", "desk_leg", (0.022, 0.07, 0.58), (lx, ay, -0.52), bev=0.004, weight=0.4)
    rbox("apron_back", "Near", "desk_leg", (1.44, 0.07, 0.022), (0.0, ay, -0.825), bev=0.004, weight=0.4)
    # hanging drawer unit on the right
    rbox("drawer_box", "Near", "drawer", (0.42, 0.10, 0.60), (0.49, top_y - th - 0.05, -0.515), bev=0.006,
         weight=0.7)
    rbox("drawer_front", "Near", "desk", (0.40, 0.085, 0.018), (0.49, top_y - th - 0.05, -0.207), bev=0.005,
         weight=1.0)
    # brass pull
    bm = tube([G(0.43, 0.655, -0.197), G(0.43, 0.655, -0.184), G(0.55, 0.655, -0.184),
               G(0.55, 0.655, -0.197)], 0.0045, sides=8)
    finish(bm, "drawer_pull", "Near", "brass", 0.6)


SCREEN_W, SCREEN_H, SCREEN_C = 0.646, 0.360, (0.0, 1.06, -0.60)


def build_monitor():
    cx, cy, cz = SCREEN_C
    bz = 0.012
    w, h = SCREEN_W + 2 * bz, SCREEN_H + 2 * bz
    # body: front face 1 mm behind the screen plane
    rbox("mon_body", "Near", "plastic", (w, h, 0.03), (cx, cy, cz - 0.001 - 0.015), bev=0.004, segs=3,
         weight=0.9)
    rbox("mon_back", "Near", "plastic2", (0.44, 0.25, 0.03), (cx, cy - 0.02, cz - 0.031 - 0.012), bev=0.012,
         segs=3, weight=0.5)
    rbox("mon_neck", "Near", "plastic2", (0.055, 0.30, 0.024), (cx, 0.752 + 0.15, cz - 0.068), bev=0.008,
         segs=3, weight=0.5)
    # foot: rounded plate
    rings = []
    for inset, y in ((0.004, 0.740), (0.0, 0.744), (0.0, 0.748), (0.004, 0.752)):
        pts = rrect_pts(0.13 - inset, 0.09 - inset, (0.04,) * 4, n=6, cx=cx, cz=-0.665)
        rings.append([Vector((x, yy, y)) for x, yy in pts])
    bm = loft(rings)
    finish(bm, "mon_foot", "Near", "plastic2", 0.7, drop_bottom=True)


def build_keyboard():
    kx, ky, kz = 0.0, 0.74, -0.34
    u = 0.019
    rows = [[1] * 13 + [2], [1.5] + [1] * 12 + [1.5], [1.75] + [1] * 11 + [2.25],
            [2.25] + [1] * 10 + [2.75], [1.25] * 3 + [6.25] + [1.25] * 4]
    W = 15 * u + 0.016
    D = 5 * u + 0.018
    rbox("kb_base", "Near", "plastic", (W, 0.014, D), (kx, ky + 0.007, kz), bev=0.004, segs=3, weight=1.0,
         drop_bottom=True)
    bm_all = bmesh.new()
    for ri, row in enumerate(rows):
        x = kx - 7.5 * u
        z = kz - 2 * u + ri * u
        for k in row:
            cw = k * u - 0.003
            b = bm_box((cw, 0.007, u - 0.003), (x + k * u / 2, ky + 0.014 + 0.0035, z))
            bevel(b, 0.0016, 1, angle=30)
            merge_bm(bm_all, b)
            x += k * u
    finish(bm_all, "kb_keys", "Near", "keycap", 0.9, sharp_deg=60, drop_bottom=True)


def build_mouse():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0),
                           plane_no=(0, 0, 1), clear_inner=True)
    edges = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.edgeloop_fill(bm, edges=edges)
    for v in bm.verts:
        x, y, z = v.co
        # slightly egg-shaped: wider at the back (Blender +y is glTF back)
        v.co = Vector((x * 0.031 * (1 + 0.12 * y), y * 0.054, z * 0.034))
    bm.transform(Matrix.Translation(G(0.31, 0.74, -0.30)) @ Matrix.Rotation(math.radians(-8), 4, "Z"))
    finish(bm, "mouse", "Near", "plastic2", 1.0, drop_bottom=True)


def build_mug():
    prof = [(0.0, 0.0), (0.034, 0.0), (0.039, 0.004), (0.041, 0.02), (0.041, 0.09), (0.0405, 0.096),
            (0.038, 0.097), (0.0365, 0.093), (0.0365, 0.075), (0.0, 0.075)]
    mats = [0, 0, 0, 0, 0, 0, 0, 0, 1]
    bm = lathe(prof, segs=28, mat_of_seg=mats)
    bm.transform(Matrix.Translation(G(-0.50, 0.74, -0.36)))
    # handle on the viewer-right side, slightly toward the viewer
    ang = math.radians(-35)
    c = G(-0.50, 0.74, -0.36)
    pts = []
    for i in range(11):
        t = math.radians(-80 + 160 * i / 10)
        rr = 0.040 + 0.024 * math.cos(t)
        h = 0.052 + 0.03 * math.sin(t)
        pts.append(c + Vector((rr * math.cos(ang), rr * math.sin(ang), h)))
    merge_bm(bm, tube(pts, 0.0055, sides=8))
    ob = finish(bm, "mug", "Near", "paper", 1.4, mats=["paper", "coffee"], drop_bottom=True)
    return ob


def build_desk_books():
    y = 0.74
    stack = [((0.215, 0.026, 0.155), "book_c", 4.0), ((0.195, 0.022, 0.14), "book_b", -5.0),
             ((0.15, 0.012, 0.205), "paper", 9.0)]
    cx, cz = -0.30, -0.71
    for (sx, sy, sz), col, rot in stack:
        m = Matrix.Translation(G(cx, y, cz)) @ Matrix.Rotation(math.radians(rot), 4, "Z")
        if col == "paper":   # a notebook: dark cover, paper edge
            b = bm_box((sx, sy, sz), (0, sy / 2, 0))
            bevel(b, 0.003, 2)
            b.transform(m)
            finish(b, "notebook", "Near", "book_a", 1.0, drop_bottom=True)
        else:
            # page block plus wrap-around cover
            pb = bm_box((sx - 0.006, sy - 0.004, sz - 0.004), (0.003, sy / 2, 0))
            bevel(pb, 0.0015, 1)
            pb.transform(m)
            finish(pb, "book_pages", "Near", "page", 0.8, drop_bottom=True)
            for yy in (0.0015, sy - 0.0015):
                cv = bm_box((sx, 0.003, sz), (0, yy, 0))
                bevel(cv, 0.001, 1)
                cv.transform(m)
                finish(cv, "book_cover", "Near", col, 1.0)
            sp = bm_box((0.004, sy, sz), (-sx / 2 + 0.002, sy / 2, 0))
            bevel(sp, 0.0015, 2)
            sp.transform(m)
            finish(sp, "book_spine", "Near", col, 0.8)
        y += sy
    # sticky note on the desk, a pen next to it
    m = Matrix.Translation(G(-0.205, 0.7405, -0.215)) @ Matrix.Rotation(math.radians(14), 4, "Z")
    b = bm_box((0.076, 0.0012, 0.076), (0, 0, 0))
    b.transform(m)
    finish(b, "sticky", "Near", "paper", 0.8, smooth=False, drop_bottom=True)
    pen0, pen1 = G(-0.12, 0.7448, -0.235), G(-0.02, 0.7448, -0.205)
    b = tube([pen0, pen0.lerp(pen1, 0.85), pen1], 0.0045, sides=10)
    finish(b, "pen", "Near", "lamp_metal", 0.6)
    b = tube([pen0.lerp(pen1, 0.86), pen1 + (pen1 - pen0).normalized() * 0.006], 0.0047, sides=10)
    finish(b, "pen_cap", "Near", "brass", 0.4)


LAMP = {}


def build_lamp():
    base = G(-0.64, 0.74, -0.70)
    prof = [(0.0, 0.0), (0.068, 0.0), (0.071, 0.004), (0.071, 0.016), (0.066, 0.024), (0.03, 0.028),
            (0.024, 0.034), (0.0, 0.034)]
    bm = lathe(prof, segs=32, mat_of_seg=[0, 0, 0, 1, 0, 0, 0])
    bm.transform(Matrix.Translation(base))
    finish(bm, "lamp_base", "Near", "lamp_metal", 1.0, mats=["lamp_metal", "brass"], drop_bottom=True)
    B = G(-0.64, 0.79, -0.70)
    E = G(-0.66, 1.235, -0.86)
    S = G(-0.50, 1.36, -0.63)
    T = G(-0.30, 0.74, -0.63)
    # post from base to pivot
    finish(tube([base + Vector((0, 0, 0.03)), B], 0.009, sides=12), "lamp_post", "Near", "lamp_metal", 0.6)
    # joints (brass knuckles), axis along X
    for P, r in ((B, 0.014), (E, 0.013), (S, 0.012)):
        b = lathe([(0, -0.022), (r, -0.022), (r, 0.022), (0, 0.022)], segs=16)
        b.transform(Matrix.Translation(P) @ Matrix.Rotation(math.radians(90), 4, "Y"))
        finish(b, "lamp_joint", "Near", "brass", 0.6)
    # twin rods
    for off in (-0.011, 0.011):
        o = Vector((off, 0, 0))
        finish(tube([B + o, E + o], 0.0045, sides=8), "lamp_rod", "Near", "lamp_metal", 0.5)
        finish(tube([E + o, S + o], 0.0045, sides=8), "lamp_rod", "Near", "lamp_metal", 0.5)
    # shade: axis from S toward the target
    d = (T - S).normalized()
    apex = S + d * 0.015
    sprof = [(0.0, 0.0), (0.024, 0.0), (0.03, 0.014), (0.042, 0.055), (0.06, 0.115), (0.069, 0.145),
             (0.0695, 0.15), (0.0665, 0.148), (0.058, 0.118), (0.04, 0.058), (0.027, 0.02), (0.0, 0.016)]
    smat = [0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2]
    bm = lathe(sprof, segs=36, mat_of_seg=smat)
    bm.transform(align_matrix(apex, d))
    finish(bm, "lamp_shade", "Near", "lamp_metal", 1.6, mats=["lamp_metal", "brass", "shade_in"])
    # socket and bulb
    sock = lathe([(0, 0.012), (0.013, 0.012), (0.013, 0.05), (0, 0.05)], segs=16)
    sock.transform(align_matrix(apex, d))
    finish(sock, "lamp_socket", "Near", "lamp_metal", 0.3)
    bulb_c = apex + d * 0.069
    bb = bmesh.new()
    bmesh.ops.create_uvsphere(bb, u_segments=16, v_segments=10, radius=0.022)
    bb.transform(Matrix.Translation(bulb_c))
    bulb = finish(bb, "lamp_bulb", "Near", "bulb", 0.5)
    LAMP.update(bulb_center=bulb_c, dir=d, opening=apex + d * 0.15, target=T)
    return bulb


def build_chair():
    parts = []  # (bmesh, key, weight)
    # 5-star base
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        ca, sa = math.cos(a), math.sin(a)

        def P(r, y, side, half):
            # local glTF: radial direction (ca, sa) in XZ
            return G(ca * r - sa * side * half, y, sa * r + ca * side * half)
        rings = []
        for r, y, hw, hh in ((0.03, 0.095, 0.024, 0.022), (0.27, 0.06, 0.016, 0.014)):
            rings.append([P(r, y - hh, -1, hw), P(r, y - hh, 1, hw), P(r, y + hh, 1, hw), P(r, y + hh, -1, hw)])
        b = loft(rings)
        bevel(b, 0.005, 2, angle=40)
        parts.append((b, "metal_dark", 0.6))
        # caster
        cpos = G(ca * 0.28, 0.0, sa * 0.28)
        hous = bm_box((0.03, 0.03, 0.03), (ca * 0.28, 0.052, sa * 0.28))
        bevel(hous, 0.006, 2)
        parts.append((hous, "plastic", 0.3))
        wheel = lathe([(0, -0.012), (0.019, -0.012), (0.024, -0.008), (0.024, 0.008), (0.019, 0.012), (0, 0.012)],
                      segs=14)
        wheel.transform(Matrix.Translation(cpos + Vector((0, 0, 0.024))) @
                        Matrix.Rotation(-a, 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "Y")
                        @ Matrix.Translation((0, 0, 0)))
        parts.append((wheel, "plastic", 0.3))
    hub = lathe([(0, 0.07), (0.05, 0.07), (0.052, 0.09), (0.04, 0.12), (0, 0.12)], segs=20)
    parts.append((hub, "metal_dark", 0.5))
    col = lathe([(0, 0.12), (0.033, 0.12), (0.033, 0.26), (0.024, 0.27), (0.024, 0.37), (0, 0.37)], segs=20)
    parts.append((col, "plastic", 0.6))
    mech = bm_box((0.2, 0.035, 0.22), (0, 0.385, 0.0))
    bevel(mech, 0.008, 2)
    parts.append((mech, "plastic", 0.4))
    shell = bm_box((0.47, 0.02, 0.45), (0, 0.41, 0.0))
    bevel(shell, 0.009, 3)
    parts.append((shell, "plastic2", 0.6))
    seat = bm_box((0.48, 0.07, 0.46), (0, 0.453, 0.0))
    bevel(seat, 0.03, 4, angle=30)
    for v in seat.verts:   # soft dome on top, slight front waterfall
        x, yb, z = v.co
        if z > 0.44:
            v.co.z += 0.008 * (1 - (x / 0.24) ** 2) * (1 - (yb / 0.23) ** 2)
    parts.append((seat, "fabric", 1.6))
    # back support bar (flat), from under the seat to the backrest
    bar = tube([G(0, 0.395, 0.17), G(0, 0.40, 0.255), G(0, 0.47, 0.285), G(0, 0.66, 0.29)], 0.012, sides=8)
    for v in bar.verts:
        v.co.x *= 2.6   # flatten into a strap
    parts.append((bar, "metal_dark", 0.5))
    back = bm_box((0.42, 0.19, 0.055), (0, 0, 0))
    bevel(back, 0.024, 4, angle=30)
    for v in back.verts:   # wrap the backrest around the sitter
        v.co.y -= 0.35 * v.co.x ** 2
    back.transform(Matrix.Translation(G(0, 0.735, 0.30)) @ Matrix.Rotation(math.radians(-9), 4, "X"))
    parts.append((back, "fabric", 1.4))
    # chair transform: turned -20 deg (front toward +X), centred at (0.10, 0.012, 0.30)
    M = Matrix.Translation(G(0.10, 0.012, 0.30)) @ Matrix.Rotation(math.radians(-20), 4, "Z")
    for b, key, w in parts:
        b.transform(M)
        finish(b, "chair_" + key, "Far", key, w)


def build_rug():
    rx, rz, c = 0.78, 0.62, (0.10, 0.35)
    n = 64
    prof = [(0.0, 0.012), (0.80, 0.012), (0.84, 0.012), (0.985, 0.012), (1.0, 0.009), (1.0, 0.001)]
    bm = bmesh.new()
    center = bm.verts.new(G(c[0], 0.012, c[1]))
    rings = []
    for r, y in prof[1:]:
        rings.append([bm.verts.new(G(c[0] + rx * r * math.cos(2 * math.pi * i / n), y,
                                     c[1] + rz * r * math.sin(2 * math.pi * i / n))) for i in range(n)])
    for i in range(n):
        f = bm.faces.new((center, rings[0][(i + 1) % n], rings[0][i]))
        f.material_index = 0
    for k, (a, b) in enumerate(zip(rings[:-1], rings[1:])):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = 1 if k in (0,) else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    finish(bm, "rug", "Far", "rug", 1.1, mats=["rug", "rug_border"], sharp_deg=60)


def build_plant():
    px, pz = -1.36, -0.80
    prof = [(0.0, 0.0), (0.085, 0.0), (0.092, 0.006), (0.115, 0.25), (0.118, 0.262), (0.112, 0.265),
            (0.106, 0.24), (0.0, 0.24)]
    bm = lathe(prof, segs=32, mat_of_seg=[0, 0, 0, 0, 0, 0, 1])
    bm.transform(Matrix.Translation(G(px, 0, pz)))
    finish(bm, "plant_pot", "Far", "pot", 1.0, mats=["pot", "soil"], drop_bottom=True)
    rng = np.random.default_rng(7)
    leaves = bmesh.new()
    nleaf = 8
    for i in range(nleaf):
        a = 2 * math.pi * i / nleaf + rng.uniform(-0.3, 0.3)
        h = rng.uniform(0.36, 0.60)
        lean = rng.uniform(0.06, 0.18)
        wid = rng.uniform(0.065, 0.085)
        rad = 0.03 + 0.05 * rng.uniform()
        segs = 7
        base = Vector((px + rad * math.cos(a), 0.235, pz + rad * math.sin(a)))
        outdir = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a + 0.7), 0, math.cos(a + 0.7)))
        front = []
        for s in range(segs + 1):
            t = s / segs
            ctr = base + Vector((0, h * t, 0)) + outdir * (lean * t * t * 0.6)
            w = wid * (1 - t ** 1.6) * (0.8 + 0.4 * math.sin(math.pi * min(t * 1.6, 1)))
            w = max(w, 0.001)
            fold = outdir * 0.004   # slight V fold: centre pushed out
            pl = ctr - side * w / 2
            pr = ctr + side * w / 2
            front.append([G(*pl), G(*(ctr + fold)), G(*pr)])
        vs = [[leaves.verts.new(p) for p in row] for row in front]
        # thickness: back sheet offset slightly inward
        vb = [[leaves.verts.new(p + G(*(-outdir * 0.004)) - G(0, 0, 0)) for p in row] for row in front]
        for s in range(segs):
            for k in range(2):
                leaves.faces.new((vs[s][k], vs[s][k + 1], vs[s + 1][k + 1], vs[s + 1][k]))
                leaves.faces.new((vb[s][k], vb[s + 1][k], vb[s + 1][k + 1], vb[s][k + 1]))
            leaves.faces.new((vs[s][0], vs[s + 1][0], vb[s + 1][0], vb[s][0]))
            leaves.faces.new((vs[s][2], vb[s][2], vb[s + 1][2], vs[s + 1][2]))
    bmesh.ops.remove_doubles(leaves, verts=leaves.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(leaves, faces=leaves.faces)
    finish(leaves, "plant_leaves", "Far", "leaf", 0.9, sharp_deg=70, weighted=False)


def build_proxy():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        zz = (z + 1) / 2   # 0..1 height
        widen = 1.0 - 0.18 * zz
        v.co = Vector((x * 0.13 * widen, y * 0.11 * widen, zz * 0.34))
    bm.transform(Matrix.Translation(G(0.50, 0.74, -0.42)))
    ob = finish(bm, "MascotProxy", None, "proxy", 1.0)
    return ob


def build_screen():
    cx, cy, cz = SCREEN_C
    hw, hh = SCREEN_W / 2, SCREEN_H / 2
    me = bpy.data.meshes.new("Screen")
    verts = [G(cx - hw, cy - hh, cz), G(cx + hw, cy - hh, cz), G(cx + hw, cy + hh, cz), G(cx - hw, cy + hh, cz)]
    me.from_pydata([tuple(v) for v in verts], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    me.update()
    ob = bpy.data.objects.new("Screen", me)
    COLL.objects.link(ob)
    m = bpy.data.materials.new("Screen")
    m.use_nodes = True
    p = principled(m)
    p.inputs["Base Color"].default_value = (0, 0, 0, 1)
    p.inputs["Roughness"].default_value = 1.0
    p.inputs["Specular IOR Level"].default_value = 0.0
    p.inputs["Emission Color"].default_value = (*hexcol("#f2f1ec"), 1)
    p.inputs["Emission Strength"].default_value = 1.0
    me.materials.append(m)
    return ob


# ---------------------------------------------------------------------------
# Lighting states
# ---------------------------------------------------------------------------
def kelvin_raw(k):
    """Approximate blackbody colour (linear Rec.709)."""
    t = k / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * (t - 60) ** -0.1332047592
        g = 288.1221695283 * (t - 60) ** -0.0755148492
        b = 255.0
    return tuple(srgb2lin(min(max(x, 0), 255)) for x in (r, g, b))


WHITE_K = 4500.0   # "camera white balance": light colours are expressed relative to this white


def light_rgb(k):
    c = [a / b for a, b in zip(kelvin_raw(k), kelvin_raw(WHITE_K))]
    m = max(c)
    return tuple(x / m for x in c)


LIGHTS = {}


def setup_lights(scene):
    def add(name, ltype, loc, **kw):
        ld = bpy.data.lights.new(name, ltype)
        for k, v in kw.items():
            setattr(ld, k, v)
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        COLL.objects.link(ob)
        LIGHTS[name] = ob
        return ob
    # lamp bulb (point light inside the bulb mesh)
    add("L_lamp", "POINT", LAMP["bulb_center"], shadow_soft_size=0.016, color=light_rgb(2700))
    # cool-neutral moon/ambient fill above the front of the room; falls off toward the slab rim
    fill = add("L_fill", "AREA", G(0.1, 3.2, 0.2), shape="DISK", size=2.4, color=light_rgb(6000))
    fill.rotation_euler = (G(0.0, 0.0, -0.1) - G(0.1, 3.2, 0.2)).to_track_quat("-Z", "Y").to_euler()
    # warm "desk bounce": stands in for the light the lamp pool throws back up the wall
    bnc = add("L_bounce", "AREA", G(-0.32, 0.80, -0.62), shape="DISK", size=0.8, color=light_rgb(2700))
    bnc.rotation_euler = (G(-0.50, 1.35, -1.0) - G(-0.32, 0.80, -0.62)).to_track_quat("-Z", "Y").to_euler()
    # window lights behind the wall (pass through the pane: pane is transparent to shadow rays)
    win = add("L_window", "AREA", G(0.925, 1.42, -1.6), shape="RECTANGLE", size=0.9, size_y=0.9)
    win.rotation_euler = (math.radians(90 + 12), 0, 0)   # face glTF +Z, tilted slightly down
    # sun for dawn: from front-left above the viewer
    sun = add("L_sun", "SUN", G(0, 5, 0), angle=math.radians(3.5), color=light_rgb(3500))
    d_from = Vector((-0.62, 0.42, 0.66)).normalized()     # glTF direction toward the sun
    travel = -G(*d_from)
    sun.rotation_euler = travel.to_track_quat("-Z", "Y").to_euler()
    # world
    w = bpy.data.worlds.new("World")
    w.use_nodes = True
    scene.world = w


def pane_material_setup():
    """Pane and bulb: emissive, transparent for shadow rays so the lights behind/inside pass."""
    for name in ("Far_pane", "Near_bulb"):
        shadow_transparent(MATS[name])


def shadow_transparent(m):
    nt = m.node_tree
    p = principled(m)
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    lp = nt.nodes.new("ShaderNodeLightPath")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Shadow Ray"], mix.inputs[0])
    nt.links.new(p.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])


STATES = {
    "night": dict(lamp=150.0, fill=105.0, bounce=95.0, window=30.0, window_col=light_rgb(9000), sun=0.0,
                  world=(0.06, 0.06, 0.057), screen=12.0, pane_col="#3b4a5c", pane_str=0.35,
                  bulb_str=40.0, view="AgX", look="Medium High Contrast", exposure=0.5),
    "dawn": dict(lamp=0.0, fill=0.0, bounce=0.0, window=90.0, window_col=light_rgb(4300), sun=6.5,
                 world=(0.30, 0.34, 0.41), screen=6.0, pane_col="#f2c995", pane_str=2.4,
                 bulb_str=0.0, view="AgX", look="Medium High Contrast", exposure=1.5),
}


def set_state(scene, name):
    s = STATES[name]
    LIGHTS["L_lamp"].data.energy = s["lamp"]
    LIGHTS["L_lamp"].hide_render = s["lamp"] <= 0
    LIGHTS["L_fill"].data.energy = s["fill"]
    LIGHTS["L_fill"].hide_render = s["fill"] <= 0
    LIGHTS["L_bounce"].data.energy = s["bounce"]
    LIGHTS["L_bounce"].hide_render = s["bounce"] <= 0
    LIGHTS["L_window"].data.energy = s["window"]
    LIGHTS["L_window"].data.color = s["window_col"]
    LIGHTS["L_window"].hide_render = s["window"] <= 0
    LIGHTS["L_sun"].data.energy = s["sun"]
    LIGHTS["L_sun"].hide_render = s["sun"] <= 0
    bg = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*s["world"], 1)
    bg.inputs["Strength"].default_value = 1.0
    sp = principled(bpy.data.materials["Screen"])
    sp.inputs["Emission Strength"].default_value = s["screen"]
    pp = principled(MATS["Far_pane"])
    pp.inputs["Emission Color"].default_value = (*hexcol(s["pane_col"]), 1)
    pp.inputs["Emission Strength"].default_value = s["pane_str"]
    pp.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1)
    bp = principled(MATS["Near_bulb"])
    bp.inputs["Emission Color"].default_value = (*light_rgb(2900), 1)
    bp.inputs["Emission Strength"].default_value = s["bulb_str"]
    set_view(scene, s["view"], s["look"], s["exposure"])


def set_view(scene, view, look, exposure):
    vs = scene.view_settings
    vs.view_transform = view
    for cand in (look, "%s - %s" % (view, look), "None"):
        try:
            vs.look = cand
            break
        except TypeError:
            continue
    vs.exposure = exposure
    vs.gamma = 1.0


# ---------------------------------------------------------------------------
# Join + lightmap UVs
# ---------------------------------------------------------------------------
def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def lightmap_uvs(ob):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.uv_layers.new(name="UVMap")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    t0 = time.time()
    bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    # per-island texel density: uniform density times sqrt(weight)
    nl = len(me.loops)
    uvs = np.zeros(nl * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    w = np.zeros(len(me.polygons), np.float32)
    me.attributes["uvw"].data.foreach_get("value", w)
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    log("  smart_project %.1fs" % (time.time() - t0))
    islands = mesh_utils.mesh_linked_uv_islands(me)
    log("  islands found %.1fs" % (time.time() - t0))
    for isl in islands:
        a3 = 0.0
        auv = 0.0
        wsum = 0.0
        loops = []
        for pi in isl:
            p = me.polygons[pi]
            a3 += p.area
            ls = list(p.loop_indices)
            loops += ls
            pts = uvs[ls]
            x, y = pts[:, 0], pts[:, 1]
            auv += 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
            # down-facing faces (Blender -Z) and the wall's back face get little space
            nz = p.normal.z
            ww = w[pi]
            if nz < -0.7:
                ww *= 0.12
            elif p.normal.y > 0.9 and p.center.y > 1.02:   # glTF z < -1.02 facing away
                ww *= 0.15
            wsum += ww * p.area
        if auv <= 1e-12 or a3 <= 1e-12:
            continue
        wi = wsum / a3
        s = math.sqrt(a3 / auv) * math.sqrt(wi)
        loops = np.unique(np.array(loops))
        c = uvs[loops].mean(axis=0)
        uvs[loops] = (uvs[loops] - c) * s + c
    me.uv_layers.active.data.foreach_set("uv", uvs.ravel())
    me.update()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.select_all(action="SELECT")
    except Exception as e:  # noqa
        log("uv.select_all failed (ok):", e)
    log("  island scaling done %.1fs" % (time.time() - t0))
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=0.0045, pin=False,
                            shape_method="CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers.active.data.foreach_get("uv", uvs.ravel())
    uvs2 = np.zeros(nl * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvs2)
    uvs2 = uvs2.reshape(-1, 2)
    log("%s UVs: %d islands, uv range %.4f..%.4f / %.4f..%.4f" % (
        ob.name, len(islands), uvs2[:, 0].min(), uvs2[:, 0].max(), uvs2[:, 1].min(), uvs2[:, 1].max()))
    return hashlib.md5(uvs2.round(5).tobytes()).hexdigest()


# ---------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------
def bake_image(name):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    return img


def set_bake_target(ob, img):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("BAKE_TARGET")
        if n is None:
            n = nt.nodes.new("ShaderNodeTexImage")
            n.name = "BAKE_TARGET"
        n.image = img
        nt.nodes.active = n


def do_bake(scene, ob, img, btype, pass_filter=None, samples=64):
    set_bake_target(ob, img)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    scene.cycles.samples = samples
    rb = scene.render.bake
    rb.margin = 16
    rb.margin_type = "EXTEND"
    rb.use_clear = True
    rb.target = "IMAGE_TEXTURES"
    t = time.time()
    kw = dict(type=btype, margin=16, use_clear=True)
    if pass_filter:
        kw["pass_filter"] = pass_filter
    if btype == "NORMAL":
        kw["normal_space"] = "OBJECT"
    bpy.ops.object.bake(**kw)
    log("baked %-8s %-24s %s samples=%d in %.1fs (device %s)" % (btype, img.name, pass_filter or "",
                                                                 samples, time.time() - t, scene.cycles.device))


def img_np(img):
    a = np.empty(ATLAS * ATLAS * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(ATLAS, ATLAS, 4)


def save_exr(arr, path):
    name = "tmp_exr"
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, arr.shape[1], arr.shape[0], alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = "OPEN_EXR"
    img.save()
    bpy.data.images.remove(img)


def load_exr(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Linear Rec.709"
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(ATLAS, ATLAS, 4)


def denoise(arr, normal=None, albedo=None):
    """OIDN through a throw-away compositor scene."""
    sc = bpy.data.scenes.new("DenoiseScene")
    sc.render.engine = "CYCLES"
    sc.render.resolution_x = ATLAS
    sc.render.resolution_y = ATLAS
    sc.render.resolution_percentage = 100
    sc.render.use_compositing = True
    tree = bpy.data.node_groups.new("DN", "CompositorNodeTree")
    sc.compositing_node_group = tree
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    imgs = []

    def img_node(a, nm):
        im = bpy.data.images.new(nm, ATLAS, ATLAS, alpha=True, float_buffer=True)
        im.colorspace_settings.name = "Linear Rec.709"
        im.pixels.foreach_set(a.astype(np.float32).ravel())
        imgs.append(im)
        n = tree.nodes.new("CompositorNodeImage")
        n.image = im
        return n
    dn = tree.nodes.new("CompositorNodeDenoise")
    tree.links.new(img_node(arr, "dn_in").outputs[0], dn.inputs["Image"])
    if normal is not None:
        tree.links.new(img_node(normal, "dn_nrm").outputs[0], dn.inputs["Normal"])
    if albedo is not None:
        tree.links.new(img_node(albedo, "dn_alb").outputs[0], dn.inputs["Albedo"])
    dn.inputs["HDR"].default_value = True
    try:
        dn.inputs["Quality"].default_value = "High"
    except Exception:
        pass
    try:
        dn.inputs["Prefilter"].default_value = "Accurate"
    except Exception:
        pass
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(dn.outputs[0], out.inputs[0])
    bpy.ops.render.render(scene=sc.name)
    rr = bpy.data.images["Render Result"]
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_mode = "RGBA"
    tmp = CACHE + "/_dn_tmp.exr"
    rr.save_render(tmp, scene=sc)
    res = load_exr(tmp)
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.scenes.remove(sc)
    bpy.data.node_groups.remove(tree)
    return res


def write_png(scene, arr, path, state):
    name = "grade_tmp"
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    a = arr.copy()
    a[..., 3] = 1.0
    img.pixels.foreach_set(a.astype(np.float32).ravel())
    s = STATES[state]
    set_view(scene, s["view"], s["look"], s["exposure"])
    st = scene.render.image_settings
    st.file_format = "PNG"
    st.color_mode = "RGB"
    st.color_depth = "8"
    st.compression = 90
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    log("wrote", path, "view=%s look=%s exposure=%.2f" % (scene.view_settings.view_transform,
                                                         scene.view_settings.look, scene.view_settings.exposure))


def bake_all(scene, atlases, uvhash):
    """Bake lighting (irradiance), albedo, emission and normals; combine; grade; save PNGs."""
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 5
    scene.cycles.glossy_bounces = 1
    scene.cycles.transmission_bounces = 2
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.sample_clamp_direct = 0.0
    scene.cycles.sample_clamp_indirect = 4.0
    scene.cycles.use_adaptive_sampling = False
    cache_ok = REGRADE and os.path.exists(CACHE + "/uvhash.txt") and \
        open(CACHE + "/uvhash.txt").read().strip() == uvhash
    if REGRADE and not cache_ok:
        log("WARNING: cache UV hash mismatch or missing -> full bake")
    for aname, ob in atlases.items():
        key = aname.lower()
        if cache_ok:
            alb = load_exr(CACHE + "/%s_albedo.exr" % key)
            nrm = load_exr(CACHE + "/%s_normal.exr" % key)
        else:
            set_state(scene, "night")
            im = bake_image("%s_albedo" % key)
            do_bake(scene, ob, im, "DIFFUSE", {"COLOR"}, samples=16)
            alb = img_np(im)
            im2 = bake_image("%s_normal" % key)
            do_bake(scene, ob, im2, "NORMAL", None, samples=16)
            nrm = img_np(im2)
            nrm[..., :3] = nrm[..., :3] * 2 - 1
            save_exr(alb, CACHE + "/%s_albedo.exr" % key)
            save_exr(nrm, CACHE + "/%s_normal.exr" % key)
        for state in ("night", "dawn"):
            set_state(scene, state)
            if cache_ok:
                irr = load_exr(CACHE + "/%s_%s_irr_dn.exr" % (key, state))
                emi = load_exr(CACHE + "/%s_%s_emit.exr" % (key, state))
            else:
                im = bake_image("%s_%s_irr" % (key, state))
                do_bake(scene, ob, im, "DIFFUSE", {"DIRECT", "INDIRECT"}, samples=SAMPLES)
                raw = img_np(im)
                save_exr(raw, CACHE + "/%s_%s_irr_raw.exr" % (key, state))
                t = time.time()
                white = np.ones_like(raw)
                irr = denoise(raw, normal=nrm, albedo=white)
                log("denoised %s %s in %.1fs" % (key, state, time.time() - t))
                save_exr(irr, CACHE + "/%s_%s_irr_dn.exr" % (key, state))
                im3 = bake_image("%s_%s_emit" % (key, state))
                do_bake(scene, ob, im3, "EMIT", None, samples=16)
                emi = img_np(im3)
                save_exr(emi, CACHE + "/%s_%s_emit.exr" % (key, state))
            col = alb[..., :3] * np.maximum(irr[..., :3], 0) + emi[..., :3]
            outa = np.ones((ATLAS, ATLAS, 4), np.float32)
            outa[..., :3] = col
            write_png(scene, outa, OUT + "/%s_%s.png" % (key, state), state)
    if not cache_ok:
        open(CACHE + "/uvhash.txt", "w").write(uvhash)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def atlas_material(name, png):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True   # exported as single-sided
    nt = m.node_tree
    p = principled(m)
    p.inputs["Roughness"].default_value = 1.0
    p.inputs["Metallic"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png, check_existing=False)
    tex.image.colorspace_settings.name = "sRGB"
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    return m


def add_empty(name, loc, rot_y_deg=0.0):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.1
    e.location = loc
    e.rotation_euler = (0, 0, math.radians(rot_y_deg))
    COLL.objects.link(e)
    return e


def export(scene, atlases, screen, empties):
    for aname, ob in atlases.items():
        m = atlas_material(aname, OUT + "/%s_night.png" % aname.lower())
        ob.data.materials.clear()
        ob.data.materials.append(m)
        if "uvw" in ob.data.attributes:
            ob.data.attributes.remove(ob.data.attributes["uvw"])
    principled(bpy.data.materials["Screen"]).inputs["Emission Strength"].default_value = 1.0
    bpy.data.materials["Screen"].use_backface_culling = True
    bpy.ops.object.select_all(action="DESELECT")
    for o in list(atlases.values()) + [screen] + empties:
        o.select_set(True)
    path = OUT + "/desk.glb"
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False,
                              export_animations=False, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_image_format="AUTO", export_extras=False)
    log("exported", path, "%.2f MB" % (os.path.getsize(path) / 1e6))


# ---------------------------------------------------------------------------
# Verification + previews
# ---------------------------------------------------------------------------
def to_gltf(v):
    return (v.x, v.z, -v.y)


def verify_screen(ob, tag):
    me = ob.data
    mw = ob.matrix_world
    pts = [to_gltf(mw @ v.co) for v in me.vertices]
    xs, ys, zs = zip(*pts)
    n = (mw.to_3x3() @ me.polygons[0].normal).normalized()
    ng = to_gltf(n)
    log("[%s] Screen: verts=%d faces=%d" % (tag, len(me.vertices), len(me.polygons)))
    log("[%s] Screen size %.6f x %.6f, centre (%.6f, %.6f, %.6f), z-span %.2e, normal (glTF) (%.4f, %.4f, %.4f)"
        % (tag, max(xs) - min(xs), max(ys) - min(ys), (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2,
           (max(zs) + min(zs)) / 2, max(zs) - min(zs), *ng))
    uvl = me.uv_layers.active.data
    for li in me.polygons[0].loop_indices:
        v = pts[me.loops[li].vertex_index]
        u = uvl[li].uv
        log("[%s]   vertex glTF (%.4f, %.4f, %.4f) -> UV (%.3f, %.3f)" % (tag, v[0], v[1], v[2], u[0], u[1]))


def look_at_cam(name, pos_g, target_g, fov_deg=35.0):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = math.radians(fov_deg)
    cd.clip_start = 0.02
    cam = bpy.data.objects.new(name, cd)
    cam.location = G(*pos_g)
    d = G(*target_g) - G(*pos_g)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(cam)
    return cam


VIEWS = {
    "hero": ((2.6, 1.9, 3.4), (0.1, 0.95, -0.5)),
    "seat": ((0.0, 1.06, 0.45), (0.0, 1.06, -0.60)),
    "left": ((-2.8, 1.5, 2.6), (0.0, 0.9, -0.5)),
    "top": ((0.4, 4.2, 2.4), (0.0, 0.6, -0.3)),
}


PROBES = {
    "desk pool": (-0.30, 0.74, -0.55), "desk middle": (0.05, 0.74, -0.24), "desk front edge": (-0.2, 0.72, -0.16),
    "keyboard": (0.0, 0.762, -0.33), "wall near lamp": (-0.84, 1.0, -1.0), "wall above lamp": (-0.45, 1.65, -1.0),
    "wall far left": (-1.45, 1.80, -1.0), "wall far right": (1.5, 1.80, -1.0), "wall right low": (1.4, 0.5, -1.0),
    "floor front of desk": (-0.45, 0.0, 0.15), "floor right": (1.25, 0.0, -0.3), "floor front-left": (-1.2, 0.0, 0.9),
    "chair seat": (0.10, 0.495, 0.30), "slab rim front": (0.7, -0.05, 1.3), "slab rim right": (1.7, -0.05, -0.2),
    "pane": (0.76, 1.30, -1.055),
}


def probe_image(path, cam, scene, res):
    """Print sRGB values at projected 3D probe points (5x5 average)."""
    from bpy_extras.object_utils import world_to_camera_view
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    bpy.data.images.remove(img)
    out = []
    for name, pg in PROBES.items():
        co = world_to_camera_view(scene, cam, G(*pg))
        x, y = int(co.x * w), int(co.y * h)
        if not (2 <= x < w - 2 and 2 <= y < h - 2) or co.z <= 0:
            continue
        v = px[y - 2:y + 3, x - 2:x + 3, :3].reshape(-1, 3).mean(0) * 255
        lum = (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 2.55
        out.append("%s=%d,%d,%d(%d%%)" % (name, v[0], v[1], v[2], lum))
    log("PROBE %s: %s" % (os.path.basename(path), " | ".join(out)))


def lit_previews(scene):
    """Quick direct Cycles renders of the live-lit scene (modelling/lighting iteration)."""
    scene.render.resolution_x = 960
    scene.render.resolution_y = 600
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    for v in LIT_VIEWS:
        cam = look_at_cam("cam_" + v, *VIEWS[v])
        scene.camera = cam
        for state in ("night", "dawn"):
            set_state(scene, state)
            scene.render.filepath = OUT + "/lit_%s_%s.png" % (state, v)
            bpy.ops.render.render(write_still=True)
            if v == "hero":
                probe_image(scene.render.filepath, cam, scene, None)


def glb_previews():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    setup_gpu(scene)
    bpy.ops.import_scene.gltf(filepath=OUT + "/desk.glb")
    names = sorted(o.name for o in scene.objects)
    log("GLB nodes:", names)
    tri = 0
    for o in scene.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            tri += len(o.data.loop_triangles)
    log("GLB triangles:", tri)
    allco = [o.matrix_world @ v.co for o in scene.objects if o.type == "MESH" for v in o.data.vertices]
    mn = [min(to_gltf(c)[i] for c in allco) for i in range(3)]
    mx = [max(to_gltf(c)[i] for c in allco) for i in range(3)]
    log("GLB bbox glTF min (%.3f, %.3f, %.3f) max (%.3f, %.3f, %.3f)" % (*mn, *mx))
    for o in scene.objects:
        if o.type == "EMPTY":
            mw = o.matrix_world
            fwd = to_gltf(mw.to_3x3() @ Vector((0, -1, 0)))
            log("GLB empty %-12s at glTF (%.4f, %.4f, %.4f), rotZ(blender)=%.2f deg, forward glTF (%.3f, %.3f, %.3f)"
                % (o.name, *to_gltf(mw.translation), math.degrees(mw.to_euler().z), *fwd))
    verify_screen(scene.objects["Screen"], "GLB")
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*hexcol("#060605"), 1)
    bg.inputs["Strength"].default_value = 1.0
    scene.world = w
    texnodes = {}
    for aname in ("Near", "Far"):
        ob = scene.objects[aname]
        m = bpy.data.materials.new("prev_" + aname)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        tex = nt.nodes.new("ShaderNodeTexImage")
        em = nt.nodes.new("ShaderNodeEmission")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
        em.inputs["Strength"].default_value = 1.0
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        ob.data.materials.clear()
        ob.data.materials.append(m)
        texnodes[aname] = tex
    sm = bpy.data.materials.new("prev_screen")
    sm.use_nodes = True
    nt = sm.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*hexcol("#f2f1ec"), 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    scene.objects["Screen"].data.materials.clear()
    scene.objects["Screen"].data.materials.append(sm)
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    for state in ("night", "dawn"):
        for aname, tex in texnodes.items():
            img = bpy.data.images.load(OUT + "/%s_%s.png" % (aname.lower(), state), check_existing=False)
            img.colorspace_settings.name = "sRGB"
            tex.image = img
            tex.interpolation = "Linear"
        for v in ("hero", "seat", "left", "top"):
            cam = look_at_cam("cam_%s_%s" % (v, state), *VIEWS[v])
            scene.camera = cam
            scene.render.filepath = OUT + "/preview_%s_%s.png" % (state, v)
            bpy.ops.render.render(write_still=True)
            log("preview", scene.render.filepath)
            if v in ("hero", "left"):
                probe_image(scene.render.filepath, cam, scene, None)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    global COLL
    if "--previews-only" in ARGS:   # re-render previews from the existing out/desk.glb + PNGs
        glb_previews()
        log("ALL DONE (previews only)")
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    setup_gpu(scene)
    COLL = scene.collection
    scene.unit_settings.system = "METRIC"

    build_slab()
    build_wall()
    build_window()
    build_shelf()
    build_desk()
    build_monitor()
    build_keyboard()
    build_mouse()
    build_mug()
    build_desk_books()
    build_lamp()
    build_chair()
    build_rug()
    build_plant()
    proxy = build_proxy()
    screen = build_screen()
    pane_material_setup()
    setup_lights(scene)

    # chair height check
    chair_top = max(to_gltf(o.matrix_world @ v.co)[1] for o, a in PARTS if o.name.startswith("chair")
                    for v in o.data.vertices)
    log("chair highest point Y = %.4f (limit 0.86)" % chair_top)
    assert chair_top <= 0.86

    near = join([o for o, a in PARTS if a == "Near"], "Near")
    far = join([o for o, a in PARTS if a == "Far"], "Far")
    atlases = {"Near": near, "Far": far}
    for ob in atlases.values():
        ob.data.calc_loop_triangles()
        log("%s: %d verts, %d tris, %d materials" % (ob.name, len(ob.data.vertices),
                                                      len(ob.data.loop_triangles), len(ob.data.materials)))
    verify_screen(screen, "build")

    # empties
    bulb_g = to_gltf(LAMP["bulb_center"])
    # pool centre: where the shade axis meets the desk top (Y = 0.74)
    o, d = LAMP["opening"], LAMP["dir"]
    t = (o.z - 0.74) / -d.z
    pool = o + d * t
    empties = [add_empty("MascotAnchor", G(0.50, 0.74, -0.42), -22.0),
               add_empty("SeatCamera", G(0.0, 1.06, 0.25)),
               add_empty("LampBulb", LAMP["bulb_center"]),
               add_empty("LampPool", Vector((pool.x, pool.y, 0.74)))]
    log("LampBulb glTF (%.4f, %.4f, %.4f), LampPool glTF (%.4f, %.4f, %.4f)" % (
        *bulb_g, *to_gltf(Vector((pool.x, pool.y, 0.74)))))

    if SKIP_BAKE:
        lit_previews(scene)
        log("skip-bake done")
        return
    hashes = [lightmap_uvs(ob) for ob in atlases.values()]
    uvhash = hashlib.md5("".join(hashes).encode()).hexdigest()
    bake_all(scene, atlases, uvhash)
    proxy.hide_render = True
    bpy.data.objects.remove(proxy)
    export(scene, atlases, screen, empties)
    if not NO_PREVIEWS:
        glb_previews()
    log("ALL DONE")


main()
