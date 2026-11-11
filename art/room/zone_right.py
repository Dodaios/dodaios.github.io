# ruff: noqa: E501
"""Zone `right`: the agents wall on the right wall (x = 3.6) and the back-right corner.

Six wall displays around the quads Wall_1 .. Wall_6 on a slatted acoustic panel with
two mounting rails per row, a slim ledge under each row with one agent creature per
screen, a low open rack under the lower row (NAS, router, power strip, books, boxes,
a tool case), a tall open shelf in the back-right corner, a floor speaker and a floor
plant in the front-right corner.

Run (with common.py in place):
  blender --background --factory-startup --python zone_right.py -- [--skip-bake] [--samples N]
Standalone modelling previews (throwaway lights, no bake):
  blender --background --factory-startup --python zone_right.py -- --standalone

All positions are glTF / three.js (X right, Y up, Z toward the viewer), converted with G().
"""

import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from spec import CAMERAS, LIGHTS, PALETTE, QUADS, ROOM  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STANDALONE = "--standalone" in ARGS
common = None
if not STANDALONE:
    import common  # noqa: E402

T0 = time.time()


def log(*a):
    print(f"[right {time.time() - T0:6.1f}s]", *a, flush=True)


# --------------------------------------------------------------------------- #
# Small maths helpers
# --------------------------------------------------------------------------- #
def G(x, y, z):
    """glTF (Y up, Z toward viewer) -> Blender (Z up)."""
    return Vector((x, -z, y))


def TG(x, y, z):
    return Matrix.Translation(G(x, y, z))


def T(x, y, z):
    """Translation in Blender space."""
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    """Rotation in Blender space."""
    return Matrix.Rotation(math.radians(deg), 4, axis)


def YAW(deg):
    """glTF yaw (about the vertical axis; 0 faces +Z, 90 faces +X)."""
    return R("Z", deg)


def srgb2lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb2lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


# --------------------------------------------------------------------------- #
# Materials: common's once it is ready, throwaway ones before
# --------------------------------------------------------------------------- #
_MATS = {}


def mat(key):
    if key.startswith("emis:"):
        _, k, s = key.split(":")
        return emissive(k, float(s))
    if common is not None:
        return common.mat(key)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new("tmp_" + key)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (*hexcol(PALETTE[key]), 1.0)
    p.inputs["Roughness"].default_value = 0.9
    p.inputs["Specular IOR Level"].default_value = 0.2
    _MATS[key] = m
    return m


def emissive(key, strength):
    if common is not None:
        return common.emissive(key, strength)
    name = f"tmp_emis_{key}_{strength:g}"
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (0.02, 0.02, 0.02, 1.0)
    p.inputs["Emission Color"].default_value = (*hexcol(PALETTE[key]), 1.0)
    p.inputs["Emission Strength"].default_value = strength
    _MATS[name] = m
    return m


# --------------------------------------------------------------------------- #
# Mesh helpers (bmesh, Blender space)
# --------------------------------------------------------------------------- #
PARTS = {}  # (material key, texel weight) -> list of bmesh
TEXEL = [1.0]  # lightmap density weight for what is added now (common: 0.3 unseen .. 2 close-ups)


def texel(w):
    TEXEL[0] = w


def add(bm, key):
    PARTS.setdefault((key, TEXEL[0]), []).append(bm)


def bevel(bm, width, segs=2, angle=30.0, only=None):
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(angle)]
    if only:
        edges = [e for e in edges if only(e)]
    if edges and width > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs, profile=0.5,
                        affect="EDGES", clamp_overlap=True)


def bm_box(size):
    """Box centred at the origin; size in glTF axes (x, y up, z depth)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    return bm


def _vertical(e):
    d = e.verts[1].co - e.verts[0].co
    return abs(d.z) > 0.9 * d.length


def emit_quad(key, size, center, facing=-1):
    """An LED as one quad (one lightmap island): the box's thinnest axis gives the facing
    direction, `facing` its sign (-1: toward the room / downward)."""
    ax = min(range(3), key=lambda i: size[i])
    o = [i for i in range(3) if i != ax]
    corners = []
    for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p = list(center)
        p[ax] += facing * size[ax] / 2
        p[o[0]] += a * size[o[0]] / 2
        p[o[1]] += b * size[o[1]] / 2
        corners.append(G(*p))
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(c) for c in corners])
    want = [0.0, 0.0, 0.0]
    want[ax] = float(facing)
    f.normal_update()
    if f.normal.dot(G(*want)) < 0:
        f.normal_flip()
    add(bm, key)


def box(key, size, center, bev=0.004, segs=1, xf=None, drop_bottom=False, vonly=False, facing=-1):
    """Bevelled box. size and center in glTF; xf an extra Blender matrix applied about the centre.
    vonly: bevel only the vertical edges (cheap, for slats, books, far things).
    Emissive keys without an extra transform become a single facing quad (see emit_quad)."""
    if key.startswith("emis:") and xf is None:
        emit_quad(key, size, center, facing)
        return None
    bm = bm_box(size)
    bevel(bm, min(bev, min(size) * 0.45), segs, only=_vertical if vonly else None)
    m = TG(*center) @ (xf if xf is not None else Matrix.Identity(4))
    bm.transform(m)
    if drop_bottom:
        _drop_bottom(bm)
    add(bm, key)
    return bm


def box_m(key, size, m, bev=0.004, segs=1, vonly=False):
    bm = bm_box(size)
    bevel(bm, min(bev, min(size) * 0.45), segs, only=_vertical if vonly else None)
    bm.transform(m)
    add(bm, key)


def _drop_bottom(bm):
    zmin = min(v.co.z for v in bm.verts)
    kill = [f for f in bm.faces if f.normal.z < -0.99 and all(abs(v.co.z - zmin) < 1e-4 for v in f.verts)]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="FACES")


def loft(rings, cap_start=True, cap_end=True):
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vr[:-1], vr[1:], strict=True):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_start:
        bm.faces.new(list(reversed(vr[0])))
    if cap_end:
        bm.faces.new(vr[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def lathe(profile, segs=24):
    """profile: (r, h) along the surface, revolved about local +Z; r == 0 is a pole."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        if r <= 1e-7:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), h))
                          for i in range(segs)])
    for a, b in zip(rings[:-1], rings[1:], strict=True):
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def ellipsoid(rx, ry, rz, n=12, rings=7):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=n, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * rx, v.co.y * ry, v.co.z * rz))
    return bm


def cyl(r, h, segs=16, bev=0.0):
    """Cylinder along +Z from 0 to h, optionally with a small chamfer."""
    if bev > 0:
        prof = [(0, 0), (r - bev, 0), (r, bev), (r, h - bev), (r - bev, h), (0, h)]
    else:
        prof = [(0, 0), (r, 0), (r, h), (0, h)]
    return lathe(prof, segs)


def tube(path, r, sides=8, caps=True):
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
        rings.append([path[i] + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r
                      for k in range(sides)])
    return loft(rings, caps, caps)


def xf(bm, m):
    bm.transform(m)
    return bm


def finish(bm, name, key):
    if not key.startswith("emis:"):   # LED quads are single faces, oriented on purpose
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat(key))
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(40.0))
    mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    mod.mode = "FACE_AREA"
    mod.weight = 80
    mod.keep_sharp = True
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me2 = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear()
    ob.data = me2
    bpy.data.meshes.remove(me)
    me2.name = name
    return ob


HIDDEN_TEXEL = 0.03
CAM_POS = [G(*c[0]) for c in CAMERAS.values()]


def _face_backfacing(f):
    """Back-facing to every spec camera position with a 5 cm margin, and so to every point
    of the convex hull of the stations the site's camera flies between."""
    p = f.calc_center_median()
    n = f.normal
    return all((c - p).dot(n) < -0.05 for c in CAM_POS)


def _face_occluded(f):
    """Entirely on the wall side behind a display housing (seen by no camera)."""
    for v in f.verts:
        gx, gy, gz = v.co.x, v.co.z, -v.co.y
        if gx < 3.512:
            return False
        if not any(abs(gz - col) < QW / 2 - 0.04 and abs(gy - row) < QH / 2 - 0.04 for row in ROWS for col in COLS):
            return False
    return True


def flush():
    objs = []
    n_hidden = 0
    n_deleted = [0]
    for (key, tw), bms in PARTS.items():
        dst = bmesh.new()
        for b in bms:
            tmp = bpy.data.meshes.new("tmp")
            b.to_mesh(tmp)
            b.free()
            dst.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
        if not key.startswith("emis:"):
            bmesh.ops.recalc_face_normals(dst, faces=dst.faces)
        # faces no camera can see from any station are deleted (fewer lightmap islands); emitters
        # (they light the wall with their back) and the creatures (close-ups) keep every face
        if not key.startswith("emis:") and tw < 2.0:
            kill = [f for f in dst.faces if _face_backfacing(f)]
            n_deleted[0] += len(kill)
            bmesh.ops.delete(dst, geom=kill, context="FACES")
        hidden = [_face_occluded(f) for f in dst.faces]
        n_hidden += sum(hidden)
        name = f"R_{key.replace(':', '_')}_t{tw:g}"
        if any(hidden) and not all(hidden):
            hid = dst.copy()
            hid.faces.ensure_lookup_table()
            bmesh.ops.delete(hid, geom=[f for f, h in zip(hid.faces, hidden, strict=True) if not h], context="FACES")
            dst.faces.ensure_lookup_table()
            bmesh.ops.delete(dst, geom=[f for f, h in zip(dst.faces, hidden, strict=True) if h], context="FACES")
            ob = finish(hid, name + "_hidden", key)
            ob["texel"] = HIDDEN_TEXEL
            objs.append(ob)
        ob = finish(dst, name, key)
        ob["texel"] = HIDDEN_TEXEL if all(hidden) else tw
        objs.append(ob)
    log(f"faces deleted (back-facing to every camera): {n_deleted[0]}; occluded faces (low lightmap density): {n_hidden}")
    PARTS.clear()
    TEXEL[0] = 1.0
    return objs


# --------------------------------------------------------------------------- #
# Layout numbers
# --------------------------------------------------------------------------- #
WX = ROOM["x"][1]          # 3.6, the right wall
QX = 3.50                  # screen plane
ROWS = (1.93, 1.30)        # top, bottom row centres
COLS = (-1.0, 0.0, 1.0)
QW, QH = 0.80, 0.50
BEZ = 0.014
PANEL = dict(z0=-1.62, z1=1.62, y0=0.98, y1=2.27)
BIAS = "emis:screen_glow:6"  # bias-light strips behind the displays
TOP_LEDGE_Y = 1.574        # top surface of the ledge between the rows
LOW_LEDGE_Y = 0.900        # top surface of the ledge under the lower row
RACK = dict(x0=3.16, x1=3.585, z0=-1.52, z1=1.52, top=0.60)


# --------------------------------------------------------------------------- #
# The wall installation
# --------------------------------------------------------------------------- #
def build_panel():
    p = PANEL
    h = p["y1"] - p["y0"]
    yc = (p["y0"] + p["y1"]) / 2
    # backing board (dark, the gaps between slats read as shadow lines)
    texel(0.4)
    box("wall_trim", (0.014, h + 0.02, p["z1"] - p["z0"] + 0.02), (WX - 0.007, yc, 0.0), bev=0.004)
    texel(1.0)
    # vertical slats (wide enough to keep a few lightmap texels each)
    pitch, sw, sd = 0.075, 0.05, 0.03
    n = int(round((p["z1"] - p["z0"] - sw) / pitch)) + 1
    span = (n - 1) * pitch
    for i in range(n):
        z = -span / 2 + i * pitch
        box("furniture_top", (sd, h, sw), (WX - 0.014 - sd / 2, yc, z), bev=0.006, segs=1, vonly=True)
    return WX - 0.014 - sd  # front face of the slats


def build_displays(slat_front):
    rail_d = 0.016
    rail_x = slat_front - rail_d / 2
    for row in ROWS:
        # two mounting rails per row, across the whole panel
        for dy in (-0.12, 0.12):
            box("metal", (rail_d, 0.034, PANEL["z1"] - PANEL["z0"] - 0.06), (rail_x, row + dy, 0.0), bev=0.004)
            for z in (PANEL["z0"] + 0.05, PANEL["z1"] - 0.05):   # end caps
                box("device", (rail_d + 0.004, 0.04, 0.02), (rail_x - 0.002, row + dy, z), bev=0.004)
        for col in COLS:
            hx0 = QX + 0.0015            # housing front, the quad floats 1.5 mm in front
            hd = 0.022
            box("device", (hd, QH + 2 * BEZ, QW + 2 * BEZ), (hx0 + hd / 2, row, col), bev=0.006, segs=2)
            # back hump and VESA plate
            box("device", (0.014, 0.30, 0.46), (hx0 + hd + 0.006, row - 0.01, col), bev=0.006, segs=1)
            texel(0.2)
            for dy in (-0.12, 0.12):    # hooks onto the rails (hidden behind the housing: plain)
                box("metal", (slat_front - rail_d - (hx0 + hd + 0.013) + 0.002, 0.05, 0.05),
                    ((slat_front - rail_d + hx0 + hd + 0.013) / 2, row + dy, col), bev=0.0)
            texel(1.0)
            # bias lighting: a thin neutral LED frame on the back of the housing, facing the wall,
            # so every display sits in a soft halo on the slats (hidden from the cameras)
            bx = hx0 + hd + 0.0015
            iz, iy = QW / 2 + BEZ - 0.05, QH / 2 + BEZ - 0.05
            for zz in (-iz, iz):
                box(BIAS, (0.003, 2 * iy, 0.012), (bx, row, col + zz), bev=0.0, facing=1)
            for yy in (-iy, iy):
                box(BIAS, (0.003, 0.012, 2 * iz), (bx, row + yy, col), bev=0.0, facing=1)
            # tiny power LED on the lower bezel, right
            box("emis:accent:6", (0.003, 0.0035, 0.010), (hx0 - 0.001, row - QH / 2 - BEZ / 2, col + QW / 2 - 0.03),
                bev=0.0)


def build_ledges():
    # top ledge, in the gap between the rows, in front of the lower housings
    t = 0.018
    y = TOP_LEDGE_Y - t / 2
    box("furniture_top", (0.142, t, PANEL["z1"] - PANEL["z0"]), (3.355 + 0.071, y, 0.0), bev=0.005)
    for z in (-1.5, -0.5, 0.5, 1.5):
        # tongue through the gap back to the slats, and a bracket below
        box("furniture_top", (0.07, t, 0.06), (3.53, y, z), bev=0.004)
        bm = bmesh.new()
        pts = [(3.555, TOP_LEDGE_Y - t), (3.42, TOP_LEDGE_Y - t), (3.555, TOP_LEDGE_Y - t - 0.07)]
        vs = [bm.verts.new(G(px, py, z - 0.004)) for px, py in pts]
        bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008)
        bevel(bm, 0.0015, 1)
        add(bm, "metal")
    # lower ledge under the lower row, on the wall
    y = LOW_LEDGE_Y - t / 2
    box("furniture_top", (0.24, t, 3.1), (WX - 0.12, y, 0.0), bev=0.005)
    for z in (-1.35, -0.5, 0.5, 1.35):
        bm = bmesh.new()
        pts = [(WX, LOW_LEDGE_Y - t), (3.40, LOW_LEDGE_Y - t), (WX, LOW_LEDGE_Y - t - 0.09)]
        vs = [bm.verts.new(G(px, py, z - 0.004)) for px, py in pts]
        bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.008)
        bevel(bm, 0.0015, 1)
        add(bm, "metal")
    # a thin LED line under the lower ledge's front edge: a faint blue wash on the rack
    box("device", (0.012, 0.006, 3.0), (3.372, LOW_LEDGE_Y - t - 0.003, 0.0), bev=0.002, segs=1)
    box("emis:accent:3", (0.006, 0.002, 2.96), (3.372, LOW_LEDGE_Y - t - 0.0065, 0.0), bev=0.0)
    # a small succulent at the free right end of the top ledge
    sx_, sz_ = 3.44, 1.53
    pot = lathe([(0, 0), (0.026, 0), (0.028, 0.003), (0.031, 0.05), (0.033, 0.053), (0.03, 0.055), (0.028, 0.046), (0, 0.046)], 18)
    pot.transform(TG(sx_, TOP_LEDGE_Y, sz_))
    add(pot, "pot")
    for ring, (n, r, tilt, ln) in enumerate(((7, 0.012, -55, 0.022), (5, 0.006, -30, 0.018))):
        for k in range(n):
            a = 360.0 * k / n + ring * 30
            m = TG(sx_, TOP_LEDGE_Y + 0.05 + ring * 0.006, sz_) @ YAW(a) @ T(0, -r, 0) @ R("X", tilt)
            add(xf(flat_leaf(0.010, ln, cup=0.003, n=7), m @ T(0, -ln * 0.8, 0)), "plant")


def build_trunking():
    # one tidy duct: along the panel bottom, then down the wall right of the rack to the floor
    d = 0.022
    box("wall_trim", (d, 0.04, PANEL["z1"] - PANEL["z0"] + 0.12), (WX - d / 2, PANEL["y0"] - 0.03, 0.06), bev=0.004)
    box("wall_trim", (d, PANEL["y0"] - 0.01, 0.06), (WX - d / 2, (PANEL["y0"] - 0.01) / 2, PANEL["z1"] + 0.07), bev=0.004)
    # wall socket at the foot of the duct
    box("paper_dim", (0.012, 0.08, 0.08), (WX - 0.006, 0.25, PANEL["z1"] + 0.17), bev=0.006)


# --------------------------------------------------------------------------- #
# The agent creatures
# --------------------------------------------------------------------------- #
def body_profile():
    prof = []
    zc, hh, steps = 0.075, 0.066, 12
    for i in range(steps + 1):
        th = -math.pi / 2 + math.pi * i / steps
        s = math.sin(th)
        rr = 0.052 * (1.0 - 0.10 * s)
        p = 0.62 if s < 0 else 1.0
        r = 0.0 if i in (0, steps) else rr * (math.cos(th) ** p)
        prof.append((r, zc + hh * s))
    return prof


def body_radius_at(z):
    prof = body_profile()
    for (r0, z0), (r1, z1) in zip(prof, prof[1:], strict=False):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return r0 + (r1 - r0) * t
    return 0.0


def creature(color, at, yaw, roll=0.0, pitch=0.0, gaze=0.0, look_up=0.0, prop=None, arms="down"):
    """One agent. Local Blender space: base centre at the origin, facing -Y, Z up.

    at: glTF floor point; yaw: glTF yaw (-90 faces the room from the right wall)."""
    world = TG(*at) @ YAW(yaw)
    pose = T(0, 0, 0.02) @ R("Y", roll) @ R("X", pitch) @ T(0, 0, -0.02)
    W = world @ pose
    add(xf(lathe(body_profile(), 22), W), color)
    for sx in (-1, 1):   # stubby feet, planted
        add(xf(ellipsoid(0.016, 0.022, 0.010, n=10, rings=5), world @ T(sx * 0.025, -0.014, 0.010)), color)
    # arms
    arm = {"down": [(-1, 25.0, 0.0), (1, 25.0, 0.0)]}.get(arms)
    if arms == "wave":
        add(xf(ellipsoid(0.010, 0.011, 0.016, n=10, rings=6), W @ T(-0.052, -0.006, 0.052) @ R("Y", -25)), color)
        add(xf(ellipsoid(0.010, 0.011, 0.022, n=10, rings=6), W @ T(0.060, -0.004, 0.096) @ R("Y", 38)), color)
    elif arms == "front":   # both hands to the front, holding something
        for sx in (-1, 1):
            add(xf(ellipsoid(0.010, 0.016, 0.011, n=10, rings=6), W @ T(sx * 0.040, -0.038, 0.050) @ R("Z", sx * 25)), color)
    elif arms == "one_front":
        add(xf(ellipsoid(0.010, 0.011, 0.016, n=10, rings=6), W @ T(-0.052, -0.006, 0.052) @ R("Y", -25)), color)
        add(xf(ellipsoid(0.010, 0.016, 0.011, n=10, rings=6), W @ T(0.042, -0.036, 0.054) @ R("Z", 25)), color)
    elif arms == "up_side":  # one arm raised a little to the side, holding a tool
        add(xf(ellipsoid(0.010, 0.011, 0.016, n=10, rings=6), W @ T(-0.052, -0.006, 0.052) @ R("Y", -25)), color)
        add(xf(ellipsoid(0.010, 0.011, 0.018, n=10, rings=6), W @ T(0.058, -0.012, 0.070) @ R("Y", 60)), color)
    else:
        for sx, a, _ in arm:
            add(xf(ellipsoid(0.010, 0.011, 0.016, n=10, rings=6), W @ T(sx * 0.052, -0.006, 0.052) @ R("Y", sx * a)), color)
    # eyes: two dark dots on the surface
    ez, ex = 0.090 + look_up * 0.004, 0.019
    r = body_radius_at(ez)
    ey = -math.sqrt(max(r * r - ex * ex, 1e-6)) + 0.0016
    for sx in (-1, 1):
        yawe = math.degrees(math.asin(sx * ex / r))
        m = W @ R("Z", gaze) @ T(sx * ex, ey, ez) @ R("Z", yawe) @ R("X", -10 - look_up * 6)
        add(xf(ellipsoid(0.0068, 0.0035, 0.0094, n=8, rings=5), m), "device")
    # props
    if prop == "sprout":
        top = Vector((0, 0, 0.140))
        add(xf(tube([top - Vector((0, 0, 0.004)), top + Vector((0.002, 0, 0.014)), top + Vector((0.005, 0.001, 0.028))], 0.0026, sides=6), W), "plant")
        for s in (-1, 1):
            m = W @ T(0.005 + s * 0.012, 0.001, 0.168 + (0.003 if s > 0 else 0)) @ R("Y", s * 32) @ R("X", 10)
            add(xf(ellipsoid(0.015, 0.003, 0.0085, n=10, rings=5), m), "plant")
    elif prop == "headphones":
        c = 0.094
        pts = [Vector((0.050 * math.cos(t), 0.004, c + 0.052 * math.sin(t))) for t in np.linspace(0.0, math.pi, 13)]
        add(xf(tube(pts, 0.0042, sides=8), W), "metal")
        for sx in (-1, 1):
            m = W @ T(sx * 0.047, 0.004, c - 0.004) @ R("Y", sx * 90)
            add(xf(cyl(0.017, 0.014, segs=14, bev=0.003), m), "metal")
            add(xf(cyl(0.0095, 0.004, segs=10), m @ T(0, 0, 0.0125)), "device_key")
    elif prop == "mug":
        m = W @ T(0.032, -0.060, 0.040)
        add(xf(lathe([(0, 0), (0.010, 0), (0.0115, 0.002), (0.0115, 0.020), (0.0095, 0.020), (0.0095, 0.017), (0, 0.017)], 14), m), "paper")
        hp = [Vector((0.0105 + 0.006 * math.cos(t), 0, 0.010 + 0.006 * math.sin(t))) for t in np.linspace(-1.4, 1.4, 7)]
        add(xf(tube(hp, 0.0018, sides=6), m @ R("Z", 180)), "paper")
    elif prop == "book":
        base = W @ T(0, -0.062, 0.052) @ R("X", 35)
        for s in (-1, 1):
            add(xf(bm_box((0.034, 0.003, 0.046)), base @ R("Y", s * 18) @ T(s * 0.017, 0, 0)), "book_b")
            add(xf(bm_box((0.031, 0.004, 0.042)), base @ R("Y", s * 18) @ T(s * 0.016, 0.003, 0.003)), "paper")
    elif prop == "wrench":
        m = W @ T(0.074, -0.020, 0.086) @ R("Y", 30)
        add(xf(tube([Vector((0, 0, -0.016)), Vector((0, 0, 0.024))], 0.0032, sides=6), m), "metal")
        ring = [Vector((0.0075 * math.cos(t), 0.0, 0.032 + 0.0075 * math.sin(t))) for t in np.linspace(-0.9, math.pi + 0.9, 12)]
        add(xf(tube(ring, 0.0026, sides=6), m), "metal")
    elif prop == "cup_and_note":
        pass


def build_creatures():
    # Top row: on the ledge between the rows, at the lower-left corner of each screen
    # (in the gap between the housings, so they never cover a screen).
    ly = TOP_LEDGE_Y
    cx = 3.44
    creature("agent_violet", (cx, ly, -1.505), -70.0, roll=4, arms="wave", gaze=-8)
    creature("agent_orange", (cx, ly, -0.472), -62.0, roll=-3, prop="sprout", look_up=1.5)
    creature("agent_sky", (cx, ly, 0.502), -66.0, roll=2, pitch=-4, prop="headphones")
    # Bottom row: on the lower ledge, centred under each screen.
    ly = LOW_LEDGE_Y
    creature("agent_lime", (cx, ly, -1.0), -100.0, arms="one_front", prop="mug", gaze=6)
    creature("agent_rose", (cx, ly, 0.0), -84.0, pitch=8, arms="front", prop="book", look_up=-2.0)
    creature("agent_teal", (cx, ly, 1.0), -76.0, roll=-5, arms="up_side", prop="wrench", look_up=1.0)


# --------------------------------------------------------------------------- #
# The low rack under the lower row
# --------------------------------------------------------------------------- #
def book(key, t, h, d, base, m_extra=None, drop=()):
    """A book standing on `base` (glTF point), size (t, h, d) along glTF x, y, z.
    drop: glTF unit directions whose faces are removed (sides hidden by a taller neighbour)."""
    m = TG(*base) @ (m_extra if m_extra is not None else Matrix.Identity(4)) @ TG(0, h / 2, 0)
    bm = bm_box((t, h, d))
    bevel(bm, 0.0035, 1, only=_vertical)
    bm.transform(m)
    if drop:
        dirs = [G(*dv) for dv in drop]
        kill = [f for f in bm.faces if any(f.normal.dot(dv) > 0.95 for dv in dirs)]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    add(bm, key)


def _row_drops(hs, i, axis):
    """Side faces of book i hidden by neighbours at least as tall (axis 0 = x, 2 = z)."""
    out = []
    for s, j in ((-1, i - 1), (1, i + 1)):
        if 0 <= j < len(hs) and hs[j] >= hs[i] - 1e-6:
            v = [0, 0, 0]
            v[axis] = s
            out.append(tuple(v))
    return out


def book_row_z(x_c, y, z0, z1, depth, rng, keys=("book_a", "book_b", "book_c"), hmin=0.17, hmax=0.23, lean_end=True):
    """Books along Z (rack, spines flush at the front, facing -X)."""
    z = z0
    row = []
    while True:
        t = float(rng.uniform(0.018, 0.04))
        if z + t > z1:
            break
        h = float(rng.uniform(hmin, hmax))
        d = depth * float(rng.uniform(0.85, 1.0))
        k = keys[int(rng.integers(len(keys)))]
        row.append((k, t, h, d, z + t / 2))
        z += t + 0.001
    hs = [r[2] for r in row]
    for i, (k, t, h, d, zc) in enumerate(row):
        book(k, d, h, t, (x_c - (depth - d) / 2, y, zc), drop=_row_drops(hs, i, 2))
    return z


def build_rack():
    r = RACK
    x0, x1, z0, z1, top = r["x0"], r["x1"], r["z0"], r["z1"], r["top"]
    dx, xc = x1 - x0, (x0 + x1) / 2
    leg = 0.07
    tb = 0.025
    box("furniture_top", (dx + 0.01, tb, z1 - z0 + 0.01), (xc - 0.005, top - tb / 2, 0.0), bev=0.006, segs=3)
    box("furniture", (dx, 0.022, z1 - z0 - 0.04), (xc, leg + 0.011, 0.0), bev=0.004)
    box("furniture", (dx - 0.02, 0.02, z1 - z0 - 0.04), (xc + 0.01, 0.335, 0.0), bev=0.004)
    for z in (z0 + 0.012, z1 - 0.012):
        box("furniture", (dx, top - tb - leg, 0.024), (xc, (top - tb + leg) / 2, z), bev=0.004)
    for z in (-0.5, 0.5):
        box("furniture", (dx - 0.02, top - tb - leg - 0.022, 0.02), (xc + 0.01, (top - tb + leg + 0.022) / 2, z), bev=0.003)
    box("furniture", (0.012, top - tb - leg, z1 - z0 - 0.03), (x1 - 0.006, (top - tb + leg) / 2, 0.0), bev=0.003)
    for x in (x0 + 0.04, x1 - 0.04):
        for z in (z0 + 0.04, z1 - 0.04):
            bm = cyl(0.016, leg, segs=12, bev=0.003)
            bm.transform(TG(x, 0.0, z))
            add(bm, "metal")
    rng = np.random.default_rng(11)
    in_y0, mid_y = leg + 0.022, 0.345
    # bay left (z -1.5 .. -0.5): tool case below, books above
    tc = (0.30, 0.13, 0.44)
    box("device", tc, (xc - 0.02, in_y0 + tc[1] / 2, -1.0), bev=0.012, segs=2)
    box("metal", (0.008, 0.012, 0.44), (xc - 0.02 - 0.152, in_y0 + 0.07, -1.0), bev=0.003)   # seam
    for z in (-1.15, -0.85):
        box("metal", (0.012, 0.03, 0.03), (xc - 0.02 - 0.153, in_y0 + 0.075, z), bev=0.004)   # latches
    hp = [G(xc - 0.175, in_y0 + 0.05, -1.07), G(xc - 0.20, in_y0 + 0.05, -1.05), G(xc - 0.20, in_y0 + 0.05, -0.95), G(xc - 0.175, in_y0 + 0.05, -0.93)]
    add(tube(hp, 0.007, sides=8), "device_key")
    zend = book_row_z(xc - 0.02, mid_y, -1.47, -0.92, 0.2, rng)
    book("book_c", 0.21, 0.19, 0.03, (xc - 0.02, mid_y, zend + 0.028), R("X", -17) @ TG(0, 0, 0.015))
    box("paper_dim", (0.22, 0.14, 0.2), (xc - 0.01, mid_y + 0.07, -0.66), bev=0.008)    # a box of cables
    box("paper", (0.003, 0.04, 0.09), (xc - 0.121, mid_y + 0.08, -0.66), bev=0.0)  # its label
    # bay middle: two storage boxes below, a network switch and spare drives above
    for z, k in ((-0.25, "book_c"), (0.2, "book_a")):
        box(k, (0.30, 0.17, 0.36), (xc - 0.03, in_y0 + 0.085, z), bev=0.01)
        box("paper", (0.003, 0.045, 0.11), (xc - 0.181, in_y0 + 0.11, z), bev=0.0)
        box("device", (0.004, 0.02, 0.07), (xc - 0.181, in_y0 + 0.15, z), bev=0.0)   # handle slot
    box("device", (0.26, 0.045, 0.44), (xc - 0.02, mid_y + 0.0225, 0.0), bev=0.006)          # switch
    for i in range(8):
        k = "emis:success:6" if i % 3 != 2 else "emis:accent:6"
        box(k, (0.003, 0.004, 0.006), (xc - 0.151, mid_y + 0.03, -0.17 + i * 0.024), bev=0.0)
    for i in range(4):
        box("device_key", (0.003, 0.012, 0.014), (xc - 0.151, mid_y + 0.016, -0.17 + i * 0.024), bev=0.0)
    for i, z in enumerate((-0.12, 0.08)):
        box("book_b" if i else "book_a", (0.15, 0.03, 0.11), (xc - 0.04, mid_y + 0.045 + 0.015 + i * 0.0, z), bev=0.004)
    # bay right: books lying below, magazines above
    y = in_y0
    for i, (k, s) in enumerate((("book_c", (0.24, 0.04, 0.3)), ("book_a", (0.22, 0.035, 0.27)), ("book_b", (0.2, 0.03, 0.25)), ("book_a", (0.18, 0.045, 0.22)))):
        box(k, s, (xc - 0.04, y + s[1] / 2, 0.95), bev=0.004, xf=YAW([3, -4, 6, -2][i]))
        y += s[1]
    box("device", (0.25, 0.09, 0.30), (xc - 0.02, in_y0 + 0.045, 1.3), bev=0.008)   # a UPS
    for i in range(2):
        box("emis:success:6", (0.003, 0.005, 0.005), (xc - 0.146, in_y0 + 0.07, 1.22 + i * 0.016), bev=0.0)
    book_row_z(xc - 0.02, mid_y, 0.53, 1.0, 0.2, rng, hmin=0.15, hmax=0.21)
    y = mid_y
    for i in range(5):
        box("paper_dim" if i % 2 else "book_b", (0.21, 0.008, 0.28), (xc - 0.03, y + 0.004, 1.25), bev=0.002, segs=1, xf=YAW(i * 3 - 6))
        y += 0.009
    # on top: NAS, router, power strip, a couple of books and a small box
    ty = top
    nas = (0.22, 0.19, 0.17)
    nz = 1.22
    box("device", nas, (xc - 0.02, ty + nas[1] / 2, nz), bev=0.012, segs=3)
    for i in range(4):     # drive bays
        box("device_key", (0.004, 0.032, 0.13), (xc - 0.132, ty + 0.032 + i * 0.038, nz - 0.01), bev=0.0)
    for i in range(4):
        box("emis:success:8", (0.003, 0.004, 0.006), (xc - 0.133, ty + 0.032 + i * 0.038, nz + 0.068), bev=0.0)
    box("emis:accent:8", (0.003, 0.012, 0.012), (xc - 0.133, ty + 0.170, nz + 0.064), bev=0.0)   # power
    # router with two antennas
    rz = 0.78
    box("device", (0.17, 0.035, 0.24), (xc + 0.03, ty + 0.0175, rz), bev=0.008)
    for i in range(5):
        box("emis:success:6" if i < 4 else "emis:accent:6", (0.003, 0.003, 0.006), (xc - 0.056, ty + 0.022, rz - 0.06 + i * 0.03), bev=0.0)
    for z, a in ((rz - 0.09, -8), (rz + 0.09, 10)):
        bm = cyl(0.007, 0.17, segs=8, bev=0.002)
        bm.transform(TG(xc + 0.08, ty + 0.03, z) @ R("X", a))
        add(bm, "device")
    # power strip at the back with plugs
    ps = (0.05, 0.035, 0.36)
    box("device_key", ps, (x1 - 0.06, ty + ps[1] / 2, 0.30), bev=0.008)
    for i in range(4):
        box("device", (0.035, 0.03, 0.04), (x1 - 0.06, ty + 0.045, 0.18 + i * 0.075), bev=0.006)
    box("emis:accent:4", (0.004, 0.004, 0.01), (x1 - 0.086, ty + 0.028, 0.46), bev=0.0)
    # cables from the strip into the duct and to the devices
    cp = [G(x1 - 0.06, ty + 0.04, 0.18), G(x1 - 0.02, ty + 0.02, 0.22), G(x1 - 0.015, ty + 0.012, 0.6), G(x1 - 0.02, ty + 0.012, 1.0), G(x1 - 0.06, ty + 0.015, 1.12), G(xc + 0.02, ty + 0.03, nz - 0.08)]
    add(tube(cp, 0.0035, sides=6), "device")
    cp = [G(x1 - 0.06, ty + 0.04, 0.255), G(x1 - 0.03, ty + 0.012, 0.4), G(x1 - 0.03, ty + 0.012, 0.65), G(xc + 0.09, ty + 0.012, rz)]
    add(tube(cp, 0.003, sides=6), "device")
    cp = [G(x1 - 0.06, ty + 0.04, 0.405), G(x1 - 0.01, ty + 0.012, 0.5), G(x1 - 0.008, ty + 0.012, 1.45), G(x1 + 0.003, ty + 0.012, 1.55), G(WX - 0.011, ty + 0.06, PANEL["z1"] + 0.07)]
    add(tube(cp, 0.0035, sides=6), "device")
    # a small stack of books and a box on the left part of the top
    y = ty
    for i, (k, s) in enumerate((("book_b", (0.2, 0.03, 0.26)), ("book_c", (0.18, 0.025, 0.24)))):
        box(k, s, (xc - 0.05, y + s[1] / 2, -0.95), bev=0.004, xf=YAW([5, -6][i]))
        y += s[1]
    box("paper_dim", (0.14, 0.09, 0.18), (xc - 0.03, ty + 0.045, -0.5), bev=0.006, xf=YAW(-8))
    box("paper", (0.11, 0.003, 0.11), (xc - 0.06, y + 0.0015, -0.93), bev=0.0, xf=YAW(12))   # a note on the books
    # a closed spare laptop with its charger
    lm = TG(xc - 0.03, ty, -0.08) @ YAW(-94)
    box_m("device", (0.31, 0.009, 0.215), lm @ TG(0, 0.0045, 0), bev=0.004, segs=2)
    box_m("device_key", (0.31, 0.007, 0.215), lm @ TG(0, 0.0125, 0), bev=0.004, segs=2)
    box("device", (0.05, 0.028, 0.1), (x1 - 0.12, ty + 0.014, -0.05), bev=0.006, xf=YAW(8))
    cp = [G(x1 - 0.12, ty + 0.014, -0.10), G(x1 - 0.14, ty + 0.006, -0.2), G(xc + 0.06, ty + 0.006, -0.22), G(xc + 0.05, ty + 0.006, -0.17)]
    add(tube(cp, 0.0028, sides=6), "device")
    cp = [G(x1 - 0.12, ty + 0.014, 0.0), G(x1 - 0.1, ty + 0.006, 0.08), G(x1 - 0.06, ty + 0.03, 0.105)]
    add(tube(cp, 0.003, sides=6), "device")


# --------------------------------------------------------------------------- #
# Back-right corner: the tall shelf, the floor speaker; front-right: a floor plant
# --------------------------------------------------------------------------- #
SH = dict(x0=2.0, x1=3.5, z0=-2.69, z1=-2.35, levels=(0.085, 0.485, 0.885, 1.285, 1.685, 2.085))


def book_row_x(x0, x1, y, z_back, depth, rng, keys=("book_a", "book_b", "book_c"), hmin=0.2, hmax=0.30):
    """Books along X on the tall shelf (spines flush at the front, facing +Z)."""
    x = x0
    row = []
    while True:
        t = float(rng.uniform(0.02, 0.045))
        if x + t > x1:
            break
        h = float(rng.uniform(hmin, hmax))
        d = depth * float(rng.uniform(0.8, 1.0))
        k = keys[int(rng.integers(len(keys)))]
        row.append((k, t, h, d, x + t / 2))
        x += t + 0.0012
    hs = [r[2] for r in row]
    for i, (k, t, h, d, xc) in enumerate(row):
        book(k, t, h, d, (xc, y, z_back + depth - d / 2), drop=_row_drops(hs, i, 0))
    return x


def flat_leaf(rx, ry, cup=0.002, n=8):
    """A flat leaf in local XY (ellipse rx x ry, a slight cup), as a closed thin lens: few faces,
    few lightmap islands (front, back, rim)."""
    bm = bmesh.new()
    ct = bm.verts.new((0, 0, cup))
    cb = bm.verts.new((0, 0, cup - 0.0012))
    rt = [bm.verts.new((rx * math.cos(2 * math.pi * i / n), ry * math.sin(2 * math.pi * i / n), 0.0)) for i in range(n)]
    rb = [bm.verts.new((v.co.x, v.co.y, -0.0008)) for v in rt]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((ct, rt[i], rt[j]))
        bm.faces.new((cb, rb[j], rb[i]))
        bm.faces.new((rt[i], rb[i], rb[j], rt[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def leaves_trailing(at, rng, n_vines=4, length=0.35):
    """Trailing plant: vines from the pot rim, leaves along them."""
    px, py, pz = at
    for i in range(n_vines):
        a = -math.pi / 2 + (i - (n_vines - 1) / 2) * 0.55 + float(rng.uniform(-0.15, 0.15))
        start = Vector((px + 0.06 * math.cos(a), py, pz - 0.06 * math.sin(a)))
        out = Vector((math.cos(a), 0, -math.sin(a)))
        ln = length * float(rng.uniform(0.6, 1.1))
        pts = []
        for k in range(8):
            t = k / 7
            sway = Vector((math.sin(a), 0, math.cos(a))) * 0.025 * math.sin(t * math.pi * 1.5 + i)
            p = start + out * (0.12 * math.sin(min(t * 2.2, 1.0) * math.pi / 2)) + sway + Vector((0, 0.04 * math.sin(t * math.pi) - ln * max(t - 0.25, 0) * 1.2, 0))
            pts.append(p)
        add(tube([G(*p) for p in pts], 0.0025, sides=5), "plant")
        for k in range(2, 8):
            p = pts[k]
            side = 1 if k % 2 else -1
            m = TG(*p) @ YAW(math.degrees(a) + side * 70 + float(rng.uniform(-20, 20))) @ R("X", float(rng.uniform(-50, -20)))
            add(xf(flat_leaf(0.017, 0.024, n=7), m @ T(0.0, -0.02, 0)), "plant")
    # crown leaves over the pot
    for k in range(7):
        a = 2 * math.pi * k / 7 + float(rng.uniform(-0.3, 0.3))
        m = TG(px + 0.03 * math.cos(a), py + 0.02, pz + 0.03 * math.sin(a)) @ YAW(math.degrees(a) + 90) @ R("X", -25)
        add(xf(flat_leaf(0.021, 0.032, cup=0.003), m @ T(0.0, -0.03, 0.012)), "plant")


def strap_plant(px, py, pz, rng, n=12, hmin=0.55, hmax=1.0, wmin=0.05, wmax=0.075, segs=7):
    """Snake-plant style strap leaves (thin, two-sided), from (px, py, pz)."""
    leaves = bmesh.new()
    for i in range(n):
        a = 2 * math.pi * i / n + float(rng.uniform(-0.3, 0.3))
        h = float(rng.uniform(hmin, hmax))
        lean = float(rng.uniform(0.05, 0.25))
        wid = float(rng.uniform(wmin, wmax))
        rad = 0.02 + 0.06 * float(rng.uniform())
        base = Vector((px + rad * math.cos(a), py, pz + rad * math.sin(a)))
        outdir = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a + 0.7), 0, math.cos(a + 0.7)))
        front = []
        for s in range(segs + 1):
            t = s / segs
            ctr = base + Vector((0, h * t, 0)) + outdir * (lean * t * t * 0.7)
            w = max(wid * (1 - t ** 1.6) * (0.8 + 0.4 * math.sin(math.pi * min(t * 1.6, 1))), 0.001)
            fold = outdir * 0.004
            front.append([G(*(ctr - side * w / 2)), G(*(ctr + fold)), G(*(ctr + side * w / 2))])
        vs = [[leaves.verts.new(p) for p in row] for row in front]
        vb = [[leaves.verts.new(p + G(*(-outdir * 0.004))) for p in row] for row in front]
        for s in range(segs):
            for k in range(2):
                leaves.faces.new((vs[s][k], vs[s][k + 1], vs[s + 1][k + 1], vs[s + 1][k]))
                leaves.faces.new((vb[s][k], vb[s + 1][k], vb[s + 1][k + 1], vb[s][k + 1]))
            leaves.faces.new((vs[s][0], vs[s + 1][0], vb[s + 1][0], vb[s][0]))
            leaves.faces.new((vs[s][2], vb[s][2], vb[s + 1][2], vs[s + 1][2]))
    bmesh.ops.remove_doubles(leaves, verts=leaves.verts, dist=1e-5)
    add(leaves, "plant")


def build_tall_shelf():
    s = SH
    x0, x1, z0, z1 = s["x0"], s["x1"], s["z0"], s["z1"]
    d = z1 - z0
    zc = (z0 + z1) / 2
    top = s["levels"][-1]
    th = 0.025
    for x in (x0, (x0 + x1) / 2, x1):
        box("furniture", (th, top + 0.0, d), (x, top / 2, zc), bev=0.005)
    for lv in s["levels"]:
        box("furniture_top", (x1 - x0 - th, th, d - 0.006), ((x0 + x1) / 2, lv - th / 2, zc + 0.003), bev=0.005)
    box("furniture", (x1 - x0 - th, 0.06, 0.02), ((x0 + x1) / 2, 0.03, z1 - 0.03), bev=0.004)   # plinth
    rng = np.random.default_rng(5)
    xa0, xa1 = x0 + th / 2 + 0.004, (x0 + x1) / 2 - th / 2 - 0.004   # bay A (left)
    xb0, xb1 = (x0 + x1) / 2 + th / 2 + 0.004, x1 - th / 2 - 0.004   # bay B (right)
    L = s["levels"]
    zb = z0 + 0.015   # books stand against the back
    # level 0: two storage boxes (A), record crate (B)
    for i, x in enumerate((xa0 + 0.17, xa0 + 0.53)):
        box("book_c" if i == 0 else "fabric", (0.32, 0.27, 0.3), (x, L[0] + 0.135, zc + 0.01), bev=0.012)
        box("paper", (0.1, 0.05, 0.003), (x, L[0] + 0.18, zc + 0.161), bev=0.0)
    cx = (xb0 + xb1) / 2
    box("furniture_top", (0.5, 0.012, 0.3), (cx, L[0] + 0.006, zc), bev=0.003)
    for sx in (-1, 1):
        box("furniture_top", (0.012, 0.22, 0.3), (cx + sx * 0.244, L[0] + 0.11, zc), bev=0.003)
    for i in range(11):
        x = cx - 0.205 + i * 0.039
        k = ("book_c", "book_a", "device", "book_b")[i % 4]
        box(k, (0.008, 0.29, 0.29), (x, L[0] + 0.012 + 0.145, zc), bev=0.003, segs=1, xf=R("Y", -6 + (i % 3) * 3), vonly=True)
    # level 1: books (A), board game boxes stacked (B)
    xe = book_row_x(xa0 + 0.01, xa1 - 0.2, L[1], zb, 0.24, rng)
    book("book_b", 0.032, 0.27, 0.22, (xe + 0.05, L[1], zb + 0.11), Matrix.Rotation(math.radians(-17), 4, "Y"))
    box("paper_dim", (0.12, 0.12, 0.12), (xa1 - 0.08, L[1] + 0.06, zc), bev=0.006, xf=YAW(10))
    y = L[1]
    for i, (sz, k) in enumerate((((0.5, 0.07, 0.3), "book_a"), ((0.46, 0.06, 0.28), "book_c"), ((0.40, 0.05, 0.26), "paper_dim"))):
        box(k, sz, (cx + [0.0, 0.02, -0.03][i], y + sz[1] / 2, zc + 0.005), bev=0.005, xf=YAW([1.5, -3, 4][i]))
        y += sz[1]
    # level 2: camera on two books (A) with a framed photo; books + horizontal stack (B)
    y = L[2]
    for i, (sz, k) in enumerate((((0.26, 0.035, 0.2), "book_c"), ((0.22, 0.03, 0.17), "book_b"))):
        box(k, sz, (xa0 + 0.2, y + sz[1] / 2, zc + 0.02), bev=0.004, xf=YAW([-4, 6][i]))
        y += sz[1]
    cam_m = TG(xa0 + 0.2, y, zc + 0.03) @ YAW(18)
    box_m("device", (0.13, 0.08, 0.05), cam_m @ TG(0, 0.04, 0), bev=0.008)
    box_m("metal", (0.13, 0.014, 0.05), cam_m @ TG(0, 0.087, 0), bev=0.004)   # top plate
    box_m("device", (0.04, 0.022, 0.034), cam_m @ TG(-0.01, 0.1, -0.002), bev=0.006)   # prism
    for xx in (0.045, -0.05):
        add(xf(cyl(0.008, 0.008, segs=10, bev=0.002), cam_m @ TG(xx, 0.094, 0)), "device_key")   # dials
    lens = cyl(0.026, 0.04, segs=18, bev=0.003)
    lens.transform(cam_m @ TG(0.008, 0.042, 0.024) @ R("X", 90))
    add(lens, "device_key")
    lens2 = cyl(0.021, 0.012, segs=18, bev=0.002)
    lens2.transform(cam_m @ TG(0.008, 0.042, 0.064) @ R("X", 90))
    add(lens2, "metal")
    lens3 = cyl(0.016, 0.002, segs=16)
    lens3.transform(cam_m @ TG(0.008, 0.042, 0.076) @ R("X", 90))
    add(lens3, "device")
    pm = TG(xa1 - 0.12, L[2], zb + 0.03) @ R("X", 12)
    box_m("furniture", (0.2, 0.25, 0.018), pm @ TG(0, 0.125, 0), bev=0.004)
    box_m("paper", (0.15, 0.2, 0.002), pm @ TG(0, 0.125, 0.0095), bev=0.0)
    box_m("book_c", (0.11, 0.07, 0.001), pm @ TG(0, 0.1, 0.0108), bev=0.0, segs=1)
    xe = book_row_x(xb0 + 0.01, xb0 + 0.42, L[2], zb, 0.24, rng)
    y = L[2]
    for i, (sz, k) in enumerate((((0.25, 0.04, 0.19), "book_a"), ((0.23, 0.03, 0.17), "book_c"), ((0.21, 0.035, 0.16), "book_b"))):
        box(k, sz, (xb1 - 0.14, y + sz[1] / 2, zc + 0.01), bev=0.004, xf=YAW([2, -5, 7][i]))
        y += sz[1]
    # level 3: trailing plant (A), headphones on a stand and a small speaker (B)
    pc = (xa0 + 0.22, L[3], zc + 0.01)
    bm = lathe([(0, 0), (0.06, 0), (0.064, 0.004), (0.075, 0.12), (0.078, 0.128), (0.072, 0.13), (0.07, 0.115), (0, 0.115)], 24)
    bm.transform(TG(*pc))
    add(bm, "pot")
    leaves_trailing((pc[0], pc[1] + 0.125, pc[2]), rng, n_vines=4, length=0.32)
    box("device", (0.14, 0.2, 0.15), (xa1 - 0.11, L[3] + 0.1, zc), bev=0.012, xf=YAW(-8))   # small speaker
    sm = TG(xa1 - 0.11, L[3], zc) @ YAW(-8)
    for yy, rr in ((0.065, 0.045), (0.155, 0.02)):
        add(xf(cyl(rr, 0.006, segs=18, bev=0.002), sm @ TG(0, yy, 0.075) @ R("X", 90)), "device_key")
    hx = xb0 + 0.2
    add(xf(cyl(0.065, 0.012, segs=20, bev=0.004), TG(hx, L[3], zc)), "metal")
    add(tube([G(hx, L[3] + 0.01, zc), G(hx, L[3] + 0.25, zc)], 0.007, sides=8), "metal")
    add(xf(ellipsoid(0.04, 0.012, 0.012, n=10, rings=5), TG(hx, L[3] + 0.255, zc)), "metal")
    yb = L[3] + 0.265 - 0.075   # band arc centre: the band rests on the stand's top
    band = [G(hx + 0.078, yb - 0.06, zc), G(hx + 0.079, yb - 0.03, zc)]
    band += [G(hx + 0.078 * math.cos(t), yb + 0.075 * math.sin(t), zc) for t in np.linspace(0.0, math.pi, 13)]
    band += [G(hx - 0.079, yb - 0.03, zc), G(hx - 0.078, yb - 0.06, zc)]
    add(tube(band, 0.008, sides=8), "device")
    for sx in (-1, 1):
        m = TG(hx + sx * 0.08, yb - 0.085, zc) @ R("Y", sx * 90)
        add(xf(cyl(0.042, 0.03, segs=18, bev=0.008), m @ T(0, 0, -0.015)), "device")
        add(xf(cyl(0.03, 0.006, segs=14, bev=0.002), m @ T(0, 0, -0.019)), "fabric")   # cushion
    jar = lathe([(0, 0), (0.035, 0), (0.037, 0.004), (0.037, 0.11), (0.033, 0.11), (0.033, 0.01), (0, 0.01)], 18)
    jar.transform(TG(xb1 - 0.12, L[3], zc + 0.02))
    add(jar, "paper_dim")
    for i, (dx_, dz, a) in enumerate(((0.01, 0.0, 8), (-0.01, 0.01, -10), (0.0, -0.012, 4))):
        add(tube([G(xb1 - 0.12 + dx_, L[3] + 0.015, zc + 0.02 + dz), G(xb1 - 0.12 + dx_ + math.sin(math.radians(a)) * 0.15, L[3] + 0.16, zc + 0.02 + dz)], 0.004, sides=6), ["device", "book_b", "metal"][i])
    # level 4: books with a horizontal stack (A), two boxes and a globe (B)
    xe = book_row_x(xa0 + 0.01, xa0 + 0.45, L[4], zb, 0.22, rng)
    y = L[4]
    for i, (sz, k) in enumerate((((0.24, 0.04, 0.18), "book_b"), ((0.22, 0.035, 0.17), "book_a"))):
        box(k, sz, (xa1 - 0.13, y + sz[1] / 2, zc), bev=0.004, xf=YAW([-3, 5][i]))
        y += sz[1]
    box("book_c", (0.3, 0.16, 0.26), (xb0 + 0.17, L[4] + 0.08, zc), bev=0.01)
    box("paper_dim", (0.26, 0.12, 0.22), (xb0 + 0.17, L[4] + 0.16 + 0.06, zc), bev=0.01, xf=YAW(-4))
    gx = xb1 - 0.14
    add(xf(cyl(0.05, 0.015, segs=18, bev=0.004), TG(gx, L[4], zc)), "metal")
    add(tube([G(gx, L[4] + 0.01, zc), G(gx, L[4] + 0.05, zc)], 0.006, sides=6), "metal")
    gl = bmesh.new()
    bmesh.ops.create_uvsphere(gl, u_segments=16, v_segments=10, radius=0.1)
    gl.transform(TG(gx, L[4] + 0.165, zc) @ R("Y", 23))
    add(gl, "book_b")
    arc = [G(gx + 0.112 * math.cos(t), L[4] + 0.165 + 0.112 * math.sin(t), zc) for t in np.linspace(-1.9, 1.9, 13)]
    add(xf(tube(arc, 0.0035, sides=6), TG(gx, L[4] + 0.165, zc) @ R("Y", 23) @ TG(-gx, -(L[4] + 0.165), -zc)), "metal")
    # top: a box and two poster tubes
    box("paper_dim", (0.38, 0.2, 0.3), (xa0 + 0.25, L[5] + 0.1, zc), bev=0.01, xf=YAW(3))
    for i in range(2):
        bm = cyl(0.035 - i * 0.004, 0.62, segs=16, bev=0.004)
        bm.transform(TG(xb0 + 0.07, L[5] + 0.036 + i * 0.066, zc - 0.05 + i * 0.03) @ R("Y", 90) @ R("X", 0) @ T(0, 0, 0))
        add(bm, "book_c" if i == 0 else "paper_dim")


def build_speaker():
    sx, sz = 3.33, -1.92
    w, d, h = 0.22, 0.27, 0.86
    plinth = 0.045
    box("device", (d + 0.03, 0.025, w + 0.03), (sx, plinth - 0.0125 + 0.0, sz), bev=0.006)
    for xx in (-1, 1):
        for zz in (-1, 1):
            add(xf(cyl(0.012, plinth - 0.025, segs=8), TG(sx + xx * 0.12, 0.0, sz + zz * 0.1)), "metal")
    box("device", (d, h, w), (sx, plinth + h / 2, sz), bev=0.014, segs=3)
    fx = sx - d / 2 - 0.0005
    for yy, rr in ((plinth + h - 0.11, 0.022), (plinth + h - 0.30, 0.075), (plinth + h - 0.52, 0.075)):
        m = TG(fx, yy, sz) @ R("Z", -90) @ R("X", 90)
        add(xf(lathe([(0, -0.004), (rr * 0.25, -0.006), (rr * 0.85, 0.002), (rr, 0.002), (rr * 1.12, 0.0), (rr * 1.12, -0.002), (rr * 1.2, -0.003)], 16), m), "device_key")
    m = TG(fx, plinth + 0.12, sz) @ R("Z", -90) @ R("X", 90)
    add(xf(lathe([(0.022, 0.001), (0.03, 0.0), (0.03, -0.002), (0.022, -0.004), (0.02, -0.02)], 16), m), "device_key")


def build_track():
    """The ceiling track the three night spots (spec TrackSpotA/B/C) hang from: a slim black
    track along z, one cylindrical head per spot with its opening 12 mm behind the light origin
    along the aim (so the head never shadows its own beam), a feed cable and canopy at the back end."""
    spots = [d for d in LIGHTS["night"] if d["name"].startswith("TrackSpot")]
    if not spots:
        return
    ceil = ROOM["y"][1]
    tx = sum(d["at"][0] for d in spots) / len(spots)
    th, tw = 0.032, 0.034
    z0 = min(d["at"][2] for d in spots) - 0.5
    z1 = max(d["at"][2] for d in spots) + 0.5
    box("device", (tw, th, z1 - z0), (tx, ceil - th / 2, (z0 + z1) / 2), bev=0.005)
    ty = ceil - th   # underside of the track
    head_len, gap, r = 0.075, 0.012, 0.028
    prof = [(0, 0), (r - 0.004, 0), (r, 0.006), (r, head_len), (r - 0.005, head_len),
            (r - 0.005, head_len - 0.012), (0, head_len - 0.012)]
    for d in spots:
        at = G(*d["at"])
        aim = (G(*d["aim"]) - at).normalized()
        back = at - aim * (gap + head_len)
        add(xf(lathe(prof, 12), common_align(back, aim)), "device")
        # stem from an adapter on the track down to the head's top
        mid = at - aim * (gap + head_len / 2)
        up = Vector((0, 0, 1))
        top = mid + (up - aim * up.dot(aim)).normalized() * r   # the head's upper side
        anchor = G(tx, ty, d["at"][2])
        box("metal", (0.03, 0.014, 0.04), (tx, ty - 0.007, d["at"][2]), bev=0.003)
        add(tube([anchor + Vector((0, 0, -0.012)), top + (anchor - top).normalized() * 0.002], 0.006, sides=6), "metal")
    # feed cable and canopy past the back end of the track
    cz = z0 - 0.12
    can = cyl(0.036, 0.014, segs=12, bev=0.003)
    can.transform(TG(tx, ceil - 0.014, cz))
    add(can, "device")
    add(tube([G(tx, ty + 0.012, z0 + 0.01), G(tx, ty + 0.004, z0 - 0.04), G(tx, ceil - 0.02, cz + 0.02)], 0.004, sides=6), "device")


def common_align(origin, axis):
    """Matrix moving local +Z onto `axis` at `origin` (Blender space)."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    return Matrix.Translation(origin) @ q.to_matrix().to_4x4()


def build_floor_plant():
    # deep in the corner: the site's last shot stands at about (2.7, 2.0, 2.1) and `finale` at
    # (2.9, 1.9, 2.2); keep 0.6 m around both free of anything above 1.4 m
    px, pz = 3.31, 2.43
    prof = [(0.0, 0.0), (0.13, 0.0), (0.135, 0.006), (0.165, 0.40), (0.168, 0.412), (0.16, 0.415), (0.152, 0.39), (0.0, 0.39)]
    bm = lathe(prof, 28)
    bm.transform(TG(px, 0.0, pz))
    add(bm, "pot")
    soil = cyl(0.15, 0.005, segs=24)
    soil.transform(TG(px, 0.385, pz))
    add(soil, "device")
    rng = np.random.default_rng(3)
    strap_plant(px, 0.385, pz, rng, n=11, hmin=0.55, hmax=0.95, wmin=0.06, wmax=0.085, segs=6)


# --------------------------------------------------------------------------- #
# Quads (spec) – common's once ready, a throwaway version before
# --------------------------------------------------------------------------- #
ZONE_QUADS = [k for k, q in QUADS.items() if q["zone"] == "right"]


def make_quad(name):
    if common is not None:
        return common.make_quad(name)
    q = QUADS[name]
    w, h = q["size"]
    me = bpy.data.meshes.new(name)
    vs = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    me.from_pydata(vs, [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # local: plane in XZ facing -Y (Blender) = glTF +Z = yaw 0
    ob.matrix_world = TG(*q["at"]) @ YAW(q["yaw"]) @ R("X", -q["lean"])
    if q["kind"] == "screen":
        me.materials.append(emissive("screen_glow", 2.2))
    else:
        me.materials.append(mat("paper_dim"))
    return ob


# --------------------------------------------------------------------------- #
# build()
# --------------------------------------------------------------------------- #
def _parts_tris():
    n = 0
    for bms in PARTS.values():
        for b in bms:
            n += sum(len(f.verts) - 2 for f in b.faces)
    return n


def build():
    slat_front = build_panel()
    counts = [("panel", _parts_tris())]
    build_displays(slat_front)
    counts.append(("displays", _parts_tris()))
    # lightmap density by what the cameras see close: creatures in agents_close, the far shelf less
    for name, fn, tw in (("ledges", build_ledges, 1.0), ("trunking", build_trunking, 0.6), ("creatures", build_creatures, 6.0),
                         ("rack", build_rack, 1.0), ("tall_shelf", build_tall_shelf, 0.7), ("speaker", build_speaker, 0.6),
                         ("floor_plant", build_floor_plant, 0.4), ("track", build_track, 0.6)):
        texel(tw)
        fn()
        counts.append((name, _parts_tris()))
    prev = 0
    for name, n in counts:
        log(f"  {name:12s} {n - prev:6d} tris")
        prev = n
    objs = flush()
    tris = 0
    for o in objs:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    log(f"zone geometry: {len(objs)} objects, {tris} triangles")
    # the last shot's free column: nothing above 1.4 m within 0.6 m (plan) of these points
    worst = 0.0
    for o in objs:
        co = np.zeros(len(o.data.vertices) * 3, np.float32)
        o.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        gx, gy, gz = co[:, 0], co[:, 2], -co[:, 1]
        for cx_, cz_ in ((2.7, 2.1), (2.9, 2.2)):
            inside = (gx - cx_) ** 2 + (gz - cz_) ** 2 < 0.6 ** 2
            if inside.any():
                worst = max(worst, float(gy[inside].max()))
    log(f"finale column: highest geometry within 0.6 m = {worst:.3f} m ({'OK' if worst <= 1.4 else 'TOO HIGH'})")
    for name in ZONE_QUADS:
        make_quad(name)


# --------------------------------------------------------------------------- #
# Standalone modelling previews (throwaway shell + lights; no bake, no export)
# --------------------------------------------------------------------------- #
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
    log("Cycles device:", used)


def plane(name, corners, key):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(G(*c)) for c in corners], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat(key))
    return ob


def standalone_shell():
    x0, x1 = ROOM["x"]
    y0, y1 = ROOM["y"]
    z0, z1 = ROOM["z"]
    plane("floor", [(x0, 0, z0), (x0, 0, z1), (x1, 0, z1), (x1, 0, z0)], "floor")
    plane("ceil", [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], "ceiling")
    plane("wall_r", [(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)], "wall")
    plane("wall_b", [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], "wall")
    plane("wall_f", [(x0, y0, z1), (x0, y1, z1), (x1, y1, z1), (x1, y0, z1)], "wall")
    plane("wall_l", [(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], "wall")


def standalone_lights(scene):
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    scene.world = w
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.02, 0.022, 0.026, 1)
    bg.inputs["Strength"].default_value = 1.0
    ld = bpy.data.lights.new("fill", "AREA")
    ld.shape = "DISK"
    ld.size = 2.5
    ld.energy = 120
    ob = bpy.data.objects.new("fill", ld)
    ob.location = G(0.5, 2.9, 0.0)
    ob.rotation_euler = (G(3.0, 1.0, 0.0) - G(0.5, 2.9, 0.0)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(ob)
    ld = bpy.data.lights.new("lamp", "POINT")
    ld.energy = 40
    ld.color = (1.0, 0.8, 0.6)
    ob = bpy.data.objects.new("lamp", ld)
    ob.location = G(-1.0, 1.25, -2.45)
    scene.collection.objects.link(ob)


def make_camera(name):
    pos, look, fov = CAMERAS[name]
    cam = bpy.data.cameras.new(name)
    cam.sensor_fit = "VERTICAL"
    cam.angle_y = math.radians(fov)
    cam.clip_start = 0.05
    ob = bpy.data.objects.new(name, cam)
    ob.location = G(*pos)
    ob.rotation_euler = (G(*look) - G(*pos)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(ob)
    return ob


def quad_block_check(cam_names):
    scene = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    for cn in cam_names:
        pos = G(*CAMERAS[cn][0])
        for qn in ZONE_QUADS:
            q = bpy.data.objects[qn]
            mw = q.matrix_world
            vs = [mw @ v.co for v in q.data.vertices]
            blocked, total, by = 0, 0, {}
            for i in range(24):
                for j in range(14):
                    u, v = (i + 0.5) / 24, (j + 0.5) / 14
                    p = vs[0].lerp(vs[1], u).lerp(vs[3].lerp(vs[2], u), v)
                    d = p - pos
                    dist = d.length
                    hit, loc, nrm, idx, ob, _m = scene.ray_cast(dg, pos, d.normalized(), distance=dist - 0.003)
                    total += 1
                    if hit and ob.name != qn:
                        blocked += 1
                        by[ob.name] = by.get(ob.name, 0) + 1
            if blocked:
                log(f"BLOCKED {qn} from {cn}: {blocked}/{total} {by}")
    log("quad check done")


def standalone_main():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    scene = bpy.context.scene
    setup_gpu(scene)
    standalone_shell()
    standalone_lights(scene)
    build()
    cams = [a for a in ARGS if a.startswith("cam=")]
    cam_names = cams[0][4:].split(",") if cams else ["agents", "agents_close", "finale"]
    quad_block_check(["agents", "agents_close"])
    if "--count" in ARGS:
        return
    scene.render.resolution_x = int(ARGS[ARGS.index("--res") + 1]) if "--res" in ARGS else 1280
    scene.render.resolution_y = scene.render.resolution_x * 9 // 16
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = 0.6
    os.makedirs(HERE + "/work_right", exist_ok=True)
    for cn in cam_names:
        if cn not in CAMERAS:
            continue
        scene.camera = make_camera(cn)
        scene.render.filepath = HERE + f"/work_right/lit_{cn}.png"
        bpy.ops.render.render(write_still=True)
        log("wrote", scene.render.filepath)
    extra = [a for a in ARGS if a.startswith("view=")]
    for k, e in enumerate(extra):
        vals = [float(v) for v in e[5:].split(",")]
        CAMERAS[f"extra{k}"] = ((vals[0], vals[1], vals[2]), (vals[3], vals[4], vals[5]), vals[6])
        scene.camera = make_camera(f"extra{k}")
        scene.render.filepath = HERE + f"/work_right/lit_extra{k}.png"
        bpy.ops.render.render(write_still=True)
        log("wrote", scene.render.filepath)


def uv_test():
    """Build, join and unwrap exactly as common.run_zone does, report islands and density (no bake)."""
    common._reset_scene()
    parts, _q, _a, _p = common._call_build(build, "right")
    parts = common._prepare_parts(parts)
    if hasattr(common, "unwrap_parts"):
        common.unwrap_parts(parts)
    zone = common.join(parts, "Zone_right")
    log(f"Zone_right: {common.tri_count(zone)} triangles")
    common.lightmap_uvs(zone)


if __name__ == "__main__":
    if "--uvtest" in ARGS:
        uv_test()
    elif STANDALONE:
        standalone_main()
    else:
        common.run_zone("right", build, cameras=["agents", "agents_close", "finale"])
