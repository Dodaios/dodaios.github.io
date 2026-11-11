# ruff: noqa: E501
"""Zone `corner`: the back-left corner of the room.

A whiteboard on the back wall (quad `Text_install`: the install command, in
marker), a framed blueprint on the left wall (quad `Text_open`), a rolling
drawer cart and a stool under the whiteboard, a low sideboard under the
blueprint with a small 3D printer mid-print, books, a plant and a speaker, a
backpack leaning on the sideboard and an unlit tripod floor lamp in the corner.

Run headless:
  blender --background --factory-startup --python zone_corner.py -- [flags]

All positions are glTF / three.js coordinates (X right, Y up, Z toward the
viewer, metres), converted with G().
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import common  # noqa: E402
from spec import CAMERAS, QUADS, ROOM  # noqa: E402


# --------------------------------------------------------------------------- #
# Basics
# --------------------------------------------------------------------------- #
def G(x, y, z):
    """glTF (Y up, Z toward viewer) -> Blender (Z up)."""
    return Vector((x, -z, y))


def rotg(axis, deg):
    """Rotation about a glTF axis (right-handed, glTF frame)."""
    return Matrix.Rotation(math.radians(deg), 4, G(*axis))


def place(at, yaw=0.0):
    """Local frame: front is +Z, standing at `at`, turned by `yaw` about Y."""
    return Matrix.Translation(G(*at)) @ rotg((0, 1, 0), yaw)


def T(x, y, z):
    return Matrix.Translation(G(x, y, z))


def mat(key):
    return common.mat(key)


def emissive(key, strength):
    return common.emissive(key, strength)


# --------------------------------------------------------------------------- #
# Mesh helpers (bmesh, Blender space)
# --------------------------------------------------------------------------- #
CREATED = []
TEXEL = 1.0  # default lightmap texel weight for parts made by finish()


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def finish(bm, name, keys, smooth=True, sharp=42.0, weighted=True, drop_bottom=False, recalc=True, texel=None, cull=None):
    """bmesh -> object with crisp-but-soft normals. keys: palette keys or materials.
    cull(n): drop faces whose glTF normal n the camera can never see (saves atlas space)."""
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if cull is not None:
        kill = [f for f in bm.faces if cull((f.normal.x, f.normal.z, -f.normal.y))]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    if drop_bottom:
        zmin = min(v.co.z for v in bm.verts)
        kill = [f for f in bm.faces if f.normal.z < -0.99 and all(abs(v.co.z - zmin) < 1e-4 for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if isinstance(keys, (str, bpy.types.Material)):
        keys = [keys]
    for k in keys:
        me.materials.append(k if isinstance(k, bpy.types.Material) else mat(k))
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp))
        if weighted:
            mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.weight = 80
            mod.keep_sharp = True
            apply_mods(ob)
    else:
        me.shade_flat()
    ob["texel"] = TEXEL if texel is None else texel
    CREATED.append(ob)
    return ob


def bevel(bm, width, segs=2, angle=30.0):
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(angle)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs, profile=0.5,
                        affect="EDGES", clamp_overlap=True)


def bm_box(size, center=(0, 0, 0), cuts=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    sx, sy, sz = size
    c = G(*center)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy)) + c
    return bm


def rbox(name, key, size, center, bev=0.004, segs=2, M=None, R=None, drop_bottom=False, smooth=True, texel=None, cull=None):
    """Bevelled box. size/center in glTF axes, local to M; R rotates about the box centre."""
    bm = bm_box(size)
    if bev > 0:
        bevel(bm, min(bev, min(size) * 0.45), segs)
    xf = (M if M is not None else Matrix.Identity(4)) @ Matrix.Translation(G(*center)) @ (R if R is not None else Matrix.Identity(4))
    bm.transform(xf)
    return finish(bm, name, key, drop_bottom=drop_bottom, smooth=smooth, texel=texel, cull=cull)


def loft(rings, cap_start=True, cap_end=True, closed=False):
    """rings: lists of Blender Vectors with equal counts (closed loops).
    closed=True also joins the last ring to the first (a swept closed profile)."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    pairs = list(zip(vr[:-1], vr[1:], strict=True))
    if closed:
        pairs.append((vr[-1], vr[0]))
    for a, b in pairs:
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if not closed:
        if cap_start:
            bm.faces.new(list(reversed(vr[0])))
        if cap_end:
            bm.faces.new(vr[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(profile, segs=24, mat_of_seg=None, twist=0.0):
    """profile: (r, h) along the surface, revolved about local +Z (glTF up).
    r == 0 collapses to a pole. twist: radians per metre of height."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        if r <= 1e-7:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            a0 = twist * h
            rings.append([bm.verts.new((r * math.cos(a0 + 2 * math.pi * i / segs), r * math.sin(a0 + 2 * math.pi * i / segs), h)) for i in range(segs)])
    for k, (a, b) in enumerate(zip(rings[:-1], rings[1:], strict=True)):
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
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# local lathe axis (Blender +Z = glTF up) turned to other glTF axes
AX_X = Matrix.Rotation(math.radians(90), 4, "Y")    # lathe axis -> glTF +X
AX_Z = Matrix.Rotation(math.radians(90), 4, "X")    # lathe axis -> glTF +Z (toward the viewer)


def tube(path, r, sides=8, caps=True, closed=False):
    """Sweep a circle along a polyline (Blender Vectors), parallel transport."""
    n = len(path)
    tangents = []
    for i in range(n):
        if closed:
            a, b = path[(i - 1) % n], path[(i + 1) % n]
        else:
            a, b = path[max(i - 1, 0)], path[min(i + 1, n - 1)]
        tangents.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    u = tangents[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        u = (u - t * u.dot(t)).normalized()
        v = t.cross(u)
        rings.append([path[i] + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)])
    return loft(rings, caps, caps, closed=closed)


def smooth_path(pts, sub=4):
    """Catmull-Rom through points (Blender Vectors)."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(i + 2, n - 1)]
        for s in range(sub):
            t = s / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


def rrect2(hw, hh, r, n=3):
    """Rounded rectangle, CCW in the local XY plane seen from +Z."""
    r = max(min(r, hw - 1e-4, hh - 1e-4), 0.0004)
    pts = []
    for cx, cy, a0 in ((hw - r, hh - r, 0), (-hw + r, hh - r, 90), (-hw + r, -hh + r, 180), (hw - r, -hh + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90.0 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def frame_ring(name, key, hw, hh, r0, profile, M, n=3, sharp=40.0):
    """A picture-frame ring: a closed cross-section (inset, z) swept around a
    rounded rectangle of half sizes (hw, hh) in the local XY plane, mitred."""
    rings = []
    for d, z in profile:
        rings.append([M @ G(x, y, z) for x, y in rrect2(hw - d, hh - d, r0 - d, n)])
    bm = loft(rings, closed=True)
    return finish(bm, name, key, sharp=sharp)


def extrude_profile(name, key, prof_zy, x0, x1, M, bev=0.0):
    """A closed (z, y) profile extruded along local X from x0 to x1."""
    rings = [[M @ G(x, y, z) for z, y in prof_zy] for x in (x0, x1)]
    bm = loft(rings, True, True)
    if bev:
        bevel(bm, bev, 1, angle=30)
    return finish(bm, name, key, sharp=35)


# --------------------------------------------------------------------------- #
# The whiteboard (back wall)
# --------------------------------------------------------------------------- #
WB = QUADS["Text_install"]
WB_X, WB_Y = WB["at"][0], WB["at"][1]
WB_HW, WB_HH = 0.95, 0.61          # board 1.90 x 1.22, quad 1.60 x 1.00
WB_FACE = 0.040                    # face 4 cm off the wall (quad floats 1.5 mm above it)
WALL_BACK = ROOM["z"][0]


def build_whiteboard():
    M = place((WB_X, WB_Y, WALL_BACK))
    # core panel: the writing face, perfectly flat inside the frame
    rbox("wb_core", "paper", (2 * WB_HW - 0.02, 2 * WB_HH - 0.02, 0.020), (0, 0, WB_FACE - 0.010), bev=0, M=M, texel=3.0, smooth=False, cull=lambda n: n[2] < 0.9)
    # aluminium frame: closed section swept around the board
    prof = [(0.0, 0.002), (0.0, 0.046), (0.002, 0.048), (0.020, 0.048), (0.022, 0.046), (0.022, WB_FACE + 0.0007),
            (0.009, WB_FACE + 0.0007), (0.009, 0.002)]
    frame_ring("wb_frame", "metal", WB_HW, WB_HH, 0.006, prof, M, n=2)["texel"] = 1.2
    # moulded corner caps
    for sx in (-1, 1):
        for sy in (-1, 1):
            b = bm_box((0.034, 0.034, 0.050))
            bevel(b, 0.008, 2)
            b.transform(M @ T(sx * (WB_HW - 0.014), sy * (WB_HH - 0.014), 0.026))
            finish(b, "wb_corner", "device_key")
    # marker tray hung under the bottom rail
    yb = -WB_HH
    tray = [(0.010, yb - 0.0015), (0.010, yb - 0.046), (0.098, yb - 0.046), (0.098, yb - 0.021),
            (0.0945, yb - 0.021), (0.0945, yb - 0.0425), (0.0135, yb - 0.0425), (0.0135, yb - 0.0015)]
    extrude_profile("wb_tray", "metal", tray, -0.46, 0.46, M, bev=0.0012)
    for sx in (-1, 1):
        rbox("wb_tray_end", "device_key", (0.012, 0.034, 0.094), (sx * 0.466, yb - 0.028, 0.054), bev=0.004, M=M)
    floor_y = yb - 0.0425
    # markers lying in the tray: (x, z, yaw, cap)
    for i, (mx, mz, yaw, cap) in enumerate(((-0.30, 0.027, 2.0, "device"), (-0.17, 0.047, -3.0, "device"),
                                            (-0.26, 0.072, 1.0, "book_a"), (0.04, 0.032, 9.0, "device"))):
        r = 0.0088
        prof = [(0.0, 0.0), (0.0072, 0.0), (0.0093, 0.0025), (0.0093, 0.034), (0.0086, 0.0355), (r, 0.12),
                (0.0078, 0.1265), (0.0, 0.1275)]
        bm = lathe(prof, segs=10, mat_of_seg=[1, 1, 1, 1, 0, 0, 0])
        bm.transform(M @ T(mx, floor_y + 0.0094, mz) @ rotg((0, 1, 0), yaw) @ AX_X @ Matrix.Translation((0, 0, -0.064)))
        finish(bm, f"wb_marker{i}", ["paper_dim", cap], sharp=50)
    # eraser: felt pad and a grey handle block
    E = M @ T(0.30, floor_y, 0.054) @ rotg((0, 1, 0), -4)
    rbox("wb_eraser_felt", "book_a", (0.142, 0.008, 0.050), (0, 0.004, 0), bev=0.002, segs=1, M=E)
    b = bm_box((0.138, 0.024, 0.046), (0, 0.020, 0))
    bevel(b, 0.009, 2)
    b.transform(E)
    finish(b, "wb_eraser", "device_key")
    # a paper note held by a magnet, in the strip right of the quad
    qx1 = QUADS["Text_install"]["size"][0] / 2   # 0.80
    cx = (qx1 + WB_HW - 0.022) / 2               # middle of the free strip
    C = M @ T(cx, 0.42, WB_FACE) @ rotg((0, 0, 1), -4)
    rbox("wb_note", "paper_dim", (0.098, 0.128, 0.0006), (0, 0, 0.0004), bev=0, M=C, smooth=False, texel=1.6)
    for w, dy in (((0.062, 0.030), (0.050, 0.012), (0.066, -0.006), (0.040, -0.024))):
        rbox("wb_note_ink", "device_key", (w, 0.0022, 0.0003), (-0.034 + w / 2, dy, 0.00085), bev=0, M=C, smooth=False)
    for mx, my, MM in ((0.0, 0.054, C), (-(WB_HW - 0.07), -0.47, M)):
        bm = lathe([(0.0, 0.0), (0.0125, 0.0), (0.0132, 0.003), (0.012, 0.0085), (0.0, 0.009)], segs=12)
        bm.transform(MM @ T(mx, my, WB_FACE + (0.0008 if MM is C else 0.0)) @ AX_Z)
        finish(bm, "wb_magnet", "device", sharp=50)


# --------------------------------------------------------------------------- #
# Under the whiteboard: a rolling drawer cart, a stool
# --------------------------------------------------------------------------- #
CART = {"x": -2.62, "z": -2.46, "w": 0.62, "d": 0.44, "top": 0.665}


def build_cart():
    M = place((CART["x"], 0.0, CART["z"]))
    w, d, top = CART["w"], CART["d"], CART["top"]
    y0 = 0.085
    rbox("cart_body", "furniture", (w, top - 0.024 - y0, d), (0, (top - 0.024 + y0) / 2, 0), bev=0.006, M=M, cull=lambda n: n[2] < -0.9)
    rbox("cart_top", "furniture_top", (w + 0.016, 0.026, d + 0.014), (0, top - 0.013, 0.003), bev=0.006, M=M)
    # four drawers, growing toward the floor
    hs = [0.105, 0.115, 0.135, 0.165]
    y = top - 0.030
    for h in hs:
        cy = y - h / 2
        rbox("cart_drawer", "furniture_top", (w - 0.024, h - 0.006, 0.016), (0, cy, d / 2 + 0.008), bev=0.004, M=M)
        py = cy + h / 2 - 0.028
        hw = 0.17
        path = [M @ G(-hw, py, d / 2 + 0.016), M @ G(-hw, py, d / 2 + 0.036), M @ G(hw, py, d / 2 + 0.036), M @ G(hw, py, d / 2 + 0.016)]
        finish(tube(path, 0.0055, sides=8), "cart_pull", "metal", sharp=60)
        y -= h
    # casters
    for sx in (-1, 1):
        for sz in (-1, 1):
            px, pz = sx * (w / 2 - 0.05), sz * (d / 2 - 0.05)
            rbox("cart_caster_plate", "metal", (0.05, 0.008, 0.05), (px, y0 - 0.004, pz), bev=0, M=M, texel=0.3)
            rbox("cart_caster_fork", "device", (0.032, 0.040, 0.036), (px, y0 - 0.026, pz - 0.006), bev=0.006, segs=1, M=M, texel=0.3)
            bm = lathe([(0.0, -0.012), (0.022, -0.012), (0.028, -0.006), (0.028, 0.006), (0.022, 0.012), (0.0, 0.012)], segs=10)
            bm.transform(M @ T(px, 0.028, pz - 0.012) @ AX_X)
            finish(bm, "cart_wheel", "device", sharp=50, texel=0.3)
    # on the cart: a filament spool on its rim, a parts organiser, a sketchbook and a pen
    S = M @ T(-0.17, top, -0.07)
    build_spool("cart_spool", S, r=0.10, width=0.066, hole=0.027, filament="book_b", axis_deg=58.0)
    Og = M @ T(0.10, top, -0.10) @ rotg((0, 1, 0), -6)
    rbox("org_body", "device_key", (0.24, 0.135, 0.15), (0, 0.0675, 0), bev=0.006, M=Og, drop_bottom=True)
    for row in range(2):
        for col in range(3):
            dx, dy = -0.076 + col * 0.076, 0.035 + row * 0.064
            rbox("org_drawer", "paper_dim", (0.070, 0.058, 0.008), (dx, dy, 0.077), bev=0.002, segs=1, M=Og)
            rbox("org_pull", "device", (0.022, 0.006, 0.006), (dx, dy, 0.083), bev=0, M=Og, texel=0.5)
    B = M @ T(0.07, top, 0.12) @ rotg((0, 1, 0), 11)
    rbox("cart_sketch_pages", "paper", (0.205, 0.012, 0.145), (0.002, 0.0075, 0.0), bev=0.0015, segs=1, M=B, drop_bottom=True)
    rbox("cart_sketch_cover", "book_c", (0.212, 0.0028, 0.15), (0, 0.0014, 0), bev=0.001, segs=1, M=B, drop_bottom=True)
    rbox("cart_sketch_cover", "book_c", (0.212, 0.0028, 0.15), (0, 0.0148, 0), bev=0.001, segs=1, M=B)
    p0, p1 = B @ G(-0.04, 0.0205, -0.02), B @ G(0.09, 0.0205, 0.035)
    finish(tube([p0, p0.lerp(p1, 0.8), p1], 0.0045, sides=8), "cart_pen", "device", sharp=60)
    finish(tube([p0.lerp(p1, 0.8), p1 + (p1 - p0).normalized() * 0.004], 0.0048, sides=8), "cart_pen_cap", "metal", sharp=60)


def build_spool(name, S, r, width, hole, filament, axis_deg=0.0):
    """A filament spool standing on its rim at local origin (floor of S), axis along local Z."""
    A = S @ T(0, r, 0) @ rotg((0, 1, 0), axis_deg) @ AX_Z @ Matrix.Translation((0, 0, -width / 2))
    fl = 0.0035
    for z0 in (0.0, width - fl):
        bm = lathe([(hole, z0), (r, z0), (r, z0 + fl), (hole, z0 + fl), (hole, z0)], segs=20)
        bm.transform(A)
        finish(bm, name + "_flange", "device", sharp=40)
    rf = r * 0.82
    bm = lathe([(hole + 0.006, fl), (rf, fl), (rf, width - fl), (hole + 0.006, width - fl), (hole + 0.006, fl)], segs=20)
    bm.transform(A)
    finish(bm, name + "_filament", filament, sharp=40)
    bm = lathe([(hole, fl), (hole + 0.006, fl), (hole + 0.006, width - fl), (hole, width - fl), (hole, fl)], segs=12)
    bm.transform(A)
    finish(bm, name + "_hub", "device_key", sharp=40)


def build_stool():
    M = place((-1.84, 0.0, -2.06), yaw=20)
    seat_y = 0.53
    bm = lathe([(0.0, seat_y), (0.150, seat_y), (0.163, seat_y + 0.006), (0.168, seat_y + 0.02), (0.162, seat_y + 0.034),
                (0.140, seat_y + 0.040), (0.0, seat_y + 0.042)], segs=24)
    bm.transform(M)
    finish(bm, "stool_seat", "furniture_top", sharp=55)
    bm = lathe([(0.0, seat_y - 0.03), (0.10, seat_y - 0.03), (0.105, seat_y - 0.02), (0.10, seat_y), (0.0, seat_y)], segs=20)
    bm.transform(M)
    finish(bm, "stool_ring", "device", sharp=50)
    for k in range(3):
        a = math.radians(90 + 120 * k)
        top = M @ G(0.085 * math.cos(a), seat_y - 0.03, 0.085 * math.sin(a))
        bot = M @ G(0.175 * math.cos(a), 0.0, 0.175 * math.sin(a))
        finish(tube([bot, top], 0.012, sides=10), "stool_leg", "metal", sharp=60)
        bm = lathe([(0.0, 0.0), (0.014, 0.0), (0.015, 0.012), (0.0, 0.014)], segs=10)
        bm.transform(Matrix.Translation(bot))
        finish(bm, "stool_foot", "device", sharp=60)
    ry = 0.21
    rr = 0.175 - (0.175 - 0.085) * ry / (seat_y - 0.03)
    ring = [M @ G(rr * math.cos(2 * math.pi * i / 18), ry, rr * math.sin(2 * math.pi * i / 18)) for i in range(18)]
    finish(tube(ring, 0.0085, sides=6, closed=True), "stool_footrest", "metal", sharp=60)


# --------------------------------------------------------------------------- #
# The blueprint (left wall)
# --------------------------------------------------------------------------- #
BP = QUADS["Text_open"]
BP_Z, BP_Y = BP["at"][2], BP["at"][1]
BP_W, BP_H = BP["size"]
WALL_LEFT = ROOM["x"][0]


def build_blueprint():
    # local frame on the left wall: front faces +X, local +x runs toward the back wall (-Z)
    M = place((WALL_LEFT, BP_Y, BP_Z), yaw=90)
    sheet = abs(BP["at"][0] - WALL_LEFT) - 0.0015   # sheet surface 1.5 mm under the quad
    mat_w = 0.075
    fr_w = 0.024
    hw, hh = BP_W / 2 + mat_w + fr_w, BP_H / 2 + mat_w + fr_w
    # backing board and the dark sheet, flat under the quad
    rbox("bp_sheet", "device", (BP_W + 0.05, BP_H + 0.05, 0.0012), (0, 0, sheet - 0.0006), bev=0, M=M, smooth=False, texel=1.8, cull=lambda n: n[0] < 0.9)
    # passe-partout with a bevelled window, 2.5 mm proud of the sheet
    mprof = [(-0.002, sheet - 0.0008), (-0.002, sheet + 0.0025), (0.0, sheet + 0.0025)]
    win_hw, win_hh = BP_W / 2 + 0.012, BP_H / 2 + 0.012
    rings = []
    outer_hw, outer_hh = hw - fr_w + 0.004, hh - fr_w + 0.004
    for (ow, oh, z) in ((outer_hw, outer_hh, sheet - 0.0008), (outer_hw, outer_hh, sheet + 0.0025),
                        (win_hw, win_hh, sheet + 0.0025), (win_hw - 0.0025, win_hh - 0.0025, sheet - 0.0002)):
        rings.append([M @ G(x, y, z) for x, y in rrect2(ow, oh, 0.0005, 1)])
    del mprof
    finish(loft(rings, closed=True), "bp_mat", "paper_dim", sharp=30, texel=1.8, cull=lambda n: n[0] < -0.9)
    # thin dark frame
    fz = sheet + 0.008
    prof = [(0.0, 0.003), (0.0, fz - 0.002), (0.002, fz), (fr_w - 0.002, fz), (fr_w, fz - 0.002), (fr_w, sheet + 0.0018),
            (fr_w - 0.006, sheet + 0.0018), (fr_w - 0.006, 0.003)]
    frame_ring("bp_frame", "device", hw, hh, 0.003, prof, M, n=2)["texel"] = 1.2
    return M


# --------------------------------------------------------------------------- #
# Under the blueprint: a sideboard and what lives on it
# --------------------------------------------------------------------------- #
SB = {"w": 1.0, "d": 0.38, "leg": 0.16, "top": 0.611}


def build_sideboard():
    d = SB["d"]
    M = place((WALL_LEFT + 0.012 + d / 2, 0.0, BP_Z), yaw=90)
    w, leg, top = SB["w"], SB["leg"], SB["top"]
    body_y0, body_y1 = leg, top - 0.022
    # carcass panels (open compartment on the right half, doors on the left)
    rbox("sb_side", "furniture", (0.02, body_y1 - body_y0, d), (-w / 2 + 0.01, (body_y0 + body_y1) / 2, 0), bev=0.003, M=M)
    rbox("sb_side", "furniture", (0.02, body_y1 - body_y0, d), (w / 2 - 0.01, (body_y0 + body_y1) / 2, 0), bev=0.003, M=M)
    rbox("sb_bottom", "furniture", (w - 0.04, 0.02, d), (0, body_y0 + 0.01, 0), bev=0.003, M=M)
    rbox("sb_back", "furniture", (w - 0.04, body_y1 - body_y0 - 0.02, 0.012), (0, (body_y0 + body_y1) / 2 + 0.01, -d / 2 + 0.006), bev=0.002, segs=1, M=M, texel=0.3, cull=lambda n: n[0] < -0.9)
    rbox("sb_divider", "furniture", (0.018, body_y1 - body_y0 - 0.02, d - 0.012), (0.0, (body_y0 + body_y1) / 2 + 0.01, 0.006), bev=0.003, M=M)
    rbox("sb_top", "furniture_top", (w + 0.012, 0.022, d + 0.012), (0, top - 0.011, 0.004), bev=0.005, M=M)
    # two doors on the left half
    dh = body_y1 - body_y0 - 0.006
    for k, (x0, x1) in enumerate(((-w / 2 + 0.003, -w / 4 - 0.0015), (-w / 4 + 0.0015, -0.012))):
        rbox("sb_door", "furniture_top", (x1 - x0, dh, 0.018), ((x0 + x1) / 2, (body_y0 + body_y1) / 2, d / 2 + 0.009), bev=0.003, M=M)
        px = x1 - 0.03 if k == 0 else x0 + 0.03
        a, b = M @ G(px, (body_y0 + body_y1) / 2 - 0.05, d / 2 + 0.024), M @ G(px, (body_y0 + body_y1) / 2 + 0.05, d / 2 + 0.024)
        a0, b0 = M @ G(px, (body_y0 + body_y1) / 2 - 0.05, d / 2 + 0.016), M @ G(px, (body_y0 + body_y1) / 2 + 0.05, d / 2 + 0.016)
        finish(tube([a0, a, b, b0], 0.005, sides=8), "sb_pull", "metal", sharp=60)
    # tapered legs
    for sx in (-1, 1):
        for sz in (-1, 1):
            lx, lz = sx * (w / 2 - 0.06), sz * (d / 2 - 0.05)
            rings = []
            for y, s in ((0.0, 0.020), (0.003, 0.022), (leg, 0.032)):
                rings.append([M @ G(lx + ax * s / 2 + sx * 0.012 * (1 - y / leg), y, lz + az * s / 2) for ax, az in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            bm = loft(rings)
            bevel(bm, 0.003, 1, angle=60)
            finish(bm, "sb_leg", "metal", drop_bottom=True, texel=0.5)
    # records standing in the open compartment
    rx = 0.012
    ry0 = body_y0 + 0.02
    shades = ["book_c", "book_a", "device_key", "book_b", "book_c", "paper_dim", "book_a", "book_c", "device_key", "book_a"]
    k = 0
    while rx < 0.30:
        t = 0.0045 + 0.0025 * ((k * 7) % 3) / 2
        h = 0.312 - 0.004 * ((k * 5) % 3)
        rbox("sb_record", shades[k % len(shades)], (t, h, 0.312), (rx + t / 2, ry0 + h / 2, -d / 2 + 0.012 + 0.16), bev=0, M=M, drop_bottom=True, smooth=False, texel=0.2)
        rx += t + 0.0004
        k += 1
    # a few records leaning against the stack
    for j in range(4):
        ang = -(14 + 4 * j)
        t = 0.005
        R = Matrix.Translation(G(rx + 0.004 + j * 0.016, ry0, -d / 2 + 0.172)) @ rotg((0, 0, 1), ang)
        rbox("sb_record_lean", shades[(k + j) % len(shades)], (t, 0.312, 0.312), (t / 2, 0.156, 0), bev=0, M=M @ R, drop_bottom=True, smooth=False, texel=0.25)
    return M


def build_sideboard_top(M):
    top = SB["top"]
    # --- a small bed-slinger 3D printer, mid-print -------------------------
    P = M @ T(0.07, top, -0.01)
    rbox("pr_base", "device", (0.25, 0.046, 0.22), (0, 0.023, 0), bev=0.008, M=P, drop_bottom=True)
    rbox("pr_screen", emissive("screen_glow", 1.2), (0.046, 0.026, 0.002), (0.06, 0.024, 0.111), bev=0, M=P, smooth=False)
    bm = lathe([(0.0, 0.0), (0.009, 0.0), (0.0095, 0.008), (0.0, 0.009)], segs=12)
    bm.transform(P @ T(0.105, 0.024, 0.110) @ AX_Z)
    finish(bm, "pr_knob", "device_key")
    rbox("pr_carriage", "device_key", (0.10, 0.012, 0.15), (0.0, 0.052, 0), bev=0.003, M=P)
    rbox("pr_bed", "metal", (0.172, 0.006, 0.172), (0.0, 0.061, 0), bev=0.002, segs=1, M=P)
    rbox("pr_sheet", "book_a", (0.164, 0.0015, 0.164), (0.0, 0.0647, 0), bev=0, M=P, smooth=False)
    bed_y = 0.0655
    # the Z column on the left, the X arm over the bed
    rbox("pr_column", "metal", (0.034, 0.30, 0.040), (-0.108, 0.046 + 0.15, -0.075), bev=0.005, M=P)
    rbox("pr_column_cap", "device", (0.044, 0.018, 0.050), (-0.108, 0.353, -0.075), bev=0.006, M=P)
    # the half-finished print: a faceted, twisted vase, open at the top
    vh = 0.050
    vx, vz = -0.022, 0.012
    prof = [(0.0, 0.0), (0.034, 0.0), (0.036, 0.016), (0.041, vh), (0.0385, vh), (0.0335, 0.016), (0.0315, 0.0025), (0.0, 0.0025)]
    bm = lathe(prof, segs=6, twist=math.radians(55) / 0.05)
    bm.transform(P @ T(vx, bed_y, vz))
    finish(bm, "pr_print", "paper", sharp=25, weighted=False)
    # print head sitting on the rim
    nx = vx + 0.039
    tip_y = bed_y + vh + 0.0012
    arm_y = tip_y + 0.075
    rbox("pr_arm", "metal", (0.215, 0.024, 0.028), (-0.004, arm_y, -0.040), bev=0.004, M=P)
    rbox("pr_head", "device_key", (0.052, 0.064, 0.046), (nx, tip_y + 0.014 + 0.032, vz - 0.004), bev=0.008, M=P)
    rbox("pr_head_face", "device", (0.040, 0.050, 0.004), (nx, tip_y + 0.014 + 0.032, vz + 0.0195), bev=0.003, M=P)
    bm = lathe([(0.0, 0.0), (0.0025, 0.0), (0.006, 0.008), (0.006, 0.014), (0.0, 0.0145)], segs=10)
    bm.transform(P @ T(nx, tip_y, vz))
    finish(bm, "pr_nozzle", "metal", sharp=50)
    # a small spool on a stub on the column's side, feeding the head through a tube
    sp_c = (-0.150, 0.255, -0.075)
    build_spool("pr_spool", P @ T(sp_c[0], sp_c[1] - 0.060, sp_c[2]) @ rotg((0, 1, 0), 90), r=0.060, width=0.040, hole=0.016, filament="paper")
    pts = [P @ G(-0.150, 0.318, -0.075), P @ G(-0.10, 0.37, -0.04), P @ G(nx - 0.01, 0.31, vz - 0.004), P @ G(nx, tip_y + 0.078, vz - 0.004)]
    finish(tube(smooth_path(pts, 5), 0.0026, sides=6), "pr_bowden", "paper_dim", sharp=70)

    # --- speaker, toed toward the room -------------------------------------
    S = M @ T(0.395, top, -0.02) @ rotg((0, 1, 0), -14)
    rbox("spk_box", "device", (0.135, 0.225, 0.175), (0, 0.1125, 0), bev=0.008, M=S, drop_bottom=True)
    cone = [(0.0, 0.003), (0.010, 0.002), (0.012, -0.004), (0.034, 0.0), (0.038, 0.003), (0.043, 0.003), (0.045, 0.0)]
    bm = lathe(cone, segs=24)
    bm.transform(S @ T(0, 0.07, 0.0875) @ AX_Z)
    finish(bm, "spk_woofer", "device_key", sharp=50)
    bm = lathe([(0.0, 0.006), (0.010, 0.003), (0.016, 0.0018), (0.020, 0.0)], segs=16)
    bm.transform(S @ T(0, 0.168, 0.0875) @ AX_Z)
    finish(bm, "spk_tweeter", "device_key", sharp=50)
    rbox("spk_led", emissive("accent", 2.0), (0.004, 0.004, 0.001), (0.05, 0.205, 0.0878), bev=0, M=S, smooth=False)

    # --- a stack of books with a small plant -------------------------------
    stack = [((0.235, 0.034, 0.168), "book_c", 3.0), ((0.215, 0.026, 0.152), "book_b", -6.0), ((0.205, 0.030, 0.140), "book_a", 2.0)]
    by = top
    for (sx, sy, sz), col, rot in stack:
        Bm = M @ T(-0.235, by, 0.005) @ rotg((0, 1, 0), rot)
        rbox("bk_pages", "paper_dim", (sx - 0.008, sy - 0.006, sz - 0.006), (0.004, sy / 2, 0), bev=0.0015, segs=1, M=Bm, drop_bottom=True)
        for yy in (0.0018, sy - 0.0018):
            rbox("bk_cover", col, (sx, 0.0036, sz), (0, yy, 0), bev=0.0012, segs=1, M=Bm)
        rbox("bk_spine", col, (0.005, sy, sz), (-sx / 2 + 0.0025, sy / 2, 0), bev=0.002, segs=1, M=Bm)
        by += sy
    build_small_plant(M @ T(-0.42, top, -0.04))


def build_small_plant(P):
    prof = [(0.0, 0.0), (0.040, 0.0), (0.044, 0.004), (0.054, 0.086), (0.056, 0.092), (0.052, 0.094), (0.048, 0.082), (0.0, 0.082)]
    bm = lathe(prof, segs=24, mat_of_seg=[0, 0, 0, 0, 0, 0, 1])
    bm.transform(P)
    finish(bm, "plant_pot", ["pot", "device"], drop_bottom=True)
    leaves = bmesh.new()
    rng = [0.11, 0.73, 0.42, 0.95, 0.27, 0.61, 0.83, 0.05, 0.5]
    n = 9
    for i in range(n):
        a = 2 * math.pi * i / n + (rng[i] - 0.5) * 0.5
        h = 0.10 + 0.09 * rng[(i + 3) % n]
        lean = 0.05 + 0.06 * rng[(i + 5) % n]
        wid = 0.024 + 0.010 * rng[(i + 1) % n]
        segs = 5
        base = Vector((0.012 * math.cos(a), 0.078, 0.012 * math.sin(a)))
        out = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a), 0, math.cos(a)))
        front, back = [], []
        for s in range(segs + 1):
            t = s / segs
            ctr = base + Vector((0, h * t, 0)) + out * (lean * t * t)
            wv = max(wid * math.sin(math.pi * min(0.15 + t * 0.85, 1.0)) * (1 - 0.6 * t), 0.0008)
            row = [ctr - side * wv / 2, ctr + out * 0.003, ctr + side * wv / 2]
            front.append([P @ G(*p) for p in row])
            back.append([P @ G(*(p - out * 0.0025)) for p in row])
        vf = [[leaves.verts.new(p) for p in row] for row in front]
        vb = [[leaves.verts.new(p) for p in row] for row in back]
        for s in range(segs):
            for k in range(2):
                leaves.faces.new((vf[s][k], vf[s][k + 1], vf[s + 1][k + 1], vf[s + 1][k]))
                leaves.faces.new((vb[s][k], vb[s + 1][k], vb[s + 1][k + 1], vb[s][k + 1]))
            leaves.faces.new((vf[s][0], vf[s + 1][0], vb[s + 1][0], vb[s][0]))
            leaves.faces.new((vf[s][2], vb[s][2], vb[s + 1][2], vf[s + 1][2]))
    bmesh.ops.remove_doubles(leaves, verts=leaves.verts, dist=1e-6)
    finish(leaves, "plant_leaves", "plant", sharp=70, weighted=False)


# --------------------------------------------------------------------------- #
# A backpack leaning on the sideboard
# --------------------------------------------------------------------------- #
def build_backpack():
    lean = 12.0
    w, h, dd = 0.30, 0.44, 0.15
    reach = h * math.sin(math.radians(lean)) + dd / 2 * math.cos(math.radians(lean))
    front_x = WALL_LEFT + 0.012 + SB["d"] + 0.018
    M = place((front_x + reach + 0.002, 0.0065, -1.56), yaw=90 - 16) @ rotg((1, 0, 0), -lean)  # lifted: the tilt sinks the back edge
    bm = bm_box((w, h, dd), (0, h / 2, 0), cuts=2)
    bevel(bm, 0.05, 2, angle=30)
    for v in bm.verts:
        p = Vector((v.co.x, v.co.z, -v.co.y))   # back to glTF local
        fx = max(0.0, 1 - (p.x / (w / 2)) ** 2)
        fy = max(0.0, 1 - ((p.y - h / 2) / (h / 2)) ** 2)
        if p.z > 0:
            p.z += 0.030 * fx * fy
        if p.y > h * 0.62:
            k = (p.y - h * 0.62) / (h * 0.38)
            p.x *= 1 - 0.18 * k * k
            p.z *= 1 - 0.25 * k * k
        v.co = G(*p)
    bm.transform(M)
    finish(bm, "bag_body", "fabric", sharp=60)
    bm = bm_box((0.22, 0.17, 0.05), (0, 0.13, dd / 2 + 0.03), cuts=1)
    bevel(bm, 0.018, 2, angle=30)
    bm.transform(M)
    finish(bm, "bag_pocket", "book_c", sharp=60)
    # top handle and the zip pull
    hp = [M @ G(-0.05, h - 0.012, -0.01), M @ G(-0.035, h + 0.03, -0.01), M @ G(0.035, h + 0.03, -0.01), M @ G(0.05, h - 0.012, -0.01)]
    finish(tube(smooth_path(hp, 4), 0.008, sides=8), "bag_handle", "book_c", sharp=70)
    rbox("bag_zip", "metal", (0.012, 0.03, 0.004), (0.07, 0.205, dd / 2 + 0.057), bev=0.0015, segs=1, M=M)
    # shoulder straps showing over the top at the back
    for sx in (-1, 1):
        sp = [M @ G(sx * 0.07, h - 0.04, -dd / 2 + 0.01), M @ G(sx * 0.075, h - 0.07, -dd / 2 - 0.02), M @ G(sx * 0.09, h * 0.45, -dd / 2 - 0.03),
              M @ G(sx * 0.11, 0.05, -dd / 2 + 0.005)]
        bm = tube(smooth_path(sp, 4), 0.012, sides=8)
        finish(bm, "bag_strap", "book_c", sharp=70)


# --------------------------------------------------------------------------- #
# A tall snake plant in the very corner. Its sword leaves stand upright, so it
# fits the narrow gap between the whiteboard and the blueprint and stays out of
# the sight lines from the `whiteboard` and `blueprint` cameras to their quads.
# --------------------------------------------------------------------------- #
CORNER_PLANT = (-3.455, -2.545)


def _clear_of_quads(x, z, margin=0.07):
    """True if (x, z) lies left of the whiteboard camera's ray to the quad's
    left edge and behind the blueprint camera's ray to its quad's right edge."""
    cam, q = CAMERAS["whiteboard"][0], QUADS["Text_install"]
    ex, ez = q["at"][0] - q["size"][0] / 2, q["at"][2]
    t = (cam[2] - z) / (cam[2] - ez)
    ok_wb = x < cam[0] + (ex - cam[0]) * t - margin
    cam, q = CAMERAS["blueprint"][0], QUADS["Text_open"]
    ex, ez = q["at"][0], q["at"][2] - q["size"][0] / 2
    t = (cam[0] - x) / (cam[0] - ex)
    ok_bp = z < cam[2] + (ez - cam[2]) * t - margin
    return ok_wb and ok_bp


def build_corner_plant():
    cx, cz = CORNER_PLANT
    # a tall, straight-sided pot on three short feet
    ph = 0.36
    prof = [(0.0, 0.03), (0.105, 0.03), (0.112, 0.036), (0.118, ph - 0.012), (0.121, ph - 0.004), (0.118, ph),
            (0.110, ph), (0.108, ph - 0.03), (0.0, ph - 0.03)]
    bm = lathe(prof, segs=24, mat_of_seg=[0, 0, 0, 0, 0, 0, 0, 1])
    bm.transform(Matrix.Translation(G(cx, 0, cz)))
    finish(bm, "cp_pot", ["pot", "device"], sharp=50)
    for k in range(3):
        a = math.radians(45 + 120 * k)
        rbox("cp_foot", "device", (0.03, 0.032, 0.03), (cx + 0.08 * math.cos(a), 0.016, cz + 0.08 * math.sin(a)), bev=0.006, drop_bottom=True)
    # sword leaves
    rnd = [0.62, 0.13, 0.88, 0.41, 0.27, 0.95, 0.54, 0.08, 0.71, 0.36, 0.83, 0.19, 0.47]
    leaves = bmesh.new()
    n = 13
    soil = ph - 0.03
    for i in range(n):
        r1, r2, r3 = rnd[i], rnd[(i + 4) % n], rnd[(i + 9) % n]
        a = 2 * math.pi * i / n + r1 * 0.6
        bx, bz = cx + 0.065 * r2 * math.cos(a), cz + 0.065 * r2 * math.sin(a)
        h = 0.62 + 0.62 * r3 if i % 3 else 0.50 + 0.30 * r3
        # lean mostly into the corner and along the walls
        la = math.radians(180 + 90 * r1 + (-25 if i % 2 else 25))
        lean = 0.04 + 0.10 * r2
        wid = 0.050 + 0.022 * r1
        face = a + math.pi / 2 + (r3 - 0.5) * 1.2
        twist = (r2 - 0.5) * 0.9
        segs = 6
        rows_f, rows_b = [], []
        for s_ in range(segs + 1):
            t = s_ / segs
            px = bx + math.cos(la) * lean * t ** 1.6
            pz = bz + math.sin(la) * lean * t ** 1.6
            # keep the leaf behind both cameras' sight lines
            for _ in range(20):
                if _clear_of_quads(px, pz):
                    break
                px -= 0.01
                pz -= 0.01
            py = soil + h * t
            wv = wid * (0.55 + 0.45 * math.sin(math.pi * min(0.25 + t, 1.0))) * (1.0 - t ** 3) + 0.0015
            # and off the walls and the whiteboard's frame
            px = max(px, WALL_LEFT + 0.012 + wv / 2)
            pz = max(pz, (WALL_BACK + 0.012 if px < WB_X - WB_HW - 0.01 else WALL_BACK + 0.058) + wv / 2)
            fa = face + twist * t
            sx, sz = math.cos(fa), math.sin(fa)
            nx_, nz_ = -sz, sx
            fold = 0.006 * (1 - t)
            row = [(px - sx * wv / 2, py, pz - sz * wv / 2), (px + nx_ * fold, py, pz + nz_ * fold), (px + sx * wv / 2, py, pz + sz * wv / 2)]
            rows_f.append([G(*p) for p in row])
            rows_b.append([G(p[0] - nx_ * 0.003, p[1], p[2] - nz_ * 0.003) for p in row])
        vf = [[leaves.verts.new(p) for p in row] for row in rows_f]
        vb = [[leaves.verts.new(p) for p in row] for row in rows_b]
        for s_ in range(segs):
            for k in range(2):
                leaves.faces.new((vf[s_][k], vf[s_][k + 1], vf[s_ + 1][k + 1], vf[s_ + 1][k]))
                leaves.faces.new((vb[s_][k], vb[s_ + 1][k], vb[s_ + 1][k + 1], vb[s_][k + 1]))
            leaves.faces.new((vf[s_][0], vf[s_ + 1][0], vb[s_ + 1][0], vb[s_][0]))
            leaves.faces.new((vf[s_][2], vb[s_][2], vb[s_ + 1][2], vf[s_ + 1][2]))
        leaves.faces.new((vf[segs][0], vf[segs][1], vf[segs][2], vb[segs][2], vb[segs][1], vb[segs][0]))
    bmesh.ops.remove_doubles(leaves, verts=leaves.verts, dist=1e-6)
    finish(leaves, "cp_leaves", "plant", sharp=60, weighted=False)


# --------------------------------------------------------------------------- #
# Quads
# --------------------------------------------------------------------------- #
def make_quad(name):
    return common.make_quad(name)


# --------------------------------------------------------------------------- #
# build()
# --------------------------------------------------------------------------- #
def build():
    build_whiteboard()
    build_cart()
    build_stool()
    M = build_blueprint()
    del M
    Ms = build_sideboard()
    build_sideboard_top(Ms)
    build_backpack()
    build_corner_plant()
    make_quad("Text_install")
    make_quad("Text_open")


def tri_count():
    n = 0
    per = {}
    for ob in CREATED:
        k = ob.name.split("_")[0]
        c = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        per[k] = per.get(k, 0) + c
        n += c
    print("triangles by part:", sorted(per.items(), key=lambda kv: -kv[1]), flush=True)
    return n


# Close-up cameras for judging the props while modelling (`-- --skip-bake --detail
# --cameras corner_close,printer,...`); added to the in-memory camera table only.
DETAIL_CAMS = {
    "corner_close": ((-2.2, 1.25, -1.1), (-3.2, 0.75, -2.3), 50),
    "sideboard": ((-2.3, 1.15, -1.65), (-3.45, 0.75, -1.95), 50),
    "printer": ((-2.85, 1.02, -1.70), (-3.41, 0.76, -1.95), 34),
    "cart": ((-2.30, 1.10, -1.55), (-2.62, 0.62, -2.50), 44),
    "floor": ((-2.0, 0.75, -0.95), (-3.1, 0.3, -1.9), 55),
}

if __name__ == "__main__":
    if "--detail" in sys.argv:
        CAMERAS.update(DETAIL_CAMS)
    common.run_zone("corner", build, cameras=["whiteboard", "blueprint", "finale"])
