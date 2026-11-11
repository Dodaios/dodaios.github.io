# ruff: noqa: E501
"""Zone "window": the left wall's window, the star counter on its sill, the corkboard.

Run headless (with common.py):
  blender --background --factory-startup --python zone_window.py -- [--skip-bake] [--previews-only] [--samples N]
Standalone modelling previews (own throwaway shell and lights, no bake):
  blender --background --factory-startup --python zone_window.py -- --standalone [--samples N]

All positions are glTF / three.js coordinates (X right, Y up, Z toward the viewer,
metres), converted to Blender with G().
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from spec import ANCHORS, CAMERAS, EMISSION, LIGHTS, PALETTE, QUADS, WINDOW, ZONES  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STANDALONE = "--standalone" in ARGS

common = None
if not STANDALONE:
    try:
        import common  # noqa: F811
    except Exception as exc:  # common.py not written yet, or broken
        print(f"[window] common.py not available ({exc}): standalone mode", flush=True)
        common = None


def log(*a):
    print("[window]", *a, flush=True)


# --------------------------------------------------------------------------- #
# Coordinates and transforms (glTF in, Blender out)
# --------------------------------------------------------------------------- #
def G(x, y, z):
    return Vector((x, -z, y))


def T(x, y, z):
    return Matrix.Translation(G(x, y, z))


def RY(deg):
    """Yaw about the vertical axis (glTF Y == Blender Z, same sense)."""
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def RX(deg):
    """Rotation about glTF X (== Blender X, same sense)."""
    return Matrix.Rotation(math.radians(deg), 4, "X")


def RZ(deg):
    """Rotation about glTF Z (== Blender -Y)."""
    return Matrix.Rotation(-math.radians(deg), 4, "Y")


def WL(z, y, x, rot=0.0):
    """Frame for a flat item on the left wall: built facing +Z with its back at local z=0,
    turned to face +X (into the room), rotated in-plane by `rot` degrees."""
    return T(x, y, z) @ RY(90) @ RZ(rot)


# --------------------------------------------------------------------------- #
# Materials: common's when it exists, own palette materials otherwise
# --------------------------------------------------------------------------- #
def srgb2lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip("#")
    return tuple(srgb2lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


_OWN = {}


def _bsdf(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def mat(key):
    if common is not None:
        return common.mat(key)
    if key in _OWN:
        return _OWN[key]
    m = bpy.data.materials.new("own_" + key)
    m.use_nodes = True
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*hexcol(PALETTE[key]), 1.0)
    b.inputs["Roughness"].default_value = 0.9
    b.inputs["Specular IOR Level"].default_value = 0.0
    _OWN[key] = m
    return m


def emissive(key, strength):
    if common is not None:
        return common.emissive(key, strength)
    name = f"own_em_{key}_{strength:g}"
    if name in _OWN:
        return _OWN[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = _bsdf(m)
    b.inputs["Base Color"].default_value = (*hexcol(PALETTE[key]), 1.0)
    b.inputs["Emission Color"].default_value = (*hexcol(PALETTE[key]), 1.0)
    b.inputs["Emission Strength"].default_value = strength
    _OWN[name] = m
    return m


# --------------------------------------------------------------------------- #
# Mesh helpers (bmesh, Blender space)
# --------------------------------------------------------------------------- #
CREATED = []


def link(ob):
    bpy.context.collection.objects.link(ob)
    CREATED.append(ob)
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def finish(bm, name, keys, smooth=True, sharp_deg=40.0, weighted=True, solidify=0.0, texel=1.0, recalc=True):
    """Turn a bmesh into an object. keys: palette key, list of keys (per material_index),
    or a material object / list of material objects."""
    if not isinstance(keys, (list, tuple)):
        keys = [keys]
    if recalc:  # open sheets (paper, leaves) keep their explicit winding
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me))
    for k in keys:
        me.materials.append(mat(k) if isinstance(k, str) else k)
    if solidify:
        mod = ob.modifiers.new("solid", "SOLIDIFY")
        mod.thickness = solidify
        mod.offset = 0.0
        mod.use_even_offset = True
        apply_mods(ob)
        me = ob.data
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        if weighted:
            mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.weight = 80
            mod.keep_sharp = True
            apply_mods(ob)
    else:
        me.shade_flat()
    ob["texel"] = texel
    return ob


def bevel(bm, width, segs=2, angle=30.0):
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(angle)]
    if edges and width > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs,
                        profile=0.5, affect="EDGES", clamp_overlap=True)


def bm_box(size, center=(0.0, 0.0, 0.0)):
    """size and center in glTF axes."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    c = G(*center)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy)) + c
    return bm


def rbox_bm(size, center=(0, 0, 0), bev=0.004, segs=2, M=None):
    bm = bm_box(size, center)
    bevel(bm, min(bev, min(size) * 0.45), segs)
    if M is not None:
        bm.transform(M)
    return bm


def rbox(name, key, size, center=(0, 0, 0), bev=0.004, segs=2, M=None, **kw):
    return finish(rbox_bm(size, center, bev, segs, M), name, key, **kw)


def merge_bm(dst, src, mi=None):
    if mi is not None:
        for f in src.faces:
            f.material_index = mi
    me = bpy.data.meshes.new("tmp")
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    return dst


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


def lathe(profile, segs=24, mat_of_seg=None):
    """profile: (r, h) pairs, revolved around local +Z (r == 0 makes a pole)."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        if r <= 1e-7:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), h)) for i in range(segs)])
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
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def align_matrix(origin, axis):
    """Matrix moving local +Z onto the Blender-space `axis` at Blender-space `origin`."""
    axis = Vector(axis).normalized()
    q = Vector((0, 0, 1)).rotation_difference(axis)
    return Matrix.Translation(origin) @ q.to_matrix().to_4x4()


def basis_matrix(origin, xa, ya, za):
    m = Matrix((xa, ya, za)).transposed().to_4x4()
    m.translation = origin
    return m


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
        rr = r(i / max(n - 1, 1)) if callable(r) else r
        rings.append([path[i] + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * rr for k in range(sides)])
    return loft(rings, caps, caps)


def torus(center, axis, R, r, nseg=12, nside=5):
    """Ring around Blender-space `axis` at Blender-space `center`."""
    bm = bmesh.new()
    rings = []
    for i in range(nseg):
        a = 2 * math.pi * i / nseg
        c = Vector((R * math.cos(a), R * math.sin(a), 0))
        out = c.normalized()
        rings.append([bm.verts.new(c + (out * math.cos(2 * math.pi * k / nside) + Vector((0, 0, 1)) * math.sin(2 * math.pi * k / nside)) * r) for k in range(nside)])
    for i in range(nseg):
        a, b = rings[i], rings[(i + 1) % nseg]
        for k in range(nside):
            kk = (k + 1) % nside
            bm.faces.new((a[k], a[kk], b[kk], b[k]))
    bm.transform(align_matrix(center, axis))
    return bm


def bezier(p0, p1, p2, n):
    return [p0 * (1 - t) ** 2 + p1 * 2 * (1 - t) * t + p2 * t * t for t in (i / (n - 1) for i in range(n))]


def flat_poly(pts2d, thickness, z0=0.0):
    """Extruded flat polygon in local XY (glTF-like: x right, y up), front at z0 + thickness."""
    bm = bmesh.new()
    lo = [bm.verts.new(G(x, y, z0)) for x, y in pts2d]
    hi = [bm.verts.new(G(x, y, z0 + thickness)) for x, y in pts2d]
    n = len(pts2d)
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# --------------------------------------------------------------------------- #
# Quads: common's when it exists, an exact stand-in otherwise
# --------------------------------------------------------------------------- #
def quad_matrix(name):
    q = QUADS[name]
    return T(*q["at"]) @ RY(q["yaw"]) @ RX(-q["lean"])


def make_quad(name):
    if common is not None:
        return common.make_quad(name)
    q = QUADS[name]
    w, h = q["size"]
    me = bpy.data.meshes.new(name)
    vs = [G(-w / 2, -h / 2, 0), G(w / 2, -h / 2, 0), G(w / 2, h / 2, 0), G(-w / 2, h / 2, 0)]
    me.from_pydata([tuple(v) for v in vs], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    ob = bpy.data.objects.new(name, me)
    ob.matrix_world = quad_matrix(name)
    bpy.context.collection.objects.link(ob)
    if q["kind"] in EMISSION["night"]:
        me.materials.append(emissive("screen_glow", EMISSION["night"][q["kind"]]))
    else:
        m = bpy.data.materials.new(name + "_ink")
        m.use_nodes = True
        b = _bsdf(m)
        b.inputs["Base Color"].default_value = (0.05, 0.05, 0.05, 1)
        b.inputs["Alpha"].default_value = 0.35
        me.materials.append(m)
    return ob


# --------------------------------------------------------------------------- #
# The window
# --------------------------------------------------------------------------- #
WX = -3.6  # inner face of the left wall
WO = -3.75  # outer face
OZ0, OZ1 = WINDOW["z"]
OY0, OY1 = WINDOW["y"]
LIN = 0.02  # reveal lining thickness
SILL_TOP = 0.918
SILL_NOSE = -3.34
FX0, FX1 = -3.735, -3.665  # window frame depth inside the reveal
CASE_W = 0.05


def build_reveal_and_casing():
    rc = (WO + WX) / 2
    d = WX - WO
    h = OY1 - OY0
    # lining of the wall opening: two jambs and the head
    rbox("win_jamb_back", "wall_trim", (d + 0.004, h, LIN), (rc + 0.002, OY0 + h / 2, OZ0 + LIN / 2), bev=0.003, segs=1)
    rbox("win_jamb_front", "wall_trim", (d + 0.004, h, LIN), (rc + 0.002, OY0 + h / 2, OZ1 - LIN / 2), bev=0.003, segs=1)
    rbox("win_head", "wall_trim", (d + 0.004, LIN, OZ1 - OZ0 - 2 * LIN), (rc + 0.002, OY1 - LIN / 2, (OZ0 + OZ1) / 2), bev=0.003, segs=1)
    # sill board inside the reveal, flush with the stool
    rbox("win_reveal_sill", "furniture_top", (d, SILL_TOP - OY0, OZ1 - OZ0 - 2 * LIN), (rc, (OY0 + SILL_TOP) / 2, (OZ0 + OZ1) / 2), bev=0.002, segs=1)
    # the stool: the deep sill that comes 0.26 m into the room
    sd = SILL_NOSE - WX  # 0.26 m into the room
    rbox("win_stool", "furniture_top", (sd, 0.046, OZ1 - OZ0 + 2 * CASE_W), (WX + sd / 2, SILL_TOP - 0.023, (OZ0 + OZ1) / 2), bev=0.008, segs=3)
    # apron under the stool
    rbox("win_apron", "wall_trim", (0.016, 0.07, OZ1 - OZ0 + 2 * CASE_W - 0.04), (WX + 0.008, SILL_TOP - 0.046 - 0.035, (OZ0 + OZ1) / 2), bev=0.004, segs=2)
    # casing (architrave) around the opening on the wall face
    cy0, cy1 = SILL_TOP, OY1 + 0.065
    for zc in (OZ0 - CASE_W / 2, OZ1 + CASE_W / 2):
        rbox("win_casing_side", "wall_trim", (0.02, OY1 - SILL_TOP, CASE_W), (WX + 0.01, (SILL_TOP + OY1) / 2, zc), bev=0.005, segs=2)
    rbox("win_casing_head", "wall_trim", (0.024, cy1 - OY1, OZ1 - OZ0 + 2 * CASE_W), (WX + 0.012, (OY1 + cy1) / 2, (OZ0 + OZ1) / 2), bev=0.006, segs=2)
    _ = cy0


# the frame layout, shared by sashes and handles
FW = 0.06  # frame face width
MW = 0.05  # mullion width
IZ0, IZ1 = OZ0 + LIN, OZ1 - LIN  # inside the lining
IY0, IY1 = SILL_TOP, OY1 - LIN
PZ0, PZ1 = IZ0 + FW, IZ1 - FW  # clear span inside the frame
PANE = (PZ1 - PZ0 - 2 * MW) / 3
MULL_Z = [PZ0 + PANE + MW / 2, PZ0 + 2 * PANE + 1.5 * MW]
RAIL_B = 0.052  # bottom rail (low, so the morning sun reaches the sill)
TRANSOM_Y = 2.06  # centre of the transom
TW = 0.05


def build_frame():
    xc, xd = (FX0 + FX1) / 2, FX1 - FX0
    key = "wall_trim"
    rbox("win_frame_bottom", key, (xd + 0.01, RAIL_B, IZ1 - IZ0), (xc + 0.005, IY0 + RAIL_B / 2, (IZ0 + IZ1) / 2), bev=0.006)
    rbox("win_frame_top", key, (xd, FW, IZ1 - IZ0), (xc, IY1 - FW / 2, (IZ0 + IZ1) / 2), bev=0.006)
    sy0, sy1 = IY0 + RAIL_B, IY1 - FW
    for zc in (IZ0 + FW / 2, IZ1 - FW / 2):
        rbox("win_frame_stile", key, (xd, sy1 - sy0, FW), (xc, (sy0 + sy1) / 2, zc), bev=0.006)
    for zc in MULL_Z:
        rbox("win_mullion", key, (xd + 0.012, sy1 - sy0, MW), (xc + 0.006, (sy0 + sy1) / 2, zc), bev=0.007)
    # transom: three pieces between the stiles and mullions
    edges = [PZ0, MULL_Z[0] - MW / 2, MULL_Z[0] + MW / 2, MULL_Z[1] - MW / 2, MULL_Z[1] + MW / 2, PZ1]
    for a, b in ((edges[0], edges[1]), (edges[2], edges[3]), (edges[4], edges[5])):
        rbox("win_transom", key, (xd + 0.006, TW, b - a), (xc + 0.003, TRANSOM_Y, (a + b) / 2), bev=0.006)
    # casement sashes in the three lower lights
    sw, sd = 0.036, 0.046
    sxc = FX1 - sd / 2 + 0.006
    y0, y1 = IY0 + RAIL_B, TRANSOM_Y - TW / 2
    for a, b in ((edges[0], edges[1]), (edges[2], edges[3]), (edges[4], edges[5])):
        a2, b2, y02, y12 = a + 0.004, b - 0.004, y0 + 0.004, y1 - 0.004
        rbox("win_sash", key, (sd, sw, b2 - a2), (sxc, y02 + sw / 2, (a2 + b2) / 2), bev=0.005, segs=1)
        rbox("win_sash", key, (sd, sw, b2 - a2), (sxc, y12 - sw / 2, (a2 + b2) / 2), bev=0.005, segs=1)
        rbox("win_sash", key, (sd, y12 - y02 - 2 * sw, sw), (sxc, (y02 + y12) / 2, a2 + sw / 2), bev=0.005, segs=1)
        rbox("win_sash", key, (sd, y12 - y02 - 2 * sw, sw), (sxc, (y02 + y12) / 2, b2 - sw / 2), bev=0.005, segs=1)
    # lever handles on the two outer sashes (they open; the middle one is fixed)
    hy = 1.42
    for zc, sgn in ((edges[1] - 0.004 - sw / 2, -1), (edges[4] + 0.004 + sw / 2, 1)):
        xf = sxc + sd / 2
        rbox("win_handle_rose", "metal", (0.012, 0.07, 0.026), (xf + 0.006, hy, zc), bev=0.005, segs=2)
        p0 = G(xf + 0.01, hy + 0.012, zc)
        p1 = G(xf + 0.03, hy + 0.012, zc)
        p2 = G(xf + 0.034, hy - 0.075, zc + sgn * 0.004)
        finish(tube([p0, p1, p1.lerp(p2, 0.5), p2], 0.006, sides=8), "win_handle_lever", "metal")
    return edges


def build_blind():
    """Roller blind rolled up inside the reveal head, with a pull cord and toggle."""
    xc, r, yc = -3.636, 0.027, OY1 - LIN - 0.006 - 0.027
    z0, z1 = IZ0 + 0.014, IZ1 - 0.014
    bm = lathe([(0, 0), (r, 0), (r, z1 - z0), (0, z1 - z0)], segs=20)
    bm.transform(align_matrix(G(xc, yc, z0), G(0, 0, 1) - G(0, 0, 0)))
    finish(bm, "blind_roll", "fabric", sharp_deg=60)
    for zc, sgn in ((IZ0 + 0.007, 1), (IZ1 - 0.007, -1)):
        b = lathe([(0, 0), (0.032, 0), (0.032, 0.014), (0, 0.014)], segs=16)
        b.transform(align_matrix(G(xc, yc, zc - sgn * 0.007), G(0, 0, sgn) - G(0, 0, 0)))
        finish(b, "blind_endcap", "metal", sharp_deg=50)
        rbox("blind_bracket", "metal", (0.05, 0.03, 0.014), (xc - 0.004, OY1 - LIN - 0.015, zc), bev=0.003, segs=1)
    # the short drop of fabric and the hem bar
    fx = xc + r + 0.0015
    hem_y = yc - 0.085
    rbox("blind_drop", "fabric", (0.002, yc - hem_y, z1 - z0 - 0.01), (fx, (yc + hem_y) / 2, (z0 + z1) / 2), bev=0.0, segs=1)
    rbox("blind_hem", "metal", (0.014, 0.022, z1 - z0 - 0.004), (fx, hem_y - 0.008, (z0 + z1) / 2), bev=0.005, segs=2)
    # pull cord from the middle of the hem bar, with a turned toggle
    cz = (z0 + z1) / 2 + 0.0
    top = G(fx + 0.002, hem_y - 0.019, cz)
    bot = G(fx + 0.004, hem_y - 0.30, cz)
    finish(tube([top, top.lerp(bot, 0.5), bot], 0.0016, sides=5), "blind_cord", "paper_dim", sharp_deg=80)
    tog = lathe([(0, 0), (0.007, 0.002), (0.011, 0.014), (0.011, 0.026), (0.006, 0.04), (0.0025, 0.044), (0, 0.044)], segs=14)
    tog.transform(align_matrix(bot + Vector((0, 0, 0.004)), Vector((0, 0, -1))))
    finish(tog, "blind_toggle", "furniture_top", sharp_deg=60)


def build_curtain_and_rod():
    rod_y, rod_x = 2.68, -3.50
    rz0, rz1 = -0.92, 1.40
    finish(tube([G(rod_x, rod_y, rz0), G(rod_x, rod_y, rz1)], 0.011, sides=12), "curtain_rod", "metal", sharp_deg=60)
    for zc, sgn in ((rz0 - 0.014, -1), (rz1 + 0.014, 1)):
        b = lathe([(0, -0.014), (0.007, -0.014), (0.016, -0.006), (0.017, 0.002), (0.012, 0.012), (0.004, 0.016), (0, 0.016)], segs=14)
        b.transform(align_matrix(G(rod_x, rod_y, zc), G(0, 0, sgn) - G(0, 0, 0)))
        finish(b, "curtain_finial", "metal", sharp_deg=60)
    # wall brackets
    for zc in (-0.900, 1.355):
        b = lathe([(0, 0), (0.022, 0), (0.022, 0.006), (0.016, 0.009), (0, 0.009)], segs=16)
        b.transform(align_matrix(G(WX, rod_y, zc), G(1, 0, 0) - G(0, 0, 0)))
        finish(b, "rod_bracket_plate", "metal", sharp_deg=50)
        finish(tube([G(WX + 0.008, rod_y - 0.004, zc), G(rod_x - 0.006, rod_y - 0.004, zc)], 0.0055, sides=8), "rod_bracket_arm", "metal")
        rbox("rod_bracket_cup", "metal", (0.03, 0.012, 0.016), (rod_x, rod_y - 0.016, zc), bev=0.003, segs=1)
    # the panel: gathered toward the back of the room, hanging to just above the sill
    z0 = -0.872
    ytop, ybot = 2.652, 0.95
    nu, nv = 30, 10
    folds = 4.5
    grid = []
    bm = bmesh.new()
    for j in range(nv + 1):
        t = j / nv
        y = ytop - (ytop - ybot) * t
        w = 0.255 + 0.075 * t ** 1.3
        amp = 0.024 + 0.024 * t ** 0.8
        row = []
        for i in range(nu + 1):
            s = i / nu
            ph = 2 * math.pi * folds * s + 0.9 * t * t + 0.35 * math.sin(3.1 * s + 1.7 * t)
            x = rod_x + amp * math.sin(ph) + 0.012 * t * math.sin(math.pi * s)
            z = z0 + s * w + 0.01 * math.sin(math.pi * t) * s
            if j == nv:
                y += 0.006 * math.cos(ph)  # the hem is not dead level
            row.append(bm.verts.new(G(x, y, z)))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    finish(bm, "curtain", "fabric", sharp_deg=80, weighted=False, solidify=0.005)
    # rings on the rod, one per fold crest at the top
    for k in range(6):
        s = (k + 0.25) / folds * (folds / 5.5)
        zc = z0 + 0.012 + k * (0.235 / 5)
        _ = s
        finish(torus(G(rod_x, rod_y, zc), G(0, 0, 1) - G(0, 0, 0), 0.02, 0.0028, nseg=10, nside=4), "curtain_ring", "metal", sharp_deg=80)
        finish(tube([G(rod_x, rod_y - 0.022, zc), G(rod_x, ytop - 0.004, zc)], 0.0016, sides=4, caps=False), "curtain_hook", "metal", sharp_deg=80)


def build_star_counter():
    """A slim display on a small stand around quad Text_stars: dark glass, thin housing."""
    q = QUADS["Text_stars"]
    w, h = q["size"]
    QM = quad_matrix("Text_stars")
    # dark glass face, 1 mm behind the quad
    glass = rbox_bm((w + 0.02, h + 0.022, 0.003), (0, -0.002, -0.0025), bev=0.0012, segs=1, M=QM)
    finish(glass, "stars_glass", "device", sharp_deg=50)
    # the housing: thin aluminium-grey shell behind the glass
    hb, ht = -h / 2 - 0.02, h / 2 + 0.014
    housing = rbox_bm((w + 0.034, ht - hb, 0.022), (0, (ht + hb) / 2, -0.004 - 0.011), bev=0.0045, segs=3, M=QM)
    finish(housing, "stars_housing", "metal", sharp_deg=40)
    # stand: a low rounded foot on the sill and a neck under the housing
    bot_local = Vector((0, 0, 0))
    bc = QM @ (G(0, hb, -0.015) - Vector((0, 0, 0)) + bot_local)
    fx, fz = bc.x, -bc.y
    foot_len = 0.42
    rbox("stars_foot", "device", (0.085, 0.012, foot_len), (fx + 0.004, SILL_TOP + 0.006, fz), bev=0.005, segs=3)
    neck_h = (bc.z - (SILL_TOP + 0.012)) + 0.01
    rbox("stars_neck", "metal", (0.03, neck_h, 0.22), (fx, SILL_TOP + 0.012 + neck_h / 2 - 0.004, fz), bev=0.004, segs=2)
    # a tiny status light on the foot
    b = lathe([(0, 0), (0.0022, 0), (0.0022, 0.0012), (0, 0.0016)], segs=10)
    b.transform(align_matrix(G(fx + 0.0465, SILL_TOP + 0.006, fz - foot_len / 2 + 0.03), G(1, 0, 0) - G(0, 0, 0)))
    finish(b, "stars_led", emissive("accent", 6.0), smooth=False)
    make_quad("Text_stars")


def build_sill_things():
    rng = random.Random(4)  # noqa: S311
    # --- a pothos in a small pot near the front jamb, trailing over the sill nose
    px, pz = -3.475, 1.02
    prof = [(0.0, 0.0), (0.042, 0.0), (0.046, 0.004), (0.058, 0.098), (0.061, 0.104), (0.058, 0.108), (0.053, 0.096), (0.0, 0.092)]
    bm = lathe(prof, segs=24, mat_of_seg=[0, 0, 0, 0, 0, 0, 1])
    bm.transform(T(px, SILL_TOP, pz))
    finish(bm, "plant_pot", ["pot", "device"], sharp_deg=45)
    leaves = bmesh.new()
    vines = bmesh.new()

    def leaf(base, direction, normal, L, W):
        d = direction.normalized()
        n = (normal - d * normal.dot(d)).normalized()
        s = d.cross(n)
        pts = [(0.0, 0.0), (0.12, 0.42), (0.45, 0.5), (0.78, 0.3), (1.0, 0.0), (0.78, -0.3), (0.45, -0.5), (0.12, -0.42)]
        for side in (0, 1):
            off = n * (-0.0012 if side else 0.0)
            cen = leaves.verts.new(base + d * (0.45 * L) + n * 0.006 + off)
            ring = [leaves.verts.new(base + d * (u * L) + s * (v * W) + n * (0.004 * (1 - abs(v) * 2) * (0.3 + u)) + off) for u, v in pts]
            for i in range(len(ring)):
                vv = (ring[i], ring[(i + 1) % len(ring)], cen)
                leaves.faces.new(vv if side == 0 else tuple(reversed(vv)))

    rim = G(px, SILL_TOP + 0.1, pz)
    vine_specs = [
        # (start offset in glTF xz, control, end) all glTF
        ((0.03, 0.0), (-3.36, 1.07, 1.06), (-3.30, 0.80, 1.08)),
        ((0.02, 0.03), (-3.40, 1.10, 1.13), (-3.335, 0.88, 1.20)),
        ((-0.01, -0.03), (-3.44, 1.12, 0.90), (-3.39, 0.935, 0.80)),
    ]
    for (ox, oz), ctrl, end in vine_specs:
        p0 = rim + G(ox, 0.0, oz) - G(0, 0, 0)
        path = bezier(p0, G(*ctrl), G(*end), 9)
        finish_path = tube(path, 0.0022, sides=4)
        merge_bm(vines, finish_path)
        for k in range(1, 9, 1):
            a = path[k - 1]
            b = path[min(k, len(path) - 1)]
            tan = (b - a).normalized()
            side = Vector((0, 0, 1)).cross(tan).normalized() * (1 if k % 2 else -1)
            dirv = (side * 0.8 + tan * 0.5 + Vector((0, 0, 0.25))).normalized()
            L = 0.055 * (1.0 - 0.35 * k / 9) * rng.uniform(0.85, 1.1)
            leaf(path[k], dirv, Vector((0, 0, 1)) - side * 0.3, L, L * 0.62)
    # upright leaves from the pot
    for k in range(6):
        a = 2 * math.pi * k / 6 + rng.uniform(-0.3, 0.3)
        base = G(px + 0.02 * math.cos(a), SILL_TOP + 0.095, pz + 0.02 * math.sin(a))
        dirv = G(math.cos(a) * 0.55, 0.85, math.sin(a) * 0.55) - G(0, 0, 0)
        stem_end = base + dirv.normalized() * 0.05
        merge_bm(vines, tube([base, stem_end], 0.002, sides=4))
        L = rng.uniform(0.06, 0.075)
        leaf(stem_end, dirv + G(math.cos(a), 0.0, math.sin(a)) - G(0, 0, 0), G(math.cos(a) * 0.3, 1.0, math.sin(a) * 0.3) - G(0, 0, 0), L, L * 0.62)
    finish(vines, "plant_vines", "plant", sharp_deg=80, weighted=False)
    finish(leaves, "plant_leaves", "plant", sharp_deg=70, weighted=False, recalc=False)

    # --- two books and a mug at the back end of the sill
    bx, bz = -3.485, -0.42
    y = SILL_TOP
    for (sx, sy, sz), key, rot in (((0.175, 0.03, 0.235), "book_c", 6.0), ((0.15, 0.024, 0.205), "book_a", -5.0)):
        M = T(bx, y, bz) @ RY(rot)
        pages = rbox_bm((sx - 0.008, sy - 0.006, sz - 0.006), (0.004, sy / 2, 0), bev=0.0015, segs=1, M=M)
        finish(pages, "book_pages", "book_b", sharp_deg=50)
        cov = bmesh.new()
        for yy in (0.0015, sy - 0.0015):
            merge_bm(cov, rbox_bm((sx, 0.003, sz), (0, yy, 0), bev=0.001, segs=1, M=M))
        merge_bm(cov, rbox_bm((0.005, sy, sz), (-sx / 2 + 0.0025, sy / 2, 0), bev=0.002, segs=2, M=M))
        finish(cov, "book_cover", key, sharp_deg=50)
        y += sy
    prof = [(0.0, 0.0), (0.032, 0.0), (0.036, 0.004), (0.038, 0.02), (0.038, 0.088), (0.0375, 0.093), (0.035, 0.094), (0.0335, 0.09), (0.0335, 0.07), (0.0, 0.07)]
    bm = lathe(prof, segs=16, mat_of_seg=[0, 0, 0, 0, 0, 0, 0, 0, 1])
    mc = G(bx + 0.01, y, bz + 0.02)
    bm.transform(Matrix.Translation(mc))
    ang = math.radians(-35)  # handle toward the room
    pts = []
    for i in range(9):
        t = math.radians(-75 + 150 * i / 8)
        rr = 0.037 + 0.022 * math.cos(t)
        hh = 0.048 + 0.027 * math.sin(t)
        pts.append(mc + Vector((rr * math.cos(ang), rr * math.sin(ang), hh)))
    merge_bm(bm, tube(pts, 0.0052, sides=7))
    finish(bm, "mug", ["paper_dim", "device"], sharp_deg=50)  # in the dawn sun: paper would clip

    # --- a planisphere (star finder) leaning in the front corner of the sill, against the frame
    R = 0.105
    lean = T(-3.607, SILL_TOP, 1.165) @ RY(90 - 8) @ RX(-11) @ T(0, R + 0.001, 0.0)
    disc = lathe([(0.0, 0.0), (R - 0.004, 0.0), (R, 0.0025), (R, 0.0045), (R - 0.004, 0.006), (0.0, 0.006)], segs=28)
    disc.transform(lean @ Matrix.Rotation(math.radians(90), 4, "X"))  # lathe axis -> local +Z
    finish(disc, "planisphere_disc", "paper_dim", sharp_deg=50, texel=0.9)
    # the dark mask with its oval window onto the sky map, and the centre rivet
    win = bmesh.new()
    pts2 = [(0.072 * math.cos(2 * math.pi * k / 20), 0.012 + 0.05 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
    merge_bm(win, flat_poly(pts2, 0.0004, 0.0))
    win.transform(lean @ T(0, 0, 0.0061))
    finish(win, "planisphere_window", "book_c", smooth=False, texel=0.7)
    riv = lathe([(0, 0), (0.006, 0), (0.006, 0.0015), (0, 0.0025)], segs=10)
    riv.transform(lean @ T(0, 0, 0.006) @ Matrix.Rotation(math.radians(90), 4, "X"))
    finish(riv, "planisphere_rivet", "metal", sharp_deg=60, texel=0.3)


def build_radiator():
    n, pitch = 18, 0.055
    z0 = 0.2 - n * pitch / 2
    y0, y1 = 0.13, 0.70
    xc = -3.532
    secs = bmesh.new()
    for i in range(n):
        zc = z0 + pitch * (i + 0.5)
        merge_bm(secs, rbox_bm((0.086, y1 - y0, 0.044), (xc, (y0 + y1) / 2, zc), bev=0.014, segs=1))
    finish(secs, "radiator_sections", "metal", sharp_deg=40)
    # hubs that join the sections, top and bottom
    hub = bmesh.new()
    for yy in (y0 + 0.035, y1 - 0.035):
        merge_bm(hub, tube([G(xc, yy, z0 + 0.01), G(xc, yy, z0 + n * pitch - 0.01)], 0.017, sides=8))
    finish(hub, "radiator_hubs", "metal", sharp_deg=50)
    # wall brackets
    for zc in (z0 + 3 * pitch, z0 + (n - 3) * pitch):
        rbox("radiator_bracket", "furniture", (0.06, 0.03, 0.02), (WX + 0.03, y1 - 0.05, zc), bev=0.004, segs=1)
    # pipes into the floor, a thermostatic valve on the back end
    pz_a, pz_b = z0 - 0.045, z0 + n * pitch + 0.045
    pipes = bmesh.new()
    for pz in (pz_a, pz_b):
        e = G(xc + 0.01, y0 + 0.035, pz)
        merge_bm(pipes, tube([G(xc + 0.01, 0.0, pz), G(xc + 0.01, y0 - 0.005, pz), e + Vector((0, 0, 0.0))], 0.009, sides=8))
        merge_bm(pipes, tube([e, G(xc, y0 + 0.035, pz + (0.03 if pz < 0 else -0.03))], 0.011, sides=8))
    finish(pipes, "radiator_pipes", "metal", sharp_deg=50)
    for pz in (pz_a, pz_b):
        rose = lathe([(0, 0), (0.017, 0), (0.017, 0.004), (0, 0.004)], segs=14)
        rose.transform(T(xc + 0.01, 0.0, pz))
        finish(rose, "radiator_floor_rose", "metal", sharp_deg=50)
    v = lathe([(0, 0), (0.013, 0), (0.013, 0.025), (0.021, 0.03), (0.022, 0.085), (0.019, 0.092), (0, 0.093)], segs=16)
    v.transform(T(xc + 0.01, y0 + 0.05, pz_a))
    finish(v, "radiator_valve", "paper_dim", sharp_deg=45)
    return z0, z0 + n * pitch


def build_telescope():
    mx, mz = -3.13, -0.50
    plate_y = 1.0
    parts = []  # (bm, key)
    # tripod: three two-section legs with clamps, rubber feet and a spreader tray
    spread_y = 0.42
    tray_pts = []
    for ang in (20.0, 140.0, 260.0):
        a = math.radians(ang)
        ca, sa = math.cos(a), math.sin(a)
        top = G(mx + 0.05 * ca, plate_y - 0.01, mz + 0.05 * sa)
        foot = G(mx + 0.33 * ca, 0.012, mz + 0.33 * sa)
        mid = top.lerp(foot, 0.5)
        parts.append((tube([top, mid + (foot - top).normalized() * 0.05], 0.0135, sides=8), "metal"))
        parts.append((tube([mid, foot], 0.0095, sides=8), "metal"))
        c = mid
        cl = lathe([(0, -0.022), (0.017, -0.022), (0.018, 0.022), (0, 0.022)], segs=8)
        cl.transform(align_matrix(c, foot - top))
        parts.append((cl, "device"))
        ft = lathe([(0, 0), (0.016, 0), (0.016, 0.02), (0.01, 0.03), (0, 0.03)], segs=10)
        ft.transform(Matrix.Translation(foot - Vector((0, 0, 0.012))))
        parts.append((ft, "device"))
        tt = (spread_y - 0.012) / (plate_y - 0.01 - 0.012)
        tray_pts.append(foot.lerp(top, tt))
        hinge = lathe([(0, -0.02), (0.02, -0.02), (0.02, 0.02), (0, 0.02)], segs=10)
        hinge.transform(align_matrix(top, foot - top))
        parts.append((hinge, "device"))
    ctr = G(mx, spread_y, mz)
    for p in tray_pts:
        parts.append((tube([ctr, p], 0.006, sides=6), "metal"))
    tray = lathe([(0, -0.006), (0.075, -0.006), (0.08, 0.006), (0.07, 0.002), (0, 0.002)], segs=12)
    tray.transform(Matrix.Translation(ctr))
    parts.append((tray, "device"))
    # head
    head = lathe([(0, 0), (0.07, 0), (0.072, 0.01), (0.072, 0.026), (0.06, 0.032), (0.045, 0.034), (0.045, 0.07), (0, 0.07)], segs=16)
    head.transform(T(mx, plate_y - 0.02, mz))
    parts.append((head, "device"))
    # optical tube
    D = (G(-0.93, 0.36, 0.06) - G(0, 0, 0)).normalized()
    up = (Vector((0, 0, 1)) - D * D.z).normalized()
    side = D.cross(up).normalized()
    Tc = G(mx, 1.205, mz)
    back_len, front_len = 0.30, 0.42
    back = Tc - D * back_len
    L = back_len + front_len
    prof = [(0.0, 0.0), (0.040, 0.0), (0.046, 0.004), (0.046, 0.04), (0.0475, 0.043), (0.0475, L - 0.165), (0.053, L - 0.16), (0.054, L), (0.050, L + 0.002), (0.049, L - 0.02), (0.045, L - 0.12), (0.0, L - 0.12)]
    mats = [1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1]
    bm = lathe(prof, segs=24, mat_of_seg=mats)
    bm.transform(align_matrix(back, D))
    # mid grey, not white: the tube stands in the dawn sun and must stay below clipping
    finish(bm, "scope_tube", ["book_a", "device"], sharp_deg=40)
    # tube rings and dovetail bar
    for off in (-0.08, 0.12):
        r = lathe([(0.0475, -0.013), (0.055, -0.013), (0.056, -0.009), (0.056, 0.009), (0.055, 0.013), (0.0475, 0.013)], segs=16)
        r.transform(align_matrix(Tc + D * off, D))
        parts.append((r, "device"))
    dov_c = Tc - up * 0.064 + D * 0.02
    bar = rbox_bm((0.036, 0.014, 0.30), (0, 0, 0), bev=0.003, segs=1)
    bar.transform(basis_matrix(dov_c, side, D, up) @ Matrix.Rotation(math.radians(-90), 4, "X"))
    parts.append((bar, "device"))
    for off in (-0.08, 0.12):
        post = rbox_bm((0.022, 0.03, 0.016), (0, 0, 0), bev=0.003, segs=1)
        post.transform(basis_matrix(Tc - up * 0.054 + D * off, side, D, up) @ Matrix.Rotation(math.radians(-90), 4, "X"))
        parts.append((post, "device"))
    # alt-az block between the head and the dovetail, with a clamp knob and a pan handle
    blk_top = dov_c - up * 0.007
    blk_bot = G(mx, plate_y + 0.05, mz)
    blk = rbox_bm((0.07, (blk_top.z - blk_bot.z) + 0.01, 0.075), (mx, (blk_top.z + blk_bot.z) / 2, mz), bev=0.008, segs=2)
    parts.append((blk, "device"))
    kn = lathe([(0, 0), (0.016, 0), (0.018, 0.004), (0.018, 0.016), (0.014, 0.02), (0, 0.02)], segs=12)
    kn.transform(align_matrix(G(mx, (blk_top.z + blk_bot.z) / 2, mz + 0.0375), G(0, 0, 1) - G(0, 0, 0)))
    parts.append((kn, "device_key"))
    h0 = G(mx + 0.03, (blk_top.z + blk_bot.z) / 2 - 0.01, mz - 0.03)
    h1 = h0 + (G(0.17, -0.14, -0.08) - G(0, 0, 0))
    parts.append((tube([h0, h1], 0.007, sides=8), "metal"))
    grip = lathe([(0, 0), (0.012, 0), (0.012, 0.07), (0.009, 0.08), (0, 0.08)], segs=10)
    grip.transform(align_matrix(h1 - (h1 - h0).normalized() * 0.06, h1 - h0))
    parts.append((grip, "device"))
    # focuser, star diagonal and eyepiece at the back
    foc = lathe([(0, 0), (0.026, 0), (0.026, 0.02), (0.021, 0.024), (0.021, 0.075), (0, 0.075)], segs=12)
    foc.transform(align_matrix(back + D * 0.001, -D))
    parts.append((foc, "device"))
    fk = lathe([(0, -0.032), (0.009, -0.032), (0.009, 0.032), (0, 0.032)], segs=10)
    fk.transform(align_matrix(back - D * 0.035, side))
    parts.append((fk, "device_key"))
    dg = back - D * 0.095
    diag = rbox_bm((0.036, 0.036, 0.036), (0, 0, 0), bev=0.006, segs=2)
    diag.transform(basis_matrix(dg, side, D, up))
    parts.append((diag, "metal"))
    ep = lathe([(0, 0), (0.016, 0), (0.016, 0.03), (0.019, 0.034), (0.019, 0.075), (0.011, 0.074), (0, 0.074)], segs=12)
    ep.transform(align_matrix(dg + up * 0.016, up))
    parts.append((ep, "device"))
    # finder scope on two small posts
    fc = Tc + up * 0.082 + D * 0.08
    fd = lathe([(0, 0), (0.011, 0), (0.013, 0.006), (0.013, 0.17), (0.015, 0.175), (0.015, 0.2), (0.012, 0.201), (0, 0.19)], segs=12)
    fd.transform(align_matrix(fc - D * 0.1, D))
    parts.append((fd, "book_a"))
    for off in (-0.05, 0.05):
        parts.append((tube([Tc + up * 0.046 + D * (0.08 + off), fc - up * 0.012 + D * off], 0.004, sides=6), "device"))
    by_key = {}
    for b, k in parts:
        by_key.setdefault(k, bmesh.new())
        merge_bm(by_key[k], b)
    for k, b in by_key.items():
        finish(b, "scope_" + k, k, sharp_deg=45)


def build_cushion():
    cx, cz = -3.07, 0.30
    prof = [(0.0, 0.006), (0.20, 0.0), (0.255, 0.012), (0.278, 0.045), (0.283, 0.078), (0.281, 0.09), (0.283, 0.102), (0.276, 0.135), (0.25, 0.163), (0.17, 0.18), (0.06, 0.176), (0.015, 0.162), (0.0, 0.16)]
    bm = lathe(prof, segs=32)
    # soft, slightly squashed: make it a touch oval and uneven
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x)
        k = 1.0 + 0.035 * math.cos(2 * a + 0.4) + 0.012 * math.sin(3 * a)
        v.co.x *= k
        v.co.y *= 1.0 / k
        if v.co.z > 0.12:
            v.co.z += 0.008 * math.sin(2 * a + 1.0) * min(1.0, math.hypot(v.co.x, v.co.y) / 0.2)
    bm.transform(T(cx, 0.0, cz) @ RY(20))
    finish(bm, "cushion", "fabric", sharp_deg=60)
    # piping seam round the belly
    finish(torus(G(cx, 0.09, cz), Vector((0, 0, 1)), 0.284, 0.006, nseg=32, nside=4), "cushion_piping", "fabric", sharp_deg=80)
    b = lathe([(0, 0), (0.016, 0), (0.016, 0.006), (0, 0.009)], segs=12)
    b.transform(T(cx, 0.157, cz))
    finish(b, "cushion_button", "furniture", sharp_deg=60)
    # a book left open, face down, on the cushion
    M = T(cx + 0.06, 0.175, cz - 0.05) @ RY(-35) @ RX(3)
    for sgn in (-1, 1):
        cov = rbox_bm((0.003, 0.002, 0.2), (0, 0, 0), bev=0.0, segs=1)
        cov = rbox_bm((0.115, 0.003, 0.19), (sgn * 0.0575, 0.0, 0.0), bev=0.0012, segs=1, M=M @ RZ(sgn * 9.0) @ T(0, 0.018, 0))
        finish(cov, "cushion_book_cover", "book_b", sharp_deg=50)
        pg = rbox_bm((0.108, 0.014, 0.182), (sgn * 0.056, -0.008, 0.0), bev=0.002, segs=1, M=M @ RZ(sgn * 9.0) @ T(0, 0.018, 0))
        finish(pg, "cushion_book_pages", "paper_dim", sharp_deg=50)
    sp = lathe([(0, -0.095), (0.006, -0.095), (0.006, 0.095), (0, 0.095)], segs=8)
    sp.transform(M @ T(0, 0.0205, 0) @ RX(90))
    finish(sp, "cushion_book_spine", "book_b", sharp_deg=60)


# --------------------------------------------------------------------------- #
# The corkboard
# --------------------------------------------------------------------------- #
CB_Z = (1.5, 2.6)
CB_Y = (1.15, 2.1)
CORK_FACE = -3.5665
FRAME_W = 0.032


def pin(M_at, key="paper", tilt=(0.0, 0.0)):
    """A push pin: M_at places local origin on the paper, local +Z out of the wall."""
    prof = [(0.0058, 0.0), (0.0058, 0.0022), (0.0028, 0.0034), (0.0028, 0.0085), (0.0052, 0.0105), (0.0042, 0.0142), (0.0, 0.0145)]
    b = lathe(prof, segs=8)
    b.transform(M_at @ Matrix.Rotation(math.radians(180), 4, "X") @ Matrix.Rotation(math.radians(tilt[0]), 4, "X") @ Matrix.Rotation(math.radians(tilt[1]), 4, "Y"))
    return b


def build_corkboard():
    z0, z1 = CB_Z
    y0, y1 = CB_Y
    zc, yc = (z0 + z1) / 2, (y0 + y1) / 2
    # backing and cork
    rbox("cork_back", "furniture", (0.015, y1 - y0 - 0.01, z1 - z0 - 0.01), (WX + 0.0075, yc, zc), bev=0.002, segs=1)
    ct = CORK_FACE - (WX + 0.015)
    rbox("cork", "cork", (ct, y1 - y0 - 2 * FRAME_W + 0.01, z1 - z0 - 2 * FRAME_W + 0.01), (WX + 0.015 + ct / 2, yc, zc), bev=0.001, segs=1)
    # frame: four bevelled bars, standing 5 mm proud of the cork
    fd = (CORK_FACE + 0.005) - WX
    fx = WX + fd / 2
    frame = bmesh.new()
    merge_bm(frame, rbox_bm((fd, FRAME_W, z1 - z0), (fx, y1 - FRAME_W / 2, zc), bev=0.006, segs=2))
    merge_bm(frame, rbox_bm((fd, FRAME_W, z1 - z0), (fx, y0 + FRAME_W / 2, zc), bev=0.006, segs=2))
    merge_bm(frame, rbox_bm((fd, y1 - y0 - 2 * FRAME_W, FRAME_W), (fx, yc, z0 + FRAME_W / 2), bev=0.006, segs=2))
    merge_bm(frame, rbox_bm((fd, y1 - y0 - 2 * FRAME_W, FRAME_W), (fx, yc, z1 - FRAME_W / 2), bev=0.006, segs=2))
    finish(frame, "cork_frame", "furniture_top", sharp_deg=40)

    papers = {"paper": bmesh.new(), "paper_dim": bmesh.new(), "book_c": bmesh.new(), "book_a": bmesh.new()}
    pins = {"paper": bmesh.new(), "device": bmesh.new()}
    # the quote cards: paper_dim, so the lounge lamp's warm hotspot on them stays below clipping at night
    cards = bmesh.new()

    # the three quote cards, a little larger than their quads, each held by a pin
    card_t = 0.0015
    for i, (name, rot, pin_dz, pkey) in enumerate((("Text_quote1", 0.5, 0.01, "device"), ("Text_quote2", -0.4, -0.006, "device"), ("Text_quote3", 0.6, 0.004, "device"))):
        q = QUADS[name]
        qz, qy = q["at"][2], q["at"][1]
        w, h = q["size"]
        cw, ch = w + 0.022, h + 0.05
        cy = qy + 0.012  # extra paper at the top for the pin
        M = WL(qz, cy, CORK_FACE, rot)
        merge_bm(cards, rbox_bm((cw, ch, card_t), (0, 0, card_t / 2), bev=0.0, segs=1, M=M))
        merge_bm(pins[pkey], pin(M @ T(-pin_dz, ch / 2 - 0.014, card_t), pkey, tilt=(4, -3 + 3 * i)))
        make_quad(name)

    # photo prints, notes, a ticket stub (local: x along the wall toward -Z, y up)
    def sheet(M, key, w, h, cx=0.0, cy=0.0, z=0.0, thick=0.0005):
        merge_bm(papers[key], rbox_bm((w, h, thick), (cx, cy, z + thick / 2), bev=0.0, segs=1, M=M))

    def flat(M, key, w, h, cx, cy, z):
        bm = bmesh.new()
        vs = [bm.verts.new(G(cx + sx * w / 2, cy + sy * h / 2, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        bm.faces.new(vs)
        bm.transform(M)
        merge_bm(papers[key], bm)

    def image(M, w, h, cx, cy, z, moon=False):
        """A blank print's picture: a lighter sky over a darker ground."""
        flat(M, "book_a", w, h, cx, cy, z)
        flat(M, "book_c", w, h * 0.38, cx, cy - h * 0.31, z + 0.0002)
        if moon:
            flat(M, "paper_dim", w * 0.12, w * 0.12, cx + w * 0.25, cy + h * 0.25, z + 0.0002)

    def put_pin(M, x, y, z, key, tilt=(4.0, 2.0)):
        merge_bm(pins[key], pin(M @ T(x, y, z), key, tilt=tilt))

    def instant(zc, yc, rot, pin_key, lift=0.0, moon=False):
        M = WL(zc, yc, CORK_FACE + lift, rot)
        sheet(M, "paper", 0.086, 0.104)
        image(M, 0.074, 0.074, 0.0, 0.009, 0.0007, moon)
        if pin_key:
            put_pin(M, 0.0, 0.04, 0.0005, pin_key, (5, 2))
        return M

    def print_(zc, yc, rot, pin_key, w=0.142, h=0.098, lift=0.0, moon=False):
        M = WL(zc, yc, CORK_FACE + lift, rot)
        sheet(M, "paper", w, h)
        image(M, w - 0.012, h - 0.012, 0.0, 0.0, 0.0007, moon)
        if pin_key:
            put_pin(M, -w * 0.18, h / 2 - 0.011, 0.0005, pin_key, (4, -2))
        return M

    def sticky(zc, yc, rot, key="paper_dim", lift=0.0):
        """A sticky note: the free bottom edge curls away from the cork a little."""
        M = WL(zc, yc, CORK_FACE + lift, rot)
        n, sz = 5, 0.076
        bm = bmesh.new()
        rows = []
        for j in range(n + 1):
            t = j / n
            yy = sz / 2 - sz * t
            zz = 0.0005 + 0.024 * max(0.0, t - 0.45) ** 2
            rows.append([bm.verts.new(G(xx, yy, zz)) for xx in (-sz / 2, sz / 2)])
        for j in range(n):
            bm.faces.new((rows[j][0], rows[j + 1][0], rows[j + 1][1], rows[j][1]))  # faces out of the cork
        bm.transform(M)
        merge_bm(papers[key], bm)

    # --- the top band, above the cards
    mA = instant(1.598, 1.962, 7.0, "paper", moon=True)
    print_(1.775, 1.948, -4.0, "device")
    sticky(1.858, 1.985, 9.0, "paper", lift=0.0012)
    # a postcard: a stamp in the corner, a few lines of writing
    M = WL(2.03, 1.94, CORK_FACE, 2.5)
    sheet(M, "paper_dim", 0.135, 0.092)
    flat(M, "book_c", 0.018, 0.022, 0.048, 0.026, 0.0007)
    for k in range(4):
        flat(M, "book_a", 0.05 - 0.008 * (k % 2), 0.0016, 0.032, -0.006 - 0.012 * k, 0.0007)
    flat(M, "book_a", 0.0012, 0.07, -0.003, -0.002, 0.0007)
    put_pin(M, -0.045, 0.034, 0.0005, "device", (3, -4))
    mE = instant(2.255, 1.972, -8.0, "device")
    # ticket stub with a torn, perforated end
    tw, th = 0.125, 0.052
    M = WL(2.468, 1.936, CORK_FACE, 14.0)
    pts = [(-tw / 2, -th / 2), (tw / 2 - 0.004, -th / 2)]
    for k in range(7):
        yy = -th / 2 + th * (k + 0.5) / 7
        pts.append((tw / 2 + (0.003 if k % 2 else -0.001), yy))
    pts += [(tw / 2 - 0.002, th / 2), (-tw / 2, th / 2)]
    tb = flat_poly(pts, 0.0005, 0.0)
    tb.transform(M)
    merge_bm(papers["paper_dim"], tb)
    flat(M, "book_c", 0.0025, th - 0.014, tw / 2 - 0.03, 0.0, 0.0007)
    flat(M, "book_a", 0.05, 0.006, -0.012, 0.01, 0.0007)
    flat(M, "book_a", 0.034, 0.004, -0.02, -0.006, 0.0007)
    put_pin(M, -tw / 2 + 0.016, 0.0, 0.0005, "paper", (2, 5))
    # --- the bottom band, under the cards
    # a photo-booth strip
    M = WL(1.585, 1.302, CORK_FACE, -3.0)
    sheet(M, "paper", 0.05, 0.17)
    for k in range(3):
        image(M, 0.04, 0.045, 0.0, 0.054 - 0.052 * k, 0.0007)
    put_pin(M, 0.0, 0.074, 0.0005, "paper", (3, 3))
    sticky(1.69, 1.34, 6.0, "paper_dim", lift=0.0006)
    # a page torn from a calendar: header band and a grid of days
    cw, ch = 0.112, 0.128
    M = WL(1.862, 1.298, CORK_FACE, -2.0)
    sheet(M, "paper", cw, ch)
    flat(M, "book_c", cw - 0.012, 0.016, 0.0, ch / 2 - 0.016, 0.0007)
    gx0, gx1, gy0, gy1 = -cw / 2 + 0.006, cw / 2 - 0.006, -ch / 2 + 0.008, ch / 2 - 0.03
    for k in range(8):
        x = gx0 + (gx1 - gx0) * k / 7
        flat(M, "paper_dim", 0.0009, gy1 - gy0, x, (gy0 + gy1) / 2, 0.0007)
    for k in range(6):
        y = gy0 + (gy1 - gy0) * k / 5
        flat(M, "paper_dim", gx1 - gx0, 0.0009, 0.0, y, 0.0007)
    flat(M, "book_a", (gx1 - gx0) / 7 - 0.003, (gy1 - gy0) / 5 - 0.003, gx0 + (gx1 - gx0) * 4.5 / 7, gy0 + (gy1 - gy0) * 2.5 / 5, 0.00075)
    put_pin(M, 0.0, ch / 2 - 0.006, 0.0005, "device", (3, -3))
    print_(2.07, 1.296, 3.5, "paper", w=0.13, h=0.09, moon=True)
    # a folded note: two panels with a crease, pinned at the top
    M = WL(2.272, 1.300, CORK_FACE, -2.0)
    for k, (hh, ang) in enumerate(((0.07, 0.0), (0.075, -6.0))):
        bpan = rbox_bm((0.10, hh, 0.0005), (0, -hh / 2, 0.00025), bev=0.0, segs=1)
        bpan.transform(M @ T(0, 0.075, 0) if k == 0 else M @ T(0, 0.005, 0.0) @ RX(ang))
        merge_bm(papers["paper"], bpan)
    for k in range(3):
        flat(M, "book_a", 0.06 - 0.012 * k, 0.0016, -0.008, 0.052 - 0.012 * k, 0.0007)
    put_pin(M, 0.03, 0.063, 0.0005, "device", (3, 4))
    sticky(2.462, 1.33, 9.0, "paper")
    # string: from pin to pin across the top band, sagging over the prints
    a = mA @ G(0.0, 0.04, 0.0008)
    b = mE @ G(0.0, 0.04, 0.0008)
    path = []
    for k in range(17):
        t = k / 16
        p = a.lerp(b, t)
        p.z -= 0.05 * 4 * t * (1 - t)
        p.x = CORK_FACE + 0.0032 + 0.0005 * math.sin(t * math.pi)
        path.append(p)
    finish(tube(path, 0.0011, sides=5), "cork_string", "paper_dim", sharp_deg=80, texel=0.6)
    finish(cards, "cork_cards", "paper_dim", smooth=False, texel=2.0, recalc=False)
    for k, bm in papers.items():
        # everything paper on the board is paper_dim: the lounge lamp hangs 0.8 m in front of it
        finish(bm, "cork_paper_" + k, "paper_dim" if k == "paper" else k, smooth=False, texel=1.8 if k == "paper" else 1.3, recalc=False)
    for k, bm in pins.items():
        finish(bm, "cork_pins_" + k, k, sharp_deg=50, texel=0.7)


def _in_room(p):
    """p in glTF; same test as common.in_room when common is loaded."""
    if common is not None and hasattr(common, "in_room"):
        return common.in_room(p)
    x, y, z = p
    return -3.6 < x < 3.6 and 0.0 < y < 3.0 and -2.7 < z < 2.7


def drop_faces_into_walls(eps=0.003):
    """Delete faces that lie against a wall, the floor or the ceiling and face into it:
    they are never seen, bake black and waste atlas space."""
    removed = 0
    for ob in CREATED:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.normal_update()
        kill = []
        for f in bm.faces:
            c = mw @ f.calc_center_median()
            n = (mw.to_3x3() @ f.normal).normalized()
            out_p, in_p = c + n * eps, c - n * eps
            if not _in_room((out_p.x, out_p.z, -out_p.y)) and _in_room((in_p.x, in_p.z, -in_p.y)):
                kill.append(f)
        if kill and len(kill) < len(bm.faces):
            removed += len(kill)
            bmesh.ops.delete(bm, geom=kill, context="FACES")
            bm.to_mesh(ob.data)
            ob.data.update()
        bm.free()
    log(f"dropped {removed} faces against walls/floor")


# --------------------------------------------------------------------------- #
# Texel weights by part (x sqrt in common's unwrap): close-up surfaces get more of the atlas
TEXEL = [
    ("cork_back", 0.2), ("cork_frame", 1.1), ("cork", 1.5),
    ("radiator_sections", 0.6), ("radiator", 0.35),
    ("scope_tube", 1.0), ("scope", 0.7),
    ("cushion", 0.8), ("curtain_rod", 0.5), ("curtain_ring", 0.3), ("curtain_hook", 0.2), ("curtain", 0.9), ("rod_", 0.3), ("blind", 0.6),
    ("win_jamb", 0.8), ("win_head", 0.7), ("win_reveal_sill", 0.9), ("win_stool", 1.4), ("win_apron", 0.6), ("win_casing", 0.9),
    ("win_sash", 0.8), ("win_handle", 0.4), ("win_", 1.0),
    ("stars_led", 0.2), ("stars", 1.3), ("plant", 0.9), ("book", 1.0), ("mug", 1.0),
]


def build():
    CREATED.clear()
    build_reveal_and_casing()
    build_frame()
    build_blind()
    build_curtain_and_rod()
    build_star_counter()
    build_sill_things()
    build_radiator()
    build_telescope()
    build_cushion()
    build_corkboard()
    for ob in CREATED:
        if ob.get("texel", 1.0) != 1.0:
            continue
        for prefix, t in TEXEL:
            if ob.name.startswith(prefix):
                ob["texel"] = t
                break
    drop_faces_into_walls()
    tris = 0
    per = {}
    for ob in CREATED:
        if ob.type == "MESH":
            ob.data.calc_loop_triangles()
            n = len(ob.data.loop_triangles)
            tris += n
            k = ob.name.split(".")[0]
            per[k] = per.get(k, 0) + n
    if "--tris" in ARGS:
        for k, n in sorted(per.items(), key=lambda kv: -kv[1]):
            log(f"  {n:6d}  {k}")
    log(f"built {len(CREATED)} objects, {tris} triangles (budget {ZONES['window']['triangles']})")


# --------------------------------------------------------------------------- #
# Standalone previews: own shell, lights after spec.LIGHTS, lit Cycles renders
# --------------------------------------------------------------------------- #
def kelvin_rgb(k):
    t = k / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * (t - 60) ** -0.1332047592
        g = 288.1221695283 * (t - 60) ** -0.0755148492
        b = 255.0
    c = [srgb2lin(min(max(x, 0), 255)) for x in (r, g, b)]
    m = max(c)
    return tuple(x / m for x in c)


def standalone_shell():
    def box(name, key, x0, x1, y0, y1, z0, z1):
        bm = bm_box((x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        me.materials.append(mat(key))
    t = 0.15
    box("floor", "floor", -3.75, 3.75, -0.1, 0.0, -2.85, 2.85)
    box("ceil", "ceiling", -3.75, 3.75, 3.0, 3.1, -2.85, 2.85)
    box("wall_back", "wall", -3.75, 3.75, 0, 3, -2.85, -2.7)
    box("wall_front", "wall", -3.75, 3.75, 0, 3, 2.7, 2.85)
    box("wall_right", "wall", 3.6, 3.75, 0, 3, -2.7, 2.7)
    box("wall_left_lo", "wall", -3.6 - t, -3.6, 0, OY0, -2.7, 2.7)
    box("wall_left_hi", "wall", -3.6 - t, -3.6, OY1, 3, -2.7, 2.7)
    box("wall_left_b", "wall", -3.6 - t, -3.6, OY0, OY1, -2.7, OZ0)
    box("wall_left_f", "wall", -3.6 - t, -3.6, OY0, OY1, OZ1, 2.7)
    box("skirting", "wall_trim", -3.6, -3.585, 0, 0.08, -2.7, 2.7)
    # dark stand-ins for the neighbours
    box("standin_desk", "furniture", -0.8, 0.8, 0.7, 0.74, -2.6, -1.9)
    box("standin_lounge_seat", "fabric", -3.1, -2.3, 0.0, 0.45, 1.5, 2.4)
    box("standin_holo", "furniture", -1.9, -1.0, 0.0, 0.7, 0.9, 1.6)
    box("standin_corner_board", "paper", -3.3, -1.7, 1.0, 2.0, -2.7, -2.65)


def standalone_lights(state):
    for ob in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(ob)
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    for L in LIGHTS[state]:
        col = kelvin_rgb(L["kelvin"]) if "kelvin" in L else (1.0, 1.0, 1.0)
        if "color" in L:
            c = L["color"]
            col = hexcol(c if c.startswith("#") else PALETTE[c])
        if L["type"] == "WORLD":
            bg.inputs["Color"].default_value = (*col, 1)
            bg.inputs["Strength"].default_value = L["strength"]
            continue
        if L["type"] == "AREA":
            continue
        ld = bpy.data.lights.new(L["name"], L["type"])
        ld.color = col
        ob = bpy.data.objects.new(L["name"], ld)
        bpy.context.collection.objects.link(ob)
        if L["type"] == "SUN":
            ld.energy = L["strength"]
            ld.angle = math.radians(L.get("angle_deg", 1.0))
            ob.rotation_euler = (G(*L["direction"]) - G(0, 0, 0)).to_track_quat("-Z", "Y").to_euler()
            continue
        at = L["at"]
        at = ANCHORS[at]["at"] if isinstance(at, str) else at
        ob.location = G(*at)
        ld.energy = L["watts"]
        ld.shadow_soft_size = 0.05
        if L["type"] == "SPOT":
            aim = L["aim"]
            aim = ANCHORS[aim]["at"] if isinstance(aim, str) else aim
            ob.rotation_euler = (G(*aim) - G(*at)).to_track_quat("-Z", "Y").to_euler()
            ld.spot_size = math.radians(L["spot_deg"])
            ld.spot_blend = 0.4


def standalone():
    scene = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    standalone_shell()
    build()
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
    log("device", used)
    samples = int(ARGS[ARGS.index("--samples") + 1]) if "--samples" in ARGS else 96
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.view_settings.view_transform = "AgX"
    cams = ARGS[ARGS.index("--cams") + 1].split(",") if "--cams" in ARGS else ["window", "corkboard", "finale"]
    states = ARGS[ARGS.index("--states") + 1].split(",") if "--states" in ARGS else ["night", "dawn"]
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cd.sensor_fit = "VERTICAL"
    cd.clip_start = 0.05
    out = os.path.join(HERE, "out")
    os.makedirs(out, exist_ok=True)
    for state in states:
        standalone_lights(state)
        scene.view_settings.exposure = float(ARGS[ARGS.index("--exp") + 1]) if "--exp" in ARGS else (1.5 if state == "night" else 1.0)
        if "--fill" in ARGS:
            ld = bpy.data.lights.new("fill", "AREA")
            ld.size = 3.0
            ld.energy = 400
            fo = bpy.data.objects.new("fill", ld)
            bpy.context.collection.objects.link(fo)
            fo.location = G(-1.2, 2.9, 0.6)
            fo.rotation_euler = (G(-3.6, 1.2, 0.6) - G(-1.2, 2.9, 0.6)).to_track_quat("-Z", "Y").to_euler()
        for ci, c in enumerate(cams):
            if c.startswith("custom:"):
                vals = [float(v) for v in c[7:].split("/")]
                pos, look, fov = tuple(vals[0:3]), tuple(vals[3:6]), vals[6]
                c = "custom"
            else:
                pos, look, fov = CAMERAS[c]
            cam.location = G(*pos)
            cam.rotation_euler = (G(*look) - G(*pos)).to_track_quat("-Z", "Y").to_euler()
            cd.angle_y = math.radians(fov)
            scene.render.filepath = os.path.join(out, f"lit_window_{state}_{c}{ci if c == 'custom' else ''}.png")
            bpy.ops.render.render(write_still=True)
            log("wrote", scene.render.filepath)


if __name__ == "__main__":
    if common is not None:
        common.run_zone("window", build, cameras=["window", "corkboard", "finale"])
    else:
        standalone()
