# ruff: noqa: E501
# ruff: noqa: UP031, S311
"""Zone `lounge`: the front-left of the room. The holo table (the room's one futuristic
object) under HoloCenter, a low lounge chair with a cushion and a throw, a side table
with a book and a mug, a rug, a floor lamp at the LoungeLamp light, a pouf, a plant,
the cinema lightbox around Text_reach on the front wall, and the door with coat hooks,
a jacket, a tote bag and a skateboard leaning beside it.

Run headless (GPU):
  blender --background --factory-startup --python zone_lounge.py -- [common flags]
  extra flag: --debug-views   (with --skip-bake) also render a few close-up check views

All positions are glTF / three.js (X right, Y up, Z toward the viewer), converted with G().
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import common  # noqa: E402
from common import (  # noqa: E402
    G,
    bevel,
    bezier_path,
    bm_box,
    lathe,
    merge_bm,
    rrect_pts,
    tube,
    xform,
)
from spec import ANCHORS, DOOR, QUADS  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

# --------------------------------------------------------------------------- #
# Layout (glTF metres)
# --------------------------------------------------------------------------- #
HC = ANCHORS["HoloCenter"]["at"]
TX, TZ = HC[0], HC[2]                 # holo table centre
TOP_Y = 0.42                          # holo table top
RUG = (-2.55, -0.40, 0.80, 2.45)      # x0, x1, z0, z1
RUG_Y = 0.008                         # rug top
WALL_Z = 2.70                         # front wall face
CHAIR = (-2.58, 1.42)                 # chair footprint centre
CHAIR_YAW = math.degrees(math.atan2(TX - CHAIR[0], TZ - CHAIR[1]))  # faces the table
SIDE = (-2.33, 2.10)                  # side table
LAMP = (-2.75, 2.25)                  # floor lamp (shade centre at the LoungeLamp light, y 1.45)
LAMP_Y = 1.45
POUF = (-0.82, 1.98)
PLANT = (-2.92, 0.95)
LB = QUADS["Text_reach"]              # lightbox quad
HOOKS_X = (0.0, 0.20, 0.40)
HOOK_Y = 1.715


def floor_y(x, z):
    """Height of whatever is underfoot at (x, z): the rug or the floor."""
    return RUG_Y if (RUG[0] < x < RUG[1] and RUG[2] < z < RUG[3]) else 0.0


def gl(v):
    """Blender Vector -> glTF tuple."""
    return (v[0], v[2], -v[1])


def E(key, strength):
    return common.emissive(key, strength)


def M(key):
    return common.mat(key)


def orient_outward(bm):
    """Consistent normals, and for closed meshes pointing OUT (by signed volume).
    bmesh's recalc_face_normals alone sometimes turns a whole closed mesh inside out once it is
    rotated into place (the chair's cushions baked black); renders hide that, bakes do not."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if not bm.faces or any(not e.is_manifold for e in bm.edges):
        return bm
    c = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
    vol = 0.0
    for f in bm.faces:
        vs = [v.co - c for v in f.verts]
        for i in range(1, len(vs) - 1):
            vol += vs[0].dot(vs[i].cross(vs[i + 1]))
    if vol < 0:
        for f in bm.faces:
            f.normal_flip()
    return bm


def solid(bm, name, keys, texel=1.0, sharp=40.0, weighted=True, smooth=True, drop=()):
    """common.finish without its own recalc_face_normals (see orient_outward)."""
    orient_outward(bm)
    if drop:   # after orienting: an open mesh can no longer be oriented by volume
        cull(bm, drop)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for k in (keys if isinstance(keys, (list, tuple)) else [keys]):
        me.materials.append(k if isinstance(k, bpy.types.Material) else M(k))
    if smooth:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp))
        if weighted:
            mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
            mod.mode = "FACE_AREA"
            mod.weight = 80
            mod.keep_sharp = True
            common.apply_mods(ob)
    else:
        me.shade_flat()
    ob["texel"] = texel
    return ob


def cull(bm, dirs):
    """Delete the flat faces that look along any glTF direction in `dirs` and lie at the mesh's
    extreme in that direction (backs against the wall, bottoms on the floor): no atlas space for them."""
    kill = set()
    for d in dirs:
        db = G(*d).normalized()
        top = max(v.co.dot(db) for v in bm.verts)
        for f in bm.faces:
            if f.normal.dot(db) > 0.99 and all(abs(v.co.dot(db) - top) < 1e-4 for v in f.verts):
                kill.add(f)
    if kill:
        bmesh.ops.delete(bm, geom=list(kill), context="FACES")
    return bm


BACK = (0, 0, 1)       # faces against the front wall
DOWN = (0, -1, 0)      # faces on the floor


def rbox(name, keys, size, center, bev=0.006, segs=3, mtx=None, texel=1.0, yaw=0.0, tilt=0.0, roll=0.0, sharp=40.0, drop=()):
    """A bevelled box: size/centre glTF, rotated about its centre, then optionally by `mtx`."""
    bm = bm_box(size)
    bevel(bm, min(bev, min(size) * 0.45), segs)
    m = xform(center, yaw, tilt, roll)
    bm.transform((mtx @ m) if mtx is not None else m)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return solid(bm, name, keys, texel=texel, sharp=sharp, drop=drop)


def lathe3(profile, segs):
    """profile: (r, h, mat) triples; mat is the material of the segment that starts at the point."""
    return lathe([(r, h) for r, h, _ in profile], segs=segs, mat_of_seg=[m for _, _, m in profile[:-1]])


def pillow(w, h, t, cuts=6, edge=0.38, pinch=0.08):
    """A cushion in the local glTF XY plane, thickness along Z, centred at the origin.
    The faces bulge in the middle and pinch toward a seam at the rim."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        bx, by, bz = v.co
        u, vv, s = 2 * bx, 2 * bz, -2 * by
        f = max(0.0, (1 - u * u) * (1 - vv * vv)) ** 0.5
        thick = edge + (1 - edge) * f
        uu = u * (1 - pinch * vv * vv)
        v2 = vv * (1 - pinch * u * u)
        v.co = G(uu * w / 2, v2 * h / 2, s * thick * t / 2)
    return bm


def superellipse(cx, y, cz, a, b, n=20, p=2.6):
    pts = []
    for i in range(n):
        ang = 2 * math.pi * i / n
        c, s = math.cos(ang), math.sin(ang)
        x = a * math.copysign(abs(c) ** (2 / p), c)
        z = b * math.copysign(abs(s) ** (2 / p), s)
        pts.append(G(cx + x, y, cz + z))
    return pts


def loft_open(rings, cap_start=True, cap_end=True):
    return common.loft(rings, cap_start, cap_end)


# --------------------------------------------------------------------------- #
# The holo table
# --------------------------------------------------------------------------- #

def build_holo_table():
    y0 = RUG_Y
    T = TOP_Y
    # 0 top, 1 dark body / lens, 2 metal, 3 lens ring glow, 4 blue LED line
    prof = [
        (0.000, T - 0.019, 1),   # lens centre (dark glass dome)
        (0.022, T - 0.020, 1),
        (0.040, T - 0.023, 1),
        (0.050, T - 0.026, 2),
        (0.054, T - 0.028, 3),   # the glowing ring
        (0.082, T - 0.028, 2),
        (0.085, T - 0.026, 2),
        (0.087, T - 0.010, 2),   # bezel inner wall
        (0.091, T - 0.0055, 2),
        (0.099, T - 0.0045, 2),  # bezel crest, just under the top surface
        (0.106, T - 0.0055, 2),
        (0.110, T - 0.009, 1),
        (0.113, T - 0.012, 1),   # dark channel around the bezel
        (0.122, T - 0.012, 1),
        (0.124, T - 0.0035, 0),
        (0.1275, T, 0),
        (0.300, T, 1),           # a fine dark seam ring in the top
        (0.306, T, 0),
        (0.432, T, 0),
        (0.442, T - 0.002, 0),
        (0.4485, T - 0.0075, 0),
        (0.450, T - 0.0135, 4),  # LED line in the rim
        (0.450, T - 0.0195, 0),
        (0.4485, T - 0.0265, 0),
        (0.442, T - 0.032, 0),
        (0.432, T - 0.034, 0),   # underside of the top
        (0.372, T - 0.034, 1),
        (0.370, T - 0.040, 1),   # the electronics body
        (0.370, T - 0.072, 1),
        (0.364, T - 0.080, 1),
        (0.350, T - 0.082, 1),
        (0.075, T - 0.082, 2),
        (0.052, T - 0.094, 2),   # column
        (0.046, T - 0.110, 2),
        (0.046, y0 + 0.070, 2),
        (0.056, y0 + 0.046, 2),
        (0.085, y0 + 0.032, 1),  # foot
        (0.245, y0 + 0.029, 1),
        (0.258, y0 + 0.024, 1),
        (0.262, y0 + 0.014, 1),
        (0.258, y0 + 0.004, 1),
        (0.248, y0, 1),
        (0.000, y0, 1),
    ]
    bm = lathe3(prof, segs=56)
    bm.transform(xform((TX, 0, TZ)))
    solid(bm, "holo_table", [M("furniture_top"), M("device"), M("metal"), E("screen_glow", 7.0), E("accent", 3.0)],
          texel=2.4, sharp=50)
    # a small green "ready" light in the top, on the side of the chair
    d = Vector((CHAIR[0] - TX, CHAIR[1] - TZ)).normalized()
    p = (TX + d.x * 0.395, T, TZ + d.y * 0.395)
    led = lathe([(0, 0.0012), (0.0045, 0.0012), (0.0052, 0.0), (0.0052, -0.002)], segs=12)
    led.transform(xform(p))
    solid(led, "holo_led", [E("success", 3.0)], texel=0.6, weighted=False)
    # six fine emitter pins on the bezel crest: the projector looks engineered up close
    pins = bmesh.new()
    for i in range(6):
        a = 2 * math.pi * i / 6 + 0.26
        b = lathe([(0, 0.0032), (0.0035, 0.0032), (0.0042, 0.0), (0.0042, -0.004)], segs=8)
        b.transform(xform((TX + 0.099 * math.cos(a), T - 0.0045, TZ + 0.099 * math.sin(a))))
        merge_bm(pins, b)
    solid(pins, "holo_pins", ["metal"], texel=0.4, weighted=False)
    # the power cable: out of the foot, across the rug, up the skirting into the socket
    path = bezier_path([
        (TX + 0.02, y0 + 0.012, TZ + 0.255), (TX + 0.035, y0 + 0.0042, TZ + 0.34), (TX + 0.07, y0 + 0.0042, TZ + 0.62),
        (TX + 0.045, y0 + 0.0042, TZ + 0.95), (TX + 0.040, y0 + 0.0042, RUG[3] - 0.05), (TX + 0.040, 0.0045, RUG[3] + 0.06),
        (TX + 0.038, 0.0045, WALL_Z - 0.045), (TX + 0.035, 0.035, WALL_Z - 0.021), (TX + 0.035, 0.09, WALL_Z - 0.0075),
        (TX + 0.035, 0.235, WALL_Z - 0.0075)], n=34)
    solid(tube(path, 0.0038, sides=6), "holo_cable", ["device"], texel=0.3, weighted=False, sharp=80)


def build_socket(x, y, double=True, cables=()):
    """A wall socket plate on the front wall with plugs. cables: 'up' / 'down' per plug."""
    w = 0.152 if double else 0.082
    rbox("socket_plate", ["metal"], (w, 0.082, 0.010), (x, y, WALL_Z - 0.005), bev=0.004, segs=1, texel=0.4, drop=(BACK,))
    offs = (-0.036, 0.036) if double else (0.0,)
    for i, ox in enumerate(offs):
        if i >= len(cables):
            # an empty outlet: a recessed round face
            c = lathe([(0, -0.002), (0.019, -0.002), (0.021, 0.0015), (0.022, 0.0)], segs=16)
            c.transform(xform((x + ox, y, WALL_Z - 0.0101), tilt=-90))
            solid(c, "socket_face", ["device_key"], texel=0.3, weighted=False)
            continue
        rbox("plug", ["device"], (0.034, 0.046, 0.026), (x + ox, y, WALL_Z - 0.010 - 0.013), bev=0.006, segs=1, texel=0.3, drop=(BACK,))


# --------------------------------------------------------------------------- #
# The lightbox on the front wall
# --------------------------------------------------------------------------- #

def build_lightbox():
    cx, cy, cz = LB["at"]
    w, h = LB["size"]
    fw = 0.044          # frame width
    gap = 0.0015        # clearance between quad and frame
    zf0 = cz - 0.004    # frame front: only 4 mm proud of the face, so oblique views keep the letters
    zf1 = cz + 0.004    # frame back (behind the quad plane)
    ow, oh = w + 2 * (gap + fw), h + 2 * (gap + fw)
    # the box behind the face
    rbox("lightbox_box", ["device"], (ow - 0.012, oh - 0.012, WALL_Z - 0.0015 - (cz + 0.0015)),
         (cx, cy, (WALL_Z - 0.0015 + cz + 0.0015) / 2), bev=0.008, segs=2, texel=0.5, drop=(BACK, (0, 0, -1)))
    # the frame: four bars (top and bottom full width)
    fz = (zf0 + zf1) / 2
    fd = zf1 - zf0
    rbox("lightbox_frame", ["metal"], (ow, fw, fd), (cx, cy + h / 2 + gap + fw / 2, fz), bev=0.005, segs=2, texel=1.0)
    rbox("lightbox_frame", ["metal"], (ow, fw, fd), (cx, cy - h / 2 - gap - fw / 2, fz), bev=0.005, segs=2, texel=1.0)
    for sx in (-1, 1):
        rbox("lightbox_frame", ["metal"], (fw, h + 2 * gap + 0.002, fd), (cx + sx * (w / 2 + gap + fw / 2), cy, fz), bev=0.005, segs=2, texel=1.0)
    # thin rails along the top and bottom inner lips (outside the quad)
    for sy in (-1, 1):
        rbox("lightbox_rail", ["device_key"], (w + 2 * gap, 0.006, 0.004), (cx, cy + sy * (h / 2 + gap + 0.004), zf0 + 0.0015), bev=0.0015, segs=1, texel=0.5)
    # corner caps
    for sx in (-1, 1):
        for sy in (-1, 1):
            rbox("lightbox_cap", ["device"], (0.050, 0.050, 0.016), (cx + sx * (ow / 2 - 0.022), cy + sy * (oh / 2 - 0.022), zf0 + 0.007), bev=0.006, segs=1, texel=0.5)
    # its cable: from the box's bottom edge straight down the wall into the socket
    xc = TX - 0.035 + 0.072
    path = [G(xc, cy - oh / 2 + 0.01, WALL_Z - 0.03), G(xc, cy - oh / 2 - 0.02, WALL_Z - 0.0085), G(xc, cy - oh / 2 - 0.06, WALL_Z - 0.0075),
            G(xc, 0.32, WALL_Z - 0.0075), G(xc, 0.302, WALL_Z - 0.012)]
    solid(tube(path, 0.0035, sides=8), "lightbox_cable", ["device"], texel=0.25, weighted=False, sharp=80)
    build_socket(TX, 0.28, double=True, cables=("down", "up"))


# --------------------------------------------------------------------------- #
# Rug, chair, side table, lamp, pouf, plant
# --------------------------------------------------------------------------- #

def build_rug():
    x0, x1, z0, z1 = RUG
    hx, hz = (x1 - x0) / 2, (z1 - z0) / 2
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    rad = (0.05,) * 4
    rings, mats = [], []
    spec_rings = [  # (inset, height, material of the band that starts here)
        (0.0, 0.0, 0), (0.0, RUG_Y - 0.003, 0), (0.003, RUG_Y, 0), (0.075, RUG_Y, 1), (0.095, RUG_Y, 0), (0.25, RUG_Y, 0)]
    for inset, y, mi in spec_rings:
        rr = tuple(max(r - inset, 0.004) for r in rad)
        pts = rrect_pts(hx - inset, hz - inset, rr, n=6, cx=cx, cz=cz)
        rings.append([Vector((px, py, y)) for px, py in pts])
        mats.append(mi)
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for k in range(len(vr) - 1):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((vr[k][i], vr[k][j], vr[k + 1][j], vr[k + 1][i]))
            f.material_index = mats[k]
    f = bm.faces.new(vr[-1])
    f.material_index = 0
    bmesh.ops.triangulate(bm, faces=[f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        if f.normal.z < -0.5:
            f.normal_flip()
    solid(bm, "rug", ["rug", "book_c"], texel=0.7, sharp=60, weighted=False)


def build_chair():
    Mc = xform((CHAIR[0], 0, CHAIR[1]), CHAIR_YAW)
    W, D = 0.84, 0.80
    fab = ["fabric"]
    # legs: short, tapered, a little splayed; each reaches the floor or the rug under it
    for lx in (-0.33, 0.33):
        for lz in (-0.30, 0.30):
            wp = gl(Mc @ G(lx, 0, lz))
            fy = floor_y(wp[0], wp[2])
            sx, sz = math.copysign(0.018, lx), math.copysign(0.018, lz)
            rings = []
            for y, hw, o in ((fy, 0.013, 1.0), (fy + 0.003, 0.015, 0.97), (0.135, 0.022, 0.0)):
                rings.append([Mc @ G(lx + sx * o + ax * hw, y, lz + sz * o + az * hw) for ax, az in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
            b = common.loft(rings)
            bevel(b, 0.004, 1, angle=50)
            solid(b, "chair_leg", ["furniture"], texel=0.5, drop=(DOWN,))
    # upholstered body, arms and back
    rbox("chair_base", fab, (W, 0.20, D), (0, 0.235, 0), bev=0.035, segs=3, mtx=Mc, texel=1.2, drop=(DOWN,))
    for sx in (-1, 1):
        rbox("chair_arm", fab, (0.13, 0.31, D - 0.02), (sx * (W / 2 - 0.065), 0.475, 0.01), bev=0.05, segs=4, mtx=Mc, texel=1.3)
    rbox("chair_back", fab, (W, 0.64, 0.15), (0, 0.46, -D / 2 + 0.075), bev=0.055, segs=4, mtx=Mc, tilt=4, texel=1.3)
    # seat cushion and back cushion
    b = pillow(0.575, 0.62, 0.13, cuts=6, edge=0.55, pinch=0.03)
    b.transform(Mc @ xform((0, 0.392, 0.075), tilt=-90))
    solid(b, "chair_seat", fab, texel=1.6, sharp=75)
    b = pillow(0.565, 0.40, 0.15, cuts=6, edge=0.45, pinch=0.05)
    b.transform(Mc @ xform((0, 0.635, -0.185), tilt=13))
    solid(b, "chair_backcushion", fab, texel=1.5, sharp=75)
    # a cushion in the corner by the lamp (the sitter's right, local -x)
    b = pillow(0.40, 0.36, 0.13, cuts=5, edge=0.32, pinch=0.1)
    b.transform(Mc @ xform((-0.14, 0.598, -0.07), yaw=24, tilt=19, roll=-6))
    solid(b, "chair_cushion", ["book_a"], texel=1.4, sharp=75)
    build_throw(Mc)


def build_throw(Mc):
    """A knitted throw folded over the chair's left arm (local +x), hanging down its outside."""
    ax = 0.84 / 2 - 0.065        # arm centre x
    top = 0.475 + 0.155          # arm top
    cross = [(ax - 0.068, 0.455), (ax - 0.071, 0.52), (ax - 0.067, top - 0.035), (ax - 0.052, top - 0.008), (ax - 0.025, top + 0.006),
             (ax + 0.010, top + 0.008), (ax + 0.040, top + 0.0), (ax + 0.062, top - 0.02), (ax + 0.0715, top - 0.06),
             (ax + 0.073, top - 0.14), (ax + 0.074, top - 0.24), (ax + 0.076, top - 0.33), (ax + 0.079, top - 0.40)]
    # resample along the polyline for even spacing
    pts = [Vector(p) for p in cross]
    seg = [(pts[i + 1] - pts[i]).length for i in range(len(pts) - 1)]
    L = sum(seg)
    nc = 16
    res = []
    for k in range(nc + 1):
        t = L * k / nc
        i = 0
        while i < len(seg) - 1 and t > seg[i]:
            t -= seg[i]
            i += 1
        res.append(pts[i].lerp(pts[i + 1], min(t / seg[i], 1.0)))
    nz = 14
    z0, z1 = -0.14, 0.34
    bm = bmesh.new()
    grid = []
    for r in range(nz + 1):
        u = r / nz
        row = []
        for p in res:
            x, y = p.x, p.y
            hang = max(0.0, (top - 0.03 - y)) / 0.37 if x > ax else 0.0      # 0 on top, 1 at the hem
            z = z0 + (z1 - z0) * u
            zc = (z0 + z1) / 2
            z = zc + (z - zc) * (1 + 0.10 * hang)                           # the hem flares a little
            fold = 0.024 * hang * abs(math.sin(math.pi * (u * 3.2 + 0.15)))  # soft folds, outward only
            x += fold
            y += 0.012 * hang * math.sin(math.pi * u * 2.3)                  # uneven hem
            if x < ax:   # the inner side tucks down between arm and seat
                x -= 0.002
            row.append(bm.verts.new(Mc @ G(x, y, z)))
        grid.append(row)
    for r in range(nz):
        for k in range(nc):
            bm.faces.new((grid[r][k], grid[r][k + 1], grid[r + 1][k + 1], grid[r + 1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.011)
    solid(bm, "chair_throw", ["book_b"], texel=1.5, sharp=70)


def build_side_table():
    x, z = SIDE
    fy = floor_y(x, z)
    top = 0.55
    prof = [(0.0, top - 0.002, 0), (0.172, top - 0.002, 0), (0.178, top + 0.002, 0), (0.181, top + 0.014, 0), (0.186, top + 0.017, 0),
            (0.192, top + 0.014, 0), (0.195, top + 0.004, 0), (0.195, top - 0.012, 0), (0.19, top - 0.018, 0), (0.0, top - 0.018, 0)]
    b = lathe3(prof, segs=32)
    b.transform(xform((x, 0, z)))
    solid(b, "side_top", ["furniture_top"], texel=1.4, sharp=50)
    b = lathe([(0.0, top - 0.018), (0.012, top - 0.018), (0.012, fy + 0.03), (0.02, fy + 0.022)], segs=14)
    b.transform(xform((x, 0, z)))
    solid(b, "side_rod", ["metal"], texel=0.5, sharp=50)
    b = lathe([(0.0, fy + 0.022), (0.118, fy + 0.020), (0.125, fy + 0.014), (0.125, fy + 0.004), (0.12, fy), (0.0, fy)], segs=32)
    b.transform(xform((x, 0, z)))
    solid(b, "side_foot", ["device"], texel=0.6, sharp=50, drop=(DOWN,))
    # a paperback, a little turned, with a pencil on it
    ty = top - 0.002
    bx, bz, rot = x + 0.035, z - 0.045, 28.0
    w, d, t = 0.125, 0.185, 0.019
    pb = bm_box((w - 0.006, t - 0.003, d - 0.006), (0.003, t / 2, 0))
    bevel(pb, 0.0015, 1)
    pb.transform(xform((bx, ty, bz), rot))
    solid(pb, "book_pages", ["paper_dim"], texel=0.8)
    for yy in (0.0012, t - 0.0012):
        cv = bm_box((w, 0.0024, d), (0, yy, 0))
        bevel(cv, 0.0008, 1)
        cv.transform(xform((bx, ty, bz), rot))
        solid(cv, "book_cover", ["book_a"], texel=0.9)
    sp = bm_box((0.004, t, d), (-w / 2 + 0.002, t / 2, 0))
    bevel(sp, 0.0015, 2)
    sp.transform(xform((bx, ty, bz), rot))
    solid(sp, "book_spine", ["book_a"], texel=0.6)
    pen = tube([G(-0.05, 0.004, 0.0), G(0.075, 0.004, 0.0)], 0.0035, sides=8)
    pen.transform(xform((bx, ty + t, bz), rot + 70))
    solid(pen, "pencil", ["book_c"], texel=0.3, weighted=False)
    # a mug of coffee
    mx, mz = x - 0.075, z + 0.075
    prof = [(0.0, 0.0, 0), (0.033, 0.0, 0), (0.038, 0.004, 0), (0.040, 0.02, 0), (0.040, 0.088, 0), (0.0395, 0.094, 0), (0.0375, 0.095, 0),
            (0.0355, 0.091, 0), (0.0355, 0.072, 1), (0.0, 0.072, 1)]
    b = lathe3(prof, segs=20)
    b.transform(xform((mx, ty, mz)))
    ang = math.radians(150)  # handle toward the chair
    c = G(mx, ty, mz)
    hp = []
    for i in range(11):
        tt = math.radians(-80 + 160 * i / 10)
        rr = 0.039 + 0.022 * math.cos(tt)
        hh = 0.050 + 0.028 * math.sin(tt)
        hp.append(c + Vector((rr * math.cos(ang), rr * math.sin(ang), hh)))
    merge_bm(b, tube(hp, 0.0052, sides=8))
    solid(b, "mug", ["paper_dim", "device"], texel=1.0)


def build_lamp():
    x, z = LAMP
    fy = floor_y(x, z)
    b = lathe([(0.0, fy + 0.026), (0.11, fy + 0.024), (0.128, fy + 0.016), (0.132, fy + 0.006), (0.128, fy), (0.0, fy)], segs=36)
    b.transform(xform((x, 0, z)))
    solid(b, "lamp_base", ["device"], texel=0.7, sharp=50, drop=(DOWN,))
    b = lathe([(0.0, fy + 0.026), (0.011, fy + 0.026), (0.011, LAMP_Y - 0.10), (0.016, LAMP_Y - 0.09), (0.016, LAMP_Y - 0.045), (0.012, LAMP_Y - 0.035), (0.0, LAMP_Y - 0.035)], segs=14)
    b.transform(xform((x, 0, z)))
    solid(b, "lamp_pole", ["metal"], texel=0.5, sharp=50)
    # drum shade (dark linen outside, pale inside), open top and bottom
    # The shade hangs low around the light: its top stays at y 1.495 so the corkboard camera's
    # sight lines to Text_quote3 (all above y 1.50 at this x) pass over it with margin.
    y0, y1 = 1.24, 1.48
    r0, r1 = 0.185, 0.165
    # A cover over most of the top with a hole that clears the light's 5 cm radius: seen from above
    # (corkboard, finale) it is dark linen instead of the lit inside, which clipped to white.
    hole = 0.065
    prof = [(r0 - 0.004, y0 + 0.004, 0), (r0, y0, 0), (r0 + 0.002, y0 + 0.003, 0), (r1 + 0.002, y1 - 0.003, 0), (r1, y1, 0),
            (hole + 0.003, y1, 0), (hole, y1 - 0.002, 1), (hole + 0.003, y1 - 0.004, 1),
            (r1 - 0.004, y1 - 0.004, 1), (r0 - 0.0041, y0 + 0.0045, 1)]
    b = lathe3(prof, segs=40)
    b.transform(xform((x, 0, z)))
    solid(b, "lamp_shade", ["fabric", "device"], texel=1.0, sharp=60)
    # spider: three arms from the socket to the lower rim
    arms = bmesh.new()
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.4
        p0 = G(x + 0.014 * math.cos(a), LAMP_Y - 0.06, z + 0.014 * math.sin(a))
        p1 = G(x + (r0 - 0.006) * math.cos(a), y0 + 0.012, z + (r0 - 0.006) * math.sin(a))
        merge_bm(arms, tube([p0, p1], 0.0022, sides=6))
    solid(arms, "lamp_spider", ["metal"], texel=0.2, weighted=False)
    # the cable: along the floor behind, with a foot switch, into a socket by the corner
    sx = -2.96
    path = bezier_path([(x - 0.02, fy + 0.006, z + 0.128), (x - 0.06, 0.0045, z + 0.22), (sx + 0.03, 0.0045, z + 0.33),
                        (sx, 0.0045, WALL_Z - 0.045), (sx, 0.035, WALL_Z - 0.021), (sx, 0.09, WALL_Z - 0.0075), (sx, 0.235, WALL_Z - 0.0075)], n=26)
    solid(tube(path, 0.0034, sides=6), "lamp_cable", ["device"], texel=0.25, weighted=False, sharp=80)
    k = len(path) // 3
    d = (path[k + 1] - path[k - 1]).normalized()
    yaw = math.degrees(math.atan2(d.x, -d.y))
    sw = bm_box((0.05, 0.022, 0.085), (0, 0.011, 0))
    bevel(sw, 0.008, 2)
    px, _, pz = gl(path[k])
    sw.transform(xform((px, 0.0, pz), yaw))
    solid(sw, "lamp_switch", ["device"], texel=0.3, drop=(DOWN,))
    build_socket(sx, 0.28, double=False, cables=("down",))


def build_pouf():
    x, z = POUF
    fy = floor_y(x, z)
    prof = [(0.0, 0.0), (0.24, 0.0), (0.275, 0.008), (0.298, 0.035), (0.306, 0.075), (0.303, 0.115), (0.29, 0.15), (0.262, 0.178), (0.21, 0.193),
            (0.12, 0.199), (0.04, 0.194), (0.014, 0.184), (0.0, 0.182)]
    b = lathe([(r, fy + h) for r, h in prof], segs=32)
    b.transform(xform((x, 0, z)))
    solid(b, "pouf", ["book_c"], texel=1.0, sharp=70, drop=(DOWN,))
    # piping seam around the equator
    ring = [G(x + 0.307 * math.cos(2 * math.pi * i / 24), fy + 0.095, z + 0.307 * math.sin(2 * math.pi * i / 24)) for i in range(25)]
    solid(tube(ring, 0.006, sides=5, caps=False), "pouf_piping", ["fabric"], texel=0.4, sharp=80)


def build_plant():
    px, pz = PLANT
    prof = [(0.0, 0.0, 0), (0.095, 0.0, 0), (0.102, 0.008, 0), (0.12, 0.26, 0), (0.123, 0.275, 0), (0.117, 0.278, 0), (0.111, 0.255, 1), (0.0, 0.255, 1)]
    b = lathe3(prof, segs=32)
    b.transform(xform((px, 0, pz)))
    solid(b, "plant_pot", ["pot", "device"], texel=0.9, sharp=50, drop=(DOWN,))
    import random
    rng = random.Random(11)
    leaves = bmesh.new()
    n = 7
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.25, 0.25)
        h = rng.uniform(0.36, 0.64)
        lean = rng.uniform(0.04, 0.12)
        wid = rng.uniform(0.07, 0.095)
        rad = 0.02 + 0.045 * rng.uniform(0, 1)
        segs = 7
        base = Vector((px + rad * math.cos(a), 0.25, pz + rad * math.sin(a)))
        out = Vector((math.cos(a), 0, math.sin(a)))
        tw = rng.uniform(0.3, 1.1)
        rows_f, rows_b = [], []
        for s in range(segs + 1):
            t = s / segs
            ctr = base + Vector((0, h * t, 0)) + out * (lean * t * t)
            w = max(wid * (1 - t ** 2.2) * (0.75 + 0.35 * math.sin(math.pi * min(t * 1.4, 1))), 0.0015)
            ang = a + 1.5708 + tw * t * 0.6
            side = Vector((math.cos(ang), 0, math.sin(ang)))
            nrm = Vector((-side.z, 0, side.x))
            fold = nrm * 0.006
            row = [ctr - side * w / 2, ctr + fold, ctr + side * w / 2]
            rows_f.append([G(*p) for p in row])
            rows_b.append([G(*(p - nrm * 0.004)) for p in row])
        vf = [[leaves.verts.new(p) for p in r] for r in rows_f]
        vb = [[leaves.verts.new(p) for p in r] for r in rows_b]
        for s in range(segs):
            for k in range(2):
                leaves.faces.new((vf[s][k], vf[s][k + 1], vf[s + 1][k + 1], vf[s + 1][k]))
                leaves.faces.new((vb[s][k], vb[s + 1][k], vb[s + 1][k + 1], vb[s][k + 1]))
            leaves.faces.new((vf[s][0], vf[s + 1][0], vb[s + 1][0], vb[s][0]))
            leaves.faces.new((vf[s][2], vb[s][2], vb[s + 1][2], vf[s + 1][2]))
    bmesh.ops.remove_doubles(leaves, verts=leaves.verts, dist=1e-5)
    solid(leaves, "plant_leaves", ["plant"], texel=0.8, sharp=70, weighted=False)


# --------------------------------------------------------------------------- #
# The door, the coat hooks, a jacket, a tote, a skateboard
# --------------------------------------------------------------------------- #

def build_door():
    x0, x1 = DOOR["x"]
    y1 = DOOR["y"][1]
    cw, cd = 0.075, 0.026         # casing width and depth
    ov = 0.012                     # casing overlaps the opening (hides the reveal bevel)
    zc = WALL_Z - cd / 2
    rbox("door_casing", ["wall_trim"], (cw, y1 + cw - ov, cd), (x0 - cw / 2 + ov, (y1 + cw - ov) / 2, zc), bev=0.005, segs=2, texel=0.4, drop=(BACK, DOWN))
    rbox("door_casing", ["wall_trim"], (cw, y1 + cw - ov, cd), (x1 + cw / 2 - ov, (y1 + cw - ov) / 2, zc), bev=0.005, segs=2, texel=0.4, drop=(BACK, DOWN))
    rbox("door_casing", ["wall_trim"], (x1 - x0 + 2 * cw - 2 * ov, cw, cd), ((x0 + x1) / 2, y1 + cw / 2 - ov, zc), bev=0.005, segs=2, texel=0.4, drop=(BACK,))
    # the leaf, set back in the opening
    lz0, lz1 = WALL_Z + 0.035, WALL_Z + 0.075
    rbox("door_leaf", ["furniture_top"], (x1 - x0 - 0.006, y1 - 0.008, lz1 - lz0), ((x0 + x1) / 2, (y1 - 0.008) / 2 + 0.005, (lz0 + lz1) / 2), bev=0.004, segs=2, texel=0.35, drop=(BACK, DOWN))
    # threshold plate filling the floor of the opening
    rbox("door_threshold", ["metal"], (x1 - x0, 0.007, 0.105), ((x0 + x1) / 2, 0.0035, WALL_Z + 0.042), bev=0.002, segs=1, texel=0.3, drop=(DOWN,))
    # hinges on the right edge, the handle on the left
    for hy in (0.24, 1.05, 1.86):
        b = lathe([(0, -0.05), (0.0075, -0.05), (0.0085, -0.045), (0.0085, 0.045), (0.0075, 0.05), (0, 0.05)], segs=8)
        b.transform(xform((x1 - 0.004, hy, lz0 - 0.002), tilt=0))
        solid(b, "door_hinge", ["metal"], texel=0.2, weighted=False, sharp=50)
    hx, hy = x0 + 0.075, 1.02
    rose = lathe([(0, 0.0), (0.026, 0.0), (0.027, 0.004), (0.024, 0.009), (0.0, 0.009)], segs=20)
    rose.transform(xform((hx, hy, lz0), tilt=90))
    solid(rose, "door_rose", ["metal"], texel=0.3, sharp=50)
    lever = tube([G(hx, hy, lz0 - 0.008), G(hx, hy, lz0 - 0.040), G(hx + 0.012, hy, lz0 - 0.050), G(hx + 0.12, hy - 0.002, lz0 - 0.052)], 0.0085, sides=10)
    solid(lever, "door_lever", ["metal"], texel=0.3, sharp=60)
    key = lathe([(0, 0.0), (0.014, 0.0), (0.015, 0.003), (0.0, 0.005)], segs=14)
    key.transform(xform((hx, hy - 0.10, lz0), tilt=90))
    solid(key, "door_escutcheon", ["metal"], texel=0.2, weighted=False)


def build_hooks():
    bx0, bx1 = HOOKS_X[0] - 0.12, HOOKS_X[-1] + 0.12
    rbox("hook_rail", ["furniture_top"], (bx1 - bx0, 0.075, 0.022), ((bx0 + bx1) / 2, HOOK_Y + 0.012, WALL_Z - 0.011), bev=0.005, segs=2, texel=0.6, drop=(BACK,))
    for hx in HOOKS_X:
        p = [G(hx, HOOK_Y, WALL_Z - 0.02), G(hx, HOOK_Y - 0.004, WALL_Z - 0.06), G(hx, HOOK_Y + 0.004, WALL_Z - 0.082),
             G(hx, HOOK_Y + 0.022, WALL_Z - 0.086)]
        b = tube(bezier_path([gl(v) for v in p], n=7), 0.0058, sides=8)
        e = bmesh.new()
        bmesh.ops.create_uvsphere(e, u_segments=8, v_segments=5, radius=0.0085)
        e.transform(xform(gl(p[-1])))
        merge_bm(b, e)
        solid(b, "hook", ["metal"], texel=0.3, sharp=60)


def build_jacket():
    hx = HOOKS_X[0]
    hz = WALL_Z - 0.084             # the hook's tip
    rings_spec = [  # y, half-width, half-depth, centre z
        (HOOK_Y + 0.020, 0.012, 0.010, hz + 0.004),
        (HOOK_Y + 0.004, 0.040, 0.020, hz + 0.010),
        (HOOK_Y - 0.040, 0.105, 0.040, WALL_Z - 0.044),
        (HOOK_Y - 0.100, 0.185, 0.058, WALL_Z - 0.062),
        (HOOK_Y - 0.180, 0.225, 0.070, WALL_Z - 0.074),
        (HOOK_Y - 0.310, 0.232, 0.076, WALL_Z - 0.080),
        (HOOK_Y - 0.500, 0.224, 0.072, WALL_Z - 0.076),
        (HOOK_Y - 0.680, 0.214, 0.064, WALL_Z - 0.068),
        (HOOK_Y - 0.735, 0.205, 0.056, WALL_Z - 0.060),
        (HOOK_Y - 0.748, 0.190, 0.045, WALL_Z - 0.050),
    ]
    rings = [superellipse(hx, y, zc, a, b, n=22, p=2.4) for y, a, b, zc in rings_spec]
    bm = common.loft(rings)
    solid(bm, "jacket", ["book_c"], texel=0.8, sharp=70)
    # sleeves hanging down the front
    for sx in (-1, 1):
        path = bezier_path([(hx + sx * 0.17, HOOK_Y - 0.115, WALL_Z - 0.105), (hx + sx * 0.198, HOOK_Y - 0.30, WALL_Z - 0.140),
                            (hx + sx * 0.188, HOOK_Y - 0.55, WALL_Z - 0.140), (hx + sx * 0.176, HOOK_Y - 0.66, WALL_Z - 0.132)], n=10)
        b = tube(path, 0.046, sides=10)
        solid(b, "jacket_sleeve", ["book_c"], texel=0.6, sharp=70)
    # a zip line down the front
    zp = [G(hx, HOOK_Y - 0.07, WALL_Z - 0.104), G(hx, HOOK_Y - 0.30, WALL_Z - 0.157), G(hx, HOOK_Y - 0.72, WALL_Z - 0.124)]
    solid(tube(bezier_path([gl(v) for v in zp], n=12), 0.003, sides=6), "jacket_zip", ["device"], texel=0.2, weighted=False)


def build_tote():
    hx = HOOKS_X[2]
    hz = WALL_Z - 0.084
    w, h, t = 0.31, 0.37, 0.065
    cy = HOOK_Y - 0.36
    b = pillow(w, h, t, cuts=5, edge=0.35, pinch=0.05)
    b.transform(xform((hx, cy, WALL_Z - t * 0.5 - 0.004), tilt=-3))
    solid(b, "tote", ["paper_dim"], texel=0.8, sharp=75)
    for sx in (-1, 1):
        p = bezier_path([(hx + sx * 0.085, cy + h / 2 - 0.02, WALL_Z - 0.040), (hx + sx * 0.05, cy + h / 2 + 0.10, WALL_Z - 0.065),
                         (hx + sx * 0.012, HOOK_Y + 0.006, hz + 0.003)], n=10)
        bt = tube(p, 0.0065, sides=6)
        solid(bt, "tote_strap", ["paper_dim"], texel=0.3, weighted=False)


def build_skateboard():
    """A skateboard leaning against the wall under the hooks, wheels toward the room."""
    L, Wd = 0.40, 0.104
    rows = []
    ss = [-L + L * (1 - math.cos(math.pi / 2 * k / 6)) * 0.26 / 1.0 for k in range(7)]  # dense near the tail
    ss = sorted(set([round(s, 5) for s in ss] + [round(-L + 0.104 + 0.6 * k / 14, 5) for k in range(15)]
                    + [round(L - (s + L), 5) for s in ss]))
    nx = 4
    for s in ss:
        a = abs(s)
        w = Wd if a <= L - Wd else math.sqrt(max(Wd * Wd - (a - (L - Wd)) ** 2, 0.0))
        w = max(w, 0.006)
        kick = 0.0 if a <= 0.255 else ((a - 0.255) / 0.145) ** 1.7 * 0.048
        row = []
        for i in range(nx + 1):
            x = -w + 2 * w * i / nx
            z = kick + 0.004 * (x / Wd) ** 2
            row.append((x, s, z))
        rows.append(row)
    bm = bmesh.new()
    vs = [[bm.verts.new(G(*p)) for p in r] for r in rows]
    for r in range(len(vs) - 1):
        for i in range(nx):
            bm.faces.new((vs[r][i], vs[r][i + 1], vs[r + 1][i + 1], vs[r + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # the grip faces +z; make sure the sheet's normals point there, then thicken toward -z
    if sum(f.normal.dot(G(0, 0, 1)) for f in bm.faces) < 0:
        for f in bm.faces:
            f.normal_flip()
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=-0.011)
    deck = bm
    parts = [(deck, ["device", "book_b"], "skate_deck", 0.7)]
    # trucks and wheels on the -z side
    for s in (-0.215, 0.215):
        bp = bm_box((0.055, 0.075, 0.010), (0, s, -0.016))
        bevel(bp, 0.002, 1)
        parts.append((bp, ["metal"], "skate_base", 0.2))
        kp = bm_box((0.034, 0.03, 0.026), (0, s, -0.034))
        bevel(kp, 0.006, 2)
        parts.append((kp, ["metal"], "skate_truck", 0.2))
        ax = tube([G(-0.085, s, -0.047), G(0.085, s, -0.047)], 0.0075, sides=8)
        parts.append((ax, ["metal"], "skate_axle", 0.2))
        for sx in (-1, 1):
            wl = lathe([(0, -0.016), (0.02, -0.016), (0.026, -0.013), (0.027, 0.0), (0.026, 0.013), (0.02, 0.016), (0, 0.016)], segs=12)
            wl.transform(xform((sx * 0.094, s, -0.047)) @ xform(roll=90))
            parts.append((wl, ["paper"], "skate_wheel", 0.3))
    # lean it: top toward the wall, then sit it on the floor touching the wall
    tilt = -17.0
    R = xform((0.15, 0, 0), yaw=8, tilt=tilt)
    for b, _, _, _ in parts:
        b.transform(R)
    ymin = min(v.co.z for b, _, _, _ in parts for v in b.verts)
    ymax_b = max(-v.co.y for b, _, _, _ in parts for v in b.verts)   # max glTF z
    T = xform((0, -ymin, WALL_Z - 0.003 - ymax_b))
    for b, keys, name, tx in parts:
        b.transform(T)
        ob = solid(b, name, keys, texel=tx, sharp=55)
        if name == "skate_deck":
            # the grip side (toward the wall) black, the graphic side grey
            nwall = G(0, 0, 1)
            for p in ob.data.polygons:
                p.material_index = 0 if p.normal.dot(nwall) > 0.2 else 1


# --------------------------------------------------------------------------- #
# build()
# --------------------------------------------------------------------------- #

def build():
    before = set(bpy.data.objects)
    build_rug()
    build_holo_table()
    build_lightbox()
    build_chair()
    build_side_table()
    build_lamp()
    build_pouf()
    build_plant()
    build_door()
    build_hooks()
    build_jacket()
    build_tote()
    build_skateboard()
    common.make_quad("Text_reach")
    common.make_anchor("HoloCenter")
    check_layout([o for o in bpy.data.objects if o not in before])


HOLO_R, HOLO_Y = 1.3, 0.80   # the coordinator's keep-out: nothing above y 0.80 within 1.3 m of HoloCenter


def check_layout(objs):
    """Report: parts above HOLO_Y within HOLO_R of HoloCenter, outside the zone box, in CLEAR,
    and parts that block a camera's view of a quad (rays to a 9x5 grid on each quad)."""
    from mathutils.bvhtree import BVHTree
    from spec import CAMERAS, CLEAR, ZONES
    x0, x1, z0, z1, ytop = ZONES["lounge"]["box"]
    holo, box, clear, tris = [], [], [], 0
    per = {}
    meshes = [o for o in objs if o.type == "MESH" and not o.get("quad")]
    for o in meshes:
        me = o.data
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        key = o.name.split(".")[0]
        per[key] = per.get(key, 0) + len(me.loop_triangles)
        pts = [gl(o.matrix_world @ v.co) for v in me.vertices]
        if any(y > HOLO_Y and math.hypot(x - TX, z - TZ) < HOLO_R for x, y, z in pts):
            holo.append(o.name)
        bad = next(((x, y, z) for x, y, z in pts if not (x0 - 0.001 <= x <= x1 + 0.001 and z0 - 0.001 <= z <= z1 + 0.12 and y <= ytop)), None)
        if bad:
            box.append("%s(%.2f,%.2f,%.2f)" % ((o.name,) + bad))
        if any(y > 0.5 and CLEAR["x"][0] < x < CLEAR["x"][1] and CLEAR["z"][0] < z < CLEAR["z"][1] for x, y, z in pts):
            clear.append(o.name)
    # one BVH per part, so a hit can be named
    trees = []
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.transform(o.matrix_world)
        trees.append((o.name.split(".")[0], BVHTree.FromBMesh(bm)))
        bm.free()
    views = {"corkboard": ["Text_quote1", "Text_quote2", "Text_quote3"], "holo": ["Text_reach"], "window": ["Text_stars"]}
    blocks = []
    for cam, qnames in views.items():
        cpos = G(*CAMERAS[cam][0])
        for qn in qnames:
            q = QUADS[qn]
            w, h = q["size"]
            m = common.quad_matrix(q)
            for i in range(9):
                for j in range(5):
                    tgt = m @ Vector(((i / 8 - 0.5) * 0.97 * w, 0.0, (j / 4 - 0.5) * 0.94 * h))
                    d = tgt - cpos
                    dist = d.length
                    for nm, t in trees:
                        hit = t.ray_cast(cpos, d.normalized(), dist - 0.01)
                        if hit[0] is not None:
                            blocks.append("%s:%s by %s" % (cam, qn, nm))
    common.log("lounge triangles by part: " + ", ".join("%s %d" % kv for kv in sorted(per.items(), key=lambda kv: -kv[1])[:40]))
    common.log("lounge check: %d triangles; above y %.2f within %.1f m of HoloCenter: %s; outside box: %s; in CLEAR: %s; blocking quads: %s" % (
        tris, HOLO_Y, HOLO_R, sorted(set(holo)) or "none", box or "none", clear or "none", sorted(set(blocks)) or "none"))


DEBUG_VIEWS = {
    "dbg_chair": ((-1.25, 1.25, 0.55), (-2.55, 0.5, 1.6), 42),
    "dbg_table": ((-0.75, 1.05, 0.55), (-1.45, 0.38, 1.25), 38),
    "dbg_door": ((0.2, 1.45, 0.6), (0.6, 1.0, 2.7), 55),
    "dbg_lightbox": ((-1.45, 1.6, 0.9), (-1.45, 1.9, 2.7), 50),
    "dbg_top": ((-1.2, 2.95, 1.0), (-1.2, 0.0, 1.7), 75),
}


def debug_views():
    scene = bpy.context.scene
    common.setup_lights("night")
    common.set_view(scene, "night")
    scene.view_settings.exposure = float(ARGS[ARGS.index("--debug-exposure") + 1]) if "--debug-exposure" in ARGS else 2.5
    if "dbg_top" in DEBUG_VIEWS:
        ceil = bpy.data.objects.get("Shell_ceiling")
    for name, (pos, tgt, fov) in DEBUG_VIEWS.items():
        cam = common.look_at_cam(name, pos, tgt, fov)
        scene.camera = cam
        if ceil is not None:
            ceil.hide_render = name == "dbg_top"
        occ = bpy.data.objects.get("Occ_ceiling")
        if occ is not None:
            occ.hide_render = name == "dbg_top"
        scene.render.filepath = common.OUT + "/lit_lounge_%s.png" % name
        bpy.ops.render.render(write_still=True)
        common.log("debug render", scene.render.filepath)


if __name__ == "__main__":
    common.run_zone("lounge", build, cameras=["holo", "finale"])
    if common.SKIP_BAKE and "--debug-views" in ARGS:
        debug_views()
