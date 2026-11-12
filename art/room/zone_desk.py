# ruff: noqa: E501
# ruff: noqa: UP031, I001
"""Zone 'desk': the desk at the back wall and the wall above it.

blender --background --factory-startup --python zone_desk.py -- [--skip-bake | --previews-only | --samples N | --regrade]

All positions glTF (X right, Y up, Z toward the viewer), metres.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import common  # noqa: E402
from common import G, bevel, bm_box, finish, lathe, loft, merge_bm, rrect_pts, tube, xform  # noqa: E402
from spec import CAMERAS, QUADS, ROOM, ZONES  # noqa: E402

TOP = 0.74  # desk top height
DESK_Z0, DESK_Z1 = -2.68, -1.92  # back and front edge of the desk top
DESK_X = 1.10  # half width

CHAIR_LIMIT = 0.90


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def place(bm, at=(0, 0, 0), yaw=0.0, tilt=0.0):
    bm.transform(xform(at, yaw, tilt))
    return bm


def rbox(name, key, size, center, bev=0.005, segs=3, yaw=0.0, tilt=0.0, texel=1.0, drop_bottom=False, angle=30.0):
    bm = bm_box(size)
    bevel(bm, min(bev, min(size) * 0.45), segs, angle=angle)
    place(bm, center, yaw, tilt)
    return finish(bm, name, key, texel=texel, drop_bottom=drop_bottom)


def rounded_slab(hx, hz, r, y0, y1, bev, n=6, cx=0.0, cz=0.0, bevel_segs=3):
    """A rounded-rectangle slab (glTF XZ footprint) from y0 to y1 with rounded top/bottom edges."""
    prof = []
    for i in range(bevel_segs + 1):  # bottom bevel
        a = math.radians(90.0 * i / bevel_segs)
        prof.append((bev - bev * math.sin(a), y0 + bev - bev * math.cos(a)))
    for i in range(bevel_segs + 1):  # top bevel
        a = math.radians(90.0 * i / bevel_segs)
        prof.append((bev - bev * math.cos(a), y1 - bev + bev * math.sin(a)))
    rings = []
    for inset, y in prof:
        rr = (max(r - inset, 0.0015),) * 4
        pts = rrect_pts(hx - inset, hz - inset, rr, n=n, cx=cx, cz=cz)
        rings.append([Vector((x, yy, y)) for x, yy in pts])
    return loft(rings)


def disc(r, h, segs=32, bev=0.002):
    """A lathe disc on Blender local Z from 0 to h with bevelled rim."""
    return lathe([(0, 0), (r - bev, 0), (r, bev), (r, h - bev), (r - bev, h), (0, h)], segs=segs)


def cable(name, pts, r=0.0035, texel=0.5, n=22):
    path = common.bezier_path(pts, n=n)
    for p in path:  # the spline swings past its points: keep it out of the back wall and the floor
        p.y = min(p.y, -ROOM["z"][0] - r - 0.0005)
        p.z = max(p.z, r + 0.0005)
    return finish(tube(path, r, sides=6), name, "device", sharp_deg=80, texel=texel)


# --------------------------------------------------------------------------- #
# Desk
# --------------------------------------------------------------------------- #

def build_desk():
    zc = (DESK_Z0 + DESK_Z1) / 2
    depth = DESK_Z1 - DESK_Z0
    th = 0.032
    rbox("desk_top", "furniture_top", (2 * DESK_X, th, depth), (0.0, TOP - th / 2, zc), bev=0.006, segs=3, texel=2.6)
    # steel frame: two side frames (column, foot, top bracket), a beam, a cable tray
    for sx in (-1, 1):
        x = sx * (DESK_X - 0.12)
        rbox("desk_col", "furniture", (0.075, TOP - th - 0.07, 0.055), (x, (TOP - th + 0.035) / 2 + 0.0, zc - 0.05), bev=0.006, texel=0.6)
        rbox("desk_foot", "furniture", (0.07, 0.035, depth - 0.06), (x, 0.0175 + 0.004, zc), bev=0.008, texel=0.6)
        for fz in (zc - (depth - 0.06) / 2 + 0.03, zc + (depth - 0.06) / 2 - 0.03):
            b = lathe([(0, 0), (0.016, 0), (0.016, 0.004), (0, 0.004)], segs=12)
            b.transform(Matrix.Translation(G(x, 0.0, fz)))
            finish(b, "desk_glide", "device", texel=0.2)
        rbox("desk_bracket", "furniture", (0.06, 0.028, depth - 0.1), (x, TOP - th - 0.014, zc), bev=0.005, texel=0.4)
    rbox("desk_beam", "furniture", (2 * DESK_X - 0.30, 0.05, 0.035), (0.0, TOP - th - 0.045, zc - 0.05), bev=0.005, texel=0.4)
    # cable tray under the back edge (a mesh-like basket: a shallow open box)
    tx0, tx1, ty, tz = -0.62, 0.62, TOP - th - 0.12, DESK_Z0 + 0.09
    bm = bmesh.new()
    for size, c in (((tx1 - tx0, 0.004, 0.11), (0, ty, tz)), ((tx1 - tx0, 0.06, 0.004), (0, ty + 0.03, tz + 0.055)),
                    ((tx1 - tx0, 0.06, 0.004), (0, ty + 0.03, tz - 0.055))):
        merge_bm(bm, bevel(bm_box(size, c), 0.0015, 1))
    finish(bm, "cable_tray", "metal", texel=0.3)
    for x in (tx0 + 0.05, tx1 - 0.05):
        rbox("tray_hanger", "metal", (0.012, 0.09, 0.012), (x, ty + 0.045, tz - 0.05), bev=0.002, texel=0.2)
    return tz, ty


# --------------------------------------------------------------------------- #
# Main monitor, light bar, second monitor
# --------------------------------------------------------------------------- #

def build_monitor():
    q = QUADS["Screen"]
    w, h = q["size"]
    cx, cy, cz = q["at"]
    side, chin = 0.007, 0.016
    bw, bh = w + 2 * side, h + side + chin
    by = cy + (side - chin) / 2
    front = cz - 0.0012
    # thin panel
    rbox("mon_panel", "device", (bw, bh, 0.016), (cx, by, front - 0.008), bev=0.003, segs=3, texel=1.0)
    # rear housing and VESA boss
    bm = rounded_slab(0.29, 0.165, 0.05, 0, 0.034, 0.012, n=6)
    # rounded_slab's height is Blender +Z; turn it to point to the back (Blender +Y)
    bm.transform(Matrix.Translation(G(cx, by - 0.02, front - 0.016)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
    finish(bm, "mon_back", "device", texel=0.4)
    neck_z = front - 0.016 - 0.05
    rbox("mon_link", "metal", (0.09, 0.09, 0.04), (cx, by - 0.03, front - 0.016 - 0.035), bev=0.01, texel=0.3)
    rbox("mon_neck", "metal", (0.06, 0.36, 0.032), (cx, TOP + 0.012 + 0.18, neck_z - 0.01), bev=0.012, texel=1.0)
    # foot plate
    bm = rounded_slab(0.13, 0.10, 0.05, TOP, TOP + 0.012, 0.004, n=6, cx=cx, cz=neck_z + 0.02)
    finish(bm, "mon_foot", "metal", texel=0.8, drop_bottom=True)
    # the light bar on top: housing around Text_hero, with a clamp over the monitor's top edge
    t = QUADS["Text_hero"]
    tw, thh = t["size"]
    tx, ty, tz = t["at"]
    lip = 0.008
    rbox("bar_body", "device", (tw + 2 * lip, thh + 2 * 0.006, 0.026), (tx, ty, tz - 0.0015 - 0.013), bev=0.004, texel=0.8)
    top_edge = by + bh / 2
    back_edge = front - 0.016 - 0.034
    rbox("bar_clamp_top", "metal", (0.12, 0.010, back_edge - (tz - 0.028) + 0.012 if False else 0.075), (tx, top_edge + 0.005, front - 0.03), bev=0.003, texel=0.3)
    rbox("bar_clamp_hook", "metal", (0.12, 0.05, 0.010), (tx, top_edge - 0.02, front - 0.068), bev=0.003, texel=0.3)
    common.make_quad("Screen")
    common.make_quad("Text_hero")
    return (cx, TOP + 0.08, neck_z - 0.01)


def quad_frame(name):
    """A quad's centre, right, up and front normal as Blender vectors, and its size."""
    q = QUADS[name]
    R = common.quad_matrix(q).to_3x3()
    return G(*q["at"]), R @ Vector((1, 0, 0)), R @ Vector((0, 0, 1)), R @ Vector((0, -1, 0)), q["size"]


def quad_corners(name):
    """The quad's four corners in glTF: bottom left, bottom right, top right, top left (seen from its front)."""
    c, right, up, _, (w, h) = quad_frame(name)
    return [common.to_gltf(c + right * (sx * w / 2) + up * (sy * h / 2)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def build_monitor2():
    """The second monitor: landscape, right of the main one, turned toward the seat.
    Same family as the main monitor: thin panel, rounded rear housing, metal neck and foot plate."""
    q = QUADS["Screen2"]
    w, h = q["size"]
    at, yaw = q["at"], q["yaw"]
    assert abs(q.get("lean", 0.0)) < 1e-9, "the stand is built for an upright panel"
    side, chin, gap, pd = 0.007, 0.016, 0.0012, 0.016  # bezel, chin, quad-to-glass gap, panel depth
    bw, bh = w + 2 * side, h + side + chin
    by = at[1] + (side - chin) / 2  # the panel's centre height
    M = common.quad_matrix(q)
    cs, sn = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))

    def P(lx, y, d):
        """lx along the screen's right, y the height, d the distance behind the quad -> glTF."""
        return (at[0] + lx * cs - d * sn, y, at[2] - lx * sn - d * cs)
    # thin panel: its front face lies `gap` behind the quad (quad-local depth is Blender +Y)
    b = bm_box((bw, bh, pd), (0, (side - chin) / 2, 0))
    bevel(b, 0.003, 3)
    b.transform(M @ Matrix.Translation((0, gap + pd / 2, 0)))
    finish(b, "mon2_panel", "device", texel=1.0)
    # rear housing: a rounded bulge on the panel's back (rounded_slab's height turned to point backward)
    bm = rounded_slab(0.235, 0.132, 0.045, 0, 0.031, 0.011, n=6)
    bm.transform(M @ Matrix.Translation((0, gap + pd - 0.001, (side - chin) / 2 - 0.018)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
    finish(bm, "mon2_back", "device", texel=0.4)
    # stand: a link block on the housing, a neck straight down, a foot plate on the desk
    link_d = gap + pd + 0.034
    neck_d = gap + pd + 0.059
    neck_top = by - 0.012
    rbox("mon2_link", "metal", (0.08, 0.08, 0.04), P(0, by - 0.03, link_d), bev=0.01, segs=2, yaw=yaw, texel=0.3)
    rbox("mon2_neck", "metal", (0.052, neck_top - (TOP + 0.008), 0.028), P(0, (neck_top + TOP + 0.008) / 2, neck_d), bev=0.011, yaw=yaw, texel=0.9)
    foot_c = P(0, 0.0, neck_d - 0.022)
    bm = rounded_slab(0.108, 0.086, 0.042, TOP, TOP + 0.012, 0.004, n=6)
    bm.transform(xform(foot_c, yaw))
    finish(bm, "mon2_foot", "metal", texel=0.8, drop_bottom=True)
    # a clip on the neck's back holds the two cables that come down from the ports
    clip_y = TOP + 0.13
    rbox("mon2_clip", "device", (0.040, 0.014, 0.012), P(0, clip_y, neck_d + 0.014 + 0.005), bev=0.003, segs=1, yaw=yaw, texel=0.2)
    common.make_quad("Screen2")
    # the cables: out of the housing's lower edge on either side of the neck, around it, through the clip,
    # down its back, over the foot plate and onto the desk
    port_y = by - 0.018 - 0.132 + 0.012
    back = neck_d + 0.0215
    runs = []
    for s in (-1, 1):
        runs.append([P(s * 0.045, port_y, gap + pd + 0.020), P(s * 0.046, port_y - 0.038, neck_d - 0.010), P(s * 0.034, clip_y + 0.042, back + 0.001),
                     P(s * 0.011, clip_y + 0.018, back), P(s * 0.011, clip_y - 0.02, back), P(s * 0.011, TOP + 0.055, back + 0.003),
                     P(s * 0.016, TOP + 0.0172, neck_d + 0.056), P(s * 0.024, TOP + 0.0045, neck_d + 0.105)])
    return runs


# --------------------------------------------------------------------------- #
# Keyboard, mouse, pad
# --------------------------------------------------------------------------- #

def keycap(w, d, h=0.0098):
    rings = []
    for (iw, idp, y, r) in ((0.0, 0.0, 0.0, 0.0012), (0.0022, 0.0030, h - 0.0012, 0.0022), (0.0030, 0.0040, h, 0.0016)):
        pts = rrect_pts(w / 2 - iw, d / 2 - idp, (r,) * 4, n=1)
        rings.append([Vector((x, yy, y)) for x, yy in pts])
    return loft(rings, cap_start=False, cap_end=True)


def build_keyboard():
    kx, kz = 0.0, -2.07
    u = 0.0190
    rows = [
        [1, 0.25, 1, 1, 1, 1, 0.25, 1, 1, 1, 1, 0.25, 1, 1, 1, 1, 0.25, 1],  # F row (0.25 = gap)
        [1] * 13 + [2, 1],
        [1.5] + [1] * 12 + [1.5, 1],
        [1.75] + [1] * 11 + [2.25, 1],
        [2.25] + [1] * 10 + [1.75, 1, 1],
        [1.25, 1.25, 1.25, 6.25, 1, 1, 1, 1, 1, 1],
    ]
    mods = {(0, 0), (1, 13), (2, 0), (2, 13), (3, 0), (3, 12), (4, 0), (4, 11), (5, 0), (5, 1), (5, 2), (5, 4), (5, 5), (5, 6)}
    W = 16 * u + 0.022
    D = 6 * u + 0.006 + 0.024
    tilt = 4.0
    M = xform((kx, TOP, kz), 0.0, 0.0)
    # case: rounded slab, slightly wedge-shaped by tilting
    bm = rounded_slab(W / 2, D / 2, 0.008, 0.0, 0.020, 0.004, n=4)
    bm.transform(M @ Matrix.Translation((0, 0, 0.002)) @ Matrix.Rotation(math.radians(-tilt), 4, "X"))
    finish(bm, "kb_case", "device", texel=1.4)
    for sx in (-1, 1):  # rubber feet so the tilted case stands on the desk
        rbox("kb_foot", "device", (0.03, 0.006, 0.012), (kx + sx * (W / 2 - 0.03), TOP + 0.003, kz - D / 2 + 0.01), bev=0.002, segs=1, texel=0.1)
    caps_a, caps_b = bmesh.new(), bmesh.new()
    y0 = 0.019
    z = -D / 2 + 0.012 + u / 2 + 0.003
    for ri, row in enumerate(rows):
        x = -W / 2 + 0.011
        ci = 0
        for k in row:
            if k == 0.25 and ri == 0:
                x += 0.25 * u
                continue
            cap = keycap(k * u - 0.0018, u - 0.0018)
            cap.transform(M @ Matrix.Rotation(math.radians(-tilt), 4, "X") @ Matrix.Translation(G(x + k * u / 2, y0, z + (0.004 if ri == 0 else 0)) - G(0, 0, 0)))
            merge_bm(caps_b if (ri, ci) in mods else caps_a, cap)
            x += k * u
            ci += 1
        z += u + (0.004 if ri == 0 else 0)
    finish(caps_a, "kb_caps", "device_key", sharp_deg=60, weighted=False, texel=1.6)
    finish(caps_b, "kb_caps_mod", "metal", sharp_deg=60, weighted=False, texel=1.6)
    # mouse pad and mouse
    mx, mz = 0.37, -2.07
    bm = rounded_slab(0.13, 0.11, 0.02, TOP, TOP + 0.003, 0.0012, n=4, cx=mx, cz=mz, bevel_segs=1)
    finish(bm, "mouse_pad", "fabric", texel=0.8, drop_bottom=True)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    bmesh.ops.edgeloop_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    for v in bm.verts:
        x, y, zz = v.co
        v.co = Vector((x * 0.031 * (1 + 0.10 * y), y * 0.058, zz * 0.036))
    bm.transform(Matrix.Translation(G(mx + 0.01, TOP + 0.003, mz + 0.005)) @ rot_z(-6))
    finish(bm, "mouse", "device", texel=0.9, drop_bottom=True)
    return (kx, TOP + 0.02, kz - D / 2), (mx, TOP + 0.03, mz - 0.06)


# --------------------------------------------------------------------------- #
# Lamp (spot light at the bulb; LampBulb / LampPool anchors follow it)
# --------------------------------------------------------------------------- #

def build_lamp():
    base_c = (-1.03, TOP, -2.47)
    Bp = G(-1.03, 0.795, -2.47)
    Ep = G(-1.05, 1.34, -2.58)
    Sp = G(-0.90, 1.31, -2.02)
    Pt = G(-0.44, TOP, -2.06)
    b = lathe([(0, 0), (0.074, 0), (0.077, 0.004), (0.077, 0.018), (0.07, 0.026), (0.03, 0.03), (0.022, 0.04), (0, 0.04)], segs=36, mat_of_seg=[0, 0, 0, 1, 0, 0, 0])
    b.transform(Matrix.Translation(G(*base_c)))
    finish(b, "lamp_base", ["device", "metal"], texel=0.8, drop_bottom=True)
    finish(tube([G(*base_c) + Vector((0, 0, 0.035)), Bp], 0.008, sides=12), "lamp_post", "metal", texel=0.4)
    for P, r in ((Bp, 0.014), (Ep, 0.013), (Sp, 0.012)):
        j = lathe([(0, -0.02), (r, -0.02), (r, 0.02), (0, 0.02)], segs=16)
        j.transform(Matrix.Translation(P) @ Matrix.Rotation(math.radians(90), 4, "Y"))
        finish(j, "lamp_joint", "device_key", texel=0.3)
    for off in (-0.01, 0.01):
        o = Vector((off, 0, 0))
        finish(tube([Bp + o, Ep + o], 0.0042, sides=8), "lamp_rod", "metal", texel=0.3)
        finish(tube([Ep + o, Sp + o], 0.0042, sides=8), "lamp_rod", "metal", texel=0.3)
    # spring on the lower arm
    sp = [Bp.lerp(Ep, 0.15 + 0.6 * i / 40) + Vector((0, 0.022, 0)) + Vector((0.006 * math.cos(i * 1.2), 0, 0.006 * math.sin(i * 1.2))) for i in range(41)]
    finish(tube(sp, 0.0016, sides=6), "lamp_spring", "metal", sharp_deg=80, texel=0.15)
    d = (Pt - Sp).normalized()
    apex = Sp + d * 0.018
    sprof = [(0.0, 0.0), (0.022, 0.0), (0.028, 0.014), (0.04, 0.05), (0.06, 0.105), (0.072, 0.14), (0.0725, 0.145), (0.0695, 0.143), (0.058, 0.11), (0.038, 0.054), (0.025, 0.02), (0.0, 0.016)]
    smat = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
    b = lathe(sprof, segs=40, mat_of_seg=smat)
    b.transform(common.align_matrix(apex, d))
    finish(b, "lamp_shade", ["device", "paper_dim"], texel=1.2)
    s = lathe([(0, 0.012), (0.013, 0.012), (0.013, 0.05), (0, 0.05)], segs=16)
    s.transform(common.align_matrix(apex, d))
    finish(s, "lamp_socket", "device", texel=0.2)
    bulb_c = apex + d * 0.072
    bb = bmesh.new()
    bmesh.ops.create_uvsphere(bb, u_segments=16, v_segments=10, radius=0.021)
    bb.transform(Matrix.Translation(bulb_c))
    # the bulb: an emitter so the lamp reads as lit from the cameras; it must not shadow its own spot
    bulb = finish(bb, "lamp_bulb", common.emissive("screen_glow", 6.0), texel=0.2)
    bulb["no_shadow"] = True
    bulb.visible_shadow = False
    opening = apex + d * 0.145
    t = (opening.z - TOP) / -d.z
    pool = opening + d * t
    common.make_anchor("LampBulb", at=common.to_gltf(bulb_c))
    common.make_anchor("LampPool", at=(common.to_gltf(pool)[0], TOP, common.to_gltf(pool)[2]))
    common.log("LampBulb %s LampPool %s" % (tuple(round(v, 4) for v in common.to_gltf(bulb_c)), tuple(round(v, 4) for v in (common.to_gltf(pool)[0], TOP, common.to_gltf(pool)[2]))))
    return G(*base_c)


# --------------------------------------------------------------------------- #
# Microphone on a boom arm, ending at MicTip
# --------------------------------------------------------------------------- #

def build_mic():
    tip = G(-0.46, 1.02, -2.0)
    dm = G(0.10, 0.85, -0.52).normalized()
    # body: grille at the tip end, body, end cap
    prof = [(0.0, 0.0), (0.018, 0.0), (0.025, 0.006), (0.0265, 0.016), (0.0265, 0.07), (0.0255, 0.074), (0.0255, 0.076), (0.0265, 0.08), (0.0265, 0.152), (0.022, 0.166), (0.0, 0.17)]
    mats = [1, 1, 1, 1, 0, 0, 0, 0, 0, 0]
    b = lathe(prof, segs=28, mat_of_seg=mats)
    b.transform(common.align_matrix(tip, dm))
    finish(b, "mic_body", ["device", "device_key"], texel=1.8)
    # shock mount ring around the body
    mid = tip + dm * 0.11
    ring = lathe([(0.032, -0.008), (0.040, -0.008), (0.040, 0.008), (0.032, 0.008)], segs=28)
    ring.transform(common.align_matrix(mid, dm))
    finish(ring, "mic_mount", "device", texel=1.0)
    A = tip + dm * 0.215
    side = dm.cross(Vector((0, 0, 1))).normalized()
    for s in (-1, 1):
        finish(tube([mid + side * s * 0.04, mid + side * s * 0.042 + dm * 0.06, A + side * s * 0.012], 0.0035, sides=8), "mic_yoke", "metal", texel=0.3)
    j = lathe([(0, -0.016), (0.012, -0.016), (0.012, 0.016), (0, 0.016)], segs=14)
    j.transform(Matrix.Translation(A) @ Matrix.Rotation(math.radians(90), 4, "Y"))
    finish(j, "mic_joint", "device_key", texel=0.3)
    clamp = (-0.70, TOP, DESK_Z0 + 0.025)
    rbox("mic_clamp", "device", (0.05, 0.05, 0.05), (clamp[0], TOP + 0.025, clamp[2]), bev=0.006, texel=0.3)
    rbox("mic_clamp_low", "device", (0.05, 0.012, 0.06), (clamp[0], TOP - 0.032 - 0.04, clamp[2]), bev=0.003, texel=0.15)
    base = G(clamp[0], TOP + 0.05, clamp[2])
    post_top = G(clamp[0], 0.86, clamp[2])
    E = G(-0.74, 1.40, -2.54)
    finish(tube([base, post_top], 0.009, sides=12), "mic_post", "metal", texel=0.3)
    for off in (-0.008, 0.008):
        o = Vector((off, 0, 0))
        finish(tube([post_top + o, E + o], 0.005, sides=8), "mic_arm", "device", texel=0.3)
        finish(tube([E + o, A + o * 0.6], 0.005, sides=8), "mic_arm", "device", texel=0.3)
    for P in (post_top, E):
        j = lathe([(0, -0.018), (0.014, -0.018), (0.014, 0.018), (0, 0.018)], segs=14)
        j.transform(Matrix.Translation(P) @ Matrix.Rotation(math.radians(90), 4, "Y"))
        finish(j, "mic_joint", "device_key", texel=0.3)
    # the mic cable runs along the arm and down behind the desk
    pts = [common.to_gltf(tip + dm * 0.17), common.to_gltf(A + Vector((0, 0, -0.01))), common.to_gltf(E.lerp(A, 0.5) + Vector((0, 0.015, -0.012))),
           common.to_gltf(E + Vector((0, 0.015, -0.014))), common.to_gltf(post_top.lerp(E, 0.5) + Vector((0, 0.015, 0))), common.to_gltf(post_top + Vector((0, 0.02, 0))),
           (clamp[0], TOP + 0.06, DESK_Z0 - 0.008), (clamp[0] + 0.02, 0.6, DESK_Z0 - 0.004)]
    cable("mic_cable", pts, r=0.0028, texel=0.2)
    common.make_anchor("MicTip")


# --------------------------------------------------------------------------- #
# Small things on the desk
# --------------------------------------------------------------------------- #

def build_voice_sign():
    q = QUADS["Text_voice"]
    w, h = q["size"]
    M = common.quad_matrix(q)
    lip, frame_d = 0.012, 0.042
    # box behind the quad (local depth axis = Blender +Y in the quad frame)
    b = bm_box((w + 2 * lip, h + 2 * lip, frame_d), (0, 0, 0))
    bevel(b, 0.004, 3)
    b.transform(M @ Matrix.Translation((0, 0.0015 + frame_d / 2, 0)))
    finish(b, "voice_box", "device", texel=1.0)
    # raised frame lip around the face
    for (sx, sz, cx, cz) in ((w + 2 * lip, lip, 0, h / 2 + lip / 2), (w + 2 * lip, lip, 0, -h / 2 - lip / 2), (lip, h, -w / 2 - lip / 2, 0), (lip, h, w / 2 + lip / 2, 0)):
        b = bm_box((sx, sz, 0.008), (0, 0, 0))
        bevel(b, 0.0025, 2)
        b.transform(M @ Matrix.Translation((cx, -0.002, cz)))
        finish(b, "voice_lip", "device_key", texel=0.4)
    # foot under the tilted box
    at = q["at"]
    rbox("voice_foot", "device", (w * 0.8, 0.018, 0.075), (at[0] - 0.012 * math.sin(math.radians(q["yaw"])), TOP + 0.009, at[2] - 0.018 * math.cos(math.radians(q["yaw"]))), bev=0.004, yaw=q["yaw"], texel=0.4, drop_bottom=True)
    common.make_quad("Text_voice")
    return (at[0] - 0.02, TOP + 0.04, at[2] - 0.05)


def build_speakers():
    out = []
    for x, z, yaw in ((-0.50, -2.53, 12.0), (0.47, -2.55, -12.0)):
        w, hgt, d = 0.118, 0.19, 0.145
        y0 = TOP + 0.022
        rbox("spk_pad", "fabric", (w + 0.01, 0.022, d + 0.01), (x, TOP + 0.011, z), bev=0.006, yaw=yaw, texel=0.3, drop_bottom=True)
        rbox("spk_body", "device", (w, hgt, d), (x, y0 + hgt / 2, z), bev=0.008, yaw=yaw, texel=1.6)
        M = xform((x, y0, z), yaw)
        front = d / 2 + 0.0005
        # woofer: a recessed cone ring and dust cap; tweeter above
        for cy, r0, r1, key in ((0.065, 0.043, 0.032, "device_key"), (0.148, 0.019, 0.012, "device_key")):
            prof = [(r0, 0.0), (r0, -0.002), (r1, -0.010), (0.0, -0.006)]
            b = lathe([(0, 0.0008)] + [(r0 + 0.004, 0.0008), (r0 + 0.004, 0.0)] + prof, segs=22)
            b.transform(M @ Matrix.Translation(G(0, cy, front) - G(0, 0, 0)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
            finish(b, "spk_driver", key, texel=1.2)
        b = lathe([(0.0, 0.0), (0.0035, 0.0), (0.0035, 0.002), (0.0, 0.002)], segs=10)
        b.transform(M @ Matrix.Translation(G(0.04, 0.018, front) - G(0, 0, 0)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
        finish(b, "spk_led", common.emissive("accent", 3.0), texel=0.1)
        out.append((x, y0 + 0.05, z - d / 2))
    return out


def build_headphones():
    """Headphones put down on the desk right of the mouse pad: the band flat on the top, the ear cups
    swivelled flat on their cushions. (A stand would reach into the view of the second monitor.)"""
    hx, hz, yaw = 0.765, -2.092, -14.0
    M = xform((hx, TOP, hz), yaw)

    def L(x, y, z):
        return M @ G(x, y, z)
    R, cup_z, yoke_r, amax = 0.084, 0.072, 0.051, 1.6

    def rise(a):  # the band rests on the desk at its middle and climbs to the yokes at its ends
        return 0.0105 + 0.019 * (a / amax) ** 2
    band = [L(R * math.sin(a), rise(a), -R * math.cos(a)) for a in np.linspace(-amax, amax, 23)]
    finish(tube(band, 0.0105, sides=8), "hp_band", "fabric", texel=0.7)
    inner = [L((R - 0.012) * math.sin(a), rise(a), -(R - 0.012) * math.cos(a)) for a in np.linspace(-amax + 0.2, amax - 0.2, 15)]
    finish(tube(inner, 0.0045, sides=6), "hp_band_steel", "metal", texel=0.3)
    ex, ez = R * math.sin(amax), -R * math.cos(amax)
    for s in (-1, 1):
        # slider from the band's end, then a fork around the cup's rear half
        finish(tube([L(s * ex, rise(amax), ez), L(s * ex, 0.031, cup_z - yoke_r)], 0.0055, sides=8), "hp_slider", "metal", texel=0.3)
        fork = [L(s * ex + yoke_r * math.cos(t), 0.031, cup_z + yoke_r * math.sin(t)) for t in np.linspace(math.pi, 2 * math.pi, 11)]
        finish(tube(fork, 0.004, sides=6), "hp_yoke", "metal", texel=0.3)
        for t in (math.pi, 2 * math.pi):  # the two pivots
            pv = lathe([(0, -0.004), (0.006, -0.004), (0.006, 0.004), (0, 0.004)], segs=8)
            pv.transform(Matrix.Translation(L(s * ex + (yoke_r - 0.002) * math.cos(t), 0.031, cup_z)) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "Y"))
            finish(pv, "hp_pivot", "device_key", texel=0.2)
        cup = lathe([(0, 0), (0.040, 0), (0.046, 0.005), (0.047, 0.020), (0.044, 0.026), (0.0, 0.028)], segs=22)
        cush = lathe([(0.026, 0.0), (0.042, 0.0), (0.047, -0.006), (0.046, -0.016), (0.040, -0.021), (0.028, -0.021), (0.024, -0.012), (0.026, 0.0)], segs=22)
        Mc = Matrix.Translation(L(s * ex, 0.021, cup_z))
        cup.transform(Mc)
        finish(cup, "hp_cup", "device", texel=0.8)
        cush.transform(Mc)
        finish(cush, "hp_cushion", "fabric", texel=0.6)


def build_mug():
    x, z = 0.425, -2.265  # in reach right of the keyboard, clear of the mouse cable and below both screens
    prof = [(0.0, 0.0), (0.034, 0.0), (0.039, 0.004), (0.041, 0.02), (0.041, 0.09), (0.0405, 0.096), (0.038, 0.097), (0.0365, 0.093), (0.0365, 0.072), (0.0, 0.072)]
    bm = lathe(prof, segs=28, mat_of_seg=[0, 0, 0, 0, 0, 0, 0, 0, 1])
    bm.transform(Matrix.Translation(G(x, TOP, z)))
    c = G(x, TOP, z)
    ang = math.radians(200)
    pts = []
    for i in range(11):
        t = math.radians(-80 + 160 * i / 10)
        rr = 0.040 + 0.024 * math.cos(t)
        hh = 0.052 + 0.03 * math.sin(t)
        pts.append(c + Vector((rr * math.cos(ang), rr * math.sin(ang), hh)))
    merge_bm(bm, tube(pts, 0.0055, sides=8))
    finish(bm, "mug", ["paper", "device"], texel=1.0, drop_bottom=True)


def build_notebook():
    x, z, rot = -0.31, -2.00, 9.0
    M = xform((x, TOP, z), rot)
    th = 0.014
    b = bm_box((0.148, th - 0.003, 0.205), (0.002, th / 2, 0))
    bevel(b, 0.0012, 1)
    b.transform(M)
    finish(b, "nb_pages", "paper_dim", texel=0.7, drop_bottom=True)
    for yy in (0.0012, th - 0.0012):
        b = bm_box((0.152, 0.0024, 0.21), (0, yy, 0))
        bevel(b, 0.0010, 1)
        b.transform(M)
        finish(b, "nb_cover", "book_c", texel=0.8)
    b = bm_box((0.006, th, 0.21), (-0.076, th / 2, 0))
    bevel(b, 0.002, 2)
    b.transform(M)
    finish(b, "nb_spine", "book_c", texel=0.4)
    # elastic band and a pen on top
    b = bm_box((0.006, 0.0012, 0.212), (0.06, th + 0.0006, 0))
    b.transform(M)
    finish(b, "nb_band", "device", smooth=False, texel=0.3)
    p0 = M @ (G(-0.04, th + 0.0045, 0.07) - G(0, 0, 0))
    p1 = M @ (G(0.03, th + 0.0045, -0.075) - G(0, 0, 0))
    finish(tube([p0, p0.lerp(p1, 0.8), p1], 0.0042, sides=10), "pen", "metal", texel=0.3)
    finish(tube([p0.lerp(p1, 0.8), p1 + (p1 - p0).normalized() * 0.004], 0.0045, sides=10), "pen_cap", "device", texel=0.2)
    # a loose sheet under it
    b = bm_box((0.21, 0.0008, 0.15), (0, 0.0004, 0))
    b.transform(xform((x + 0.05, TOP, z + 0.02), -6))
    finish(b, "sheet", "paper", smooth=False, texel=0.5, drop_bottom=True)


def build_sticky_notes():
    notes = [((-0.52, 1.30, -2.6985), -4, "paper"), ((-0.465, 1.235, -2.6985), 5, "paper_dim"), ((0.47, 1.31, -2.6985), 3, "paper")]
    for (x, y, z), roll, key in notes:
        b = bm_box((0.072, 0.072, 0.0012), (0, 0, 0))
        # a slight curl at the bottom edge
        for v in b.verts:
            if v.co.z < 0:
                v.co.y -= 0.004
        b.transform(xform((x, y, z), 0, 0, roll))
        finish(b, "sticky", key, smooth=False, texel=0.5)
    b = bm_box((0.072, 0.0012, 0.072), (0, 0.0006, 0))
    b.transform(xform((0.21, TOP, -1.985), 12))
    finish(b, "sticky_desk", "paper", smooth=False, texel=0.5, drop_bottom=True)


def build_plant():
    """A small succulent at the desk's front right corner. It is kept lower than the second monitor's
    lower edge, so it can never stand in front of that screen."""
    px, pz = 1.02, -2.025
    prof = [(0.0, 0.0), (0.036, 0.0), (0.039, 0.003), (0.045, 0.092), (0.0465, 0.098), (0.043, 0.0995), (0.0405, 0.088), (0.0, 0.088)]
    bm = lathe(prof, segs=28, mat_of_seg=[0, 0, 0, 0, 0, 0, 1])
    bm.transform(Matrix.Translation(G(px, TOP, pz)))
    finish(bm, "plant_pot", ["pot", "device"], texel=0.8, drop_bottom=True)
    rng = np.random.default_rng(11)
    leaves = bmesh.new()
    n_leaves = 12
    for i in range(n_leaves):
        a = 2 * math.pi * i / n_leaves + rng.uniform(-0.25, 0.25)
        inner = i % 2 == 0  # an inner ring of upright leaves, an outer ring that leans out
        h = rng.uniform(0.070, 0.092) if inner else rng.uniform(0.045, 0.065)
        lean = rng.uniform(0.012, 0.03) if inner else rng.uniform(0.04, 0.058)
        wid = rng.uniform(0.022, 0.03)
        rad = 0.006 + 0.008 * rng.uniform() if inner else 0.016 + 0.008 * rng.uniform()
        segs = 6
        base = Vector((px + rad * math.cos(a), TOP + 0.084, pz + rad * math.sin(a)))
        outdir = Vector((math.cos(a), 0, math.sin(a)))
        side = Vector((-math.sin(a + 0.6), 0, math.cos(a + 0.6)))
        rows = []
        for s in range(segs + 1):
            t = s / segs
            ctr = base + Vector((0, h * t, 0)) + outdir * (lean * t * t)
            w = max(wid * (1 - t ** 1.7) * (0.75 + 0.5 * math.sin(math.pi * min(t * 1.5, 1))), 0.001)
            rows.append([G(*(ctr - side * w / 2)), G(*(ctr + outdir * 0.003)), G(*(ctr + side * w / 2))])
        vs = [[leaves.verts.new(p) for p in row] for row in rows]
        vb = [[leaves.verts.new(p - G(*(outdir * 0.003)) + G(0, 0, 0)) for p in row] for row in rows]
        for s in range(segs):
            for k in range(2):
                leaves.faces.new((vs[s][k], vs[s][k + 1], vs[s + 1][k + 1], vs[s + 1][k]))
                leaves.faces.new((vb[s][k], vb[s + 1][k], vb[s + 1][k + 1], vb[s][k + 1]))
            leaves.faces.new((vs[s][0], vs[s + 1][0], vb[s + 1][0], vb[s][0]))
            leaves.faces.new((vs[s][2], vb[s][2], vb[s + 1][2], vs[s + 1][2]))
    bmesh.ops.remove_doubles(leaves, verts=leaves.verts, dist=1e-5)
    finish(leaves, "plant_leaves", "plant", sharp_deg=70, weighted=False, texel=0.7)


# --------------------------------------------------------------------------- #
# PC tower (on the floor right of the desk, glass side toward the room)
# --------------------------------------------------------------------------- #

def build_tower():
    cx, cz, yaw = 1.215, -2.42, 90.0
    W, H, D = 0.215, 0.46, 0.44  # local: width (glTF -z after yaw), height, depth (glTF x)
    M = xform((cx, 0.0, cz), yaw)
    feet = 0.018
    t = 0.008

    def part(name, key, size, c, bev=0.004, texel=0.6):
        b = bm_box(size, c)
        bevel(b, min(bev, min(size) * 0.45), 2)
        b.transform(M)
        return finish(b, name, key, texel=texel)
    y0 = feet
    part("pc_top", "device", (W, t, D), (0, y0 + H - t / 2, 0), bev=0.004)
    part("pc_bottom", "device", (W, t, D), (0, y0 + t / 2, 0))
    part("pc_side_solid", "device", (t, H - 2 * t, D), (W / 2 - t / 2, y0 + H / 2, 0))
    part("pc_front", "device", (W, H, 0.02), (0, y0 + H / 2, D / 2 - 0.01), bev=0.006, texel=0.7)
    part("pc_back", "device", (W, H - 2 * t, t), (0, y0 + H / 2, -D / 2 + t / 2))
    # glass side: only a thin frame (the pane itself is left open: a lightmap cannot show through glass)
    gx = -W / 2 + t / 2
    part("pc_glass_frame", "device_key", (t, t * 1.5, D - 0.02), (gx, y0 + H - t * 2, 0), bev=0.002, texel=0.3)
    part("pc_glass_frame", "device_key", (t, t * 1.5, D - 0.02), (gx, y0 + t * 2, 0), bev=0.002, texel=0.3)
    part("pc_glass_frame", "device_key", (t, H - 4 * t, t * 1.5), (gx, y0 + H / 2, -D / 2 + 0.012), bev=0.002, texel=0.3)
    # inside: motherboard tray, board, GPU, cooler, RAM, PSU shroud, fans
    part("pc_tray", "furniture", (0.006, H - 0.05, D - 0.06), (W / 2 - t - 0.012, y0 + H / 2 + 0.01, -0.01), bev=0.002, texel=0.4)
    part("pc_board", "device_key", (0.004, 0.24, 0.24), (W / 2 - t - 0.017, y0 + H - 0.16, -0.06), bev=0.002, texel=0.4)
    part("pc_shroud", "device", (W - 2 * t, 0.10, D - 0.04), (0, y0 + t + 0.05, 0), bev=0.004, texel=0.4)
    part("pc_gpu", "device_key", (0.05, 0.11, 0.30), (W / 2 - t - 0.06, y0 + 0.20, 0.03), bev=0.006, texel=0.5)
    part("pc_gpu_plate", "metal", (0.004, 0.10, 0.28), (W / 2 - t - 0.086, y0 + 0.20, 0.03), bev=0.0015, texel=0.4)
    part("pc_cooler", "metal", (0.10, 0.12, 0.05), (W / 2 - t - 0.075, y0 + H - 0.13, -0.05), bev=0.004, texel=0.4)
    for i in range(4):
        part("pc_ram", "device", (0.01, 0.045, 0.006), (W / 2 - t - 0.025, y0 + H - 0.12, 0.03 + i * 0.009), bev=0.001, texel=0.2)
    # three intake fans behind the front panel with a faint blue ring each
    for i in range(3):
        fy = y0 + 0.13 + i * 0.13
        ring = lathe([(0.050, -0.006), (0.058, -0.006), (0.058, 0.006), (0.050, 0.006)], segs=28)
        ring.transform(M @ Matrix.Translation(G(0, fy, D / 2 - 0.035) - G(0, 0, 0)) @ Matrix.Rotation(math.radians(90), 4, "X"))
        finish(ring, "pc_fan_ring", common.emissive("accent", 1.6), texel=0.3)
        hub = lathe([(0, -0.008), (0.018, -0.008), (0.018, 0.008), (0, 0.008)], segs=16)
        hub.transform(M @ Matrix.Translation(G(0, fy, D / 2 - 0.035) - G(0, 0, 0)) @ Matrix.Rotation(math.radians(90), 4, "X"))
        finish(hub, "pc_fan_hub", "device", texel=0.2)
        bl = bmesh.new()
        for k in range(7):
            b = bm_box((0.032, 0.002, 0.012), (0.034, 0, 0))
            b.transform(Matrix.Rotation(2 * math.pi * k / 7, 4, "Y") @ Matrix.Rotation(math.radians(25), 4, "X"))
            merge_bm(bl, b)
        bl.transform(M @ Matrix.Translation(G(0, fy, D / 2 - 0.035) - G(0, 0, 0)))
        finish(bl, "pc_fan_blades", "device_key", smooth=False, texel=0.2)
    # a thin LED strip along the inside top edge
    part("pc_led", common.emissive("accent", 2.0), (0.006, 0.004, D - 0.08), (W / 2 - t - 0.004, y0 + H - t - 0.004, 0), bev=0.001, texel=0.15)
    # power button and status light on the front top
    b = lathe([(0, 0), (0.007, 0), (0.007, 0.003), (0, 0.003)], segs=12)
    b.transform(M @ Matrix.Translation(G(0, y0 + H - 0.03, D / 2) - G(0, 0, 0)) @ Matrix.Rotation(math.radians(-90), 4, "X"))
    finish(b, "pc_button", common.emissive("accent", 3.0), texel=0.1)
    for fx in (-1, 1):
        for fz in (-1, 1):
            part("pc_foot", "device", (0.03, feet, 0.05), (fx * (W / 2 - 0.025), feet / 2, fz * (D / 2 - 0.04)), bev=0.003, texel=0.1)
    return M


# --------------------------------------------------------------------------- #
# The wall above: LED channel, wordmark, picture light
# --------------------------------------------------------------------------- #

def build_led_channel():
    y = 0.945
    rbox("led_channel", "metal", (2.12, 0.012, 0.034), (0.0, y - 0.006, -2.683), bev=0.003, segs=2, texel=0.4)
    rbox("led_diffuser", common.emissive("accent", 4.0), (2.10, 0.002, 0.018), (0.0, y + 0.0, -2.683), bev=0.0008, segs=1, texel=0.3)


def build_wordmark():
    a = common.ANCHORS["Wordmark"]["at"]
    ob = common.text_mesh("wordmark", "DODAIOS", font=common.FONT_HEAVY, size=1.0, depth=0.0, bevel_depth=0.0, key="gold")
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    width = max(xs) - min(xs)
    f = 1.70 / width
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    depth, bev = 0.050, 0.007
    ob = common.text_mesh("wordmark", "DODAIOS", font=common.FONT_HEAVY, size=f, depth=depth - 2 * bev, bevel_depth=bev, bevel_res=2, key="gold", resolution=4)
    me = ob.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    cx, cy, cz = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(zs) + min(zs)) / 2
    me.transform(Matrix.Translation((-cx, -cy, -cz)))
    front_z = -2.70 + 0.006 + depth  # 6 mm stand-off from the wall
    me.transform(Matrix.Translation(G(a[0], a[1], front_z - depth / 2)) @ Matrix.Rotation(math.radians(90), 4, "X"))
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    back_y = max(v.co.y for v in bm.verts)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.y > 0.99 and abs(f.calc_center_median().y - back_y) < 1e-4], context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(70))
    mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    mod.mode = "FACE_AREA"
    mod.weight = 100
    mod.keep_sharp = True
    common.apply_mods(ob)
    me = ob.data
    ob["texel"] = 2.2
    common.log("wordmark: %.3f x %.3f m, %d faces, front at z %.3f" % (max(xs) - min(xs), max(ys) - min(ys), len(me.polygons), front_z))
    hgt = max(ys) - min(ys)
    return hgt


def build_picture_light():
    lamp = (0.0, 2.75, -2.30)
    aim = (0.0, 2.22, -2.68)
    d = (G(*aim) - G(*lamp)).normalized()
    # wall plate and arm
    rbox("pl_plate", "metal", (0.09, 0.05, 0.012), (0.0, 2.58, -2.694), bev=0.003, texel=0.3)
    arm = common.bezier_path([(0.0, 2.58, -2.69), (0.0, 2.64, -2.55), (0.0, 2.74, -2.40), (0.0, 2.762, -2.33)], n=16)
    finish(tube(arm, 0.007, sides=10), "pl_arm", "metal", texel=0.3)
    # shade: a horizontal half tube opening toward the wall-and-down (the spot is at its centre)
    L, r = 0.46, 0.034
    open_dir = Vector((d.x, d.y, d.z))
    up = -open_dir
    ang0 = math.atan2(up.z, up.y)  # angle of the closed side in the Blender YZ plane
    rings = []
    n = 18
    span = math.radians(230)
    for x in (-L / 2, L / 2):
        ring = []
        for i in range(n + 1):
            t = ang0 - span / 2 + span * i / n
            ring.append(G(*lamp) + Vector((x, r * math.cos(t), r * math.sin(t))))
        rings.append(ring)
    bm = bmesh.new()
    va = [bm.verts.new(p) for p in rings[0]]
    vb = [bm.verts.new(p) for p in rings[1]]
    for i in range(n):
        bm.faces.new((va[i], va[i + 1], vb[i + 1], vb[i]))
    res = bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.003)
    del res
    finish(bm, "pl_shade", "metal", sharp_deg=60, texel=0.5)
    for x in (-L / 2, L / 2):
        b = lathe([(0, -0.003), (r + 0.002, -0.003), (r + 0.002, 0.003), (0, 0.003)], segs=20)
        b.transform(Matrix.Translation(G(*lamp) + Vector((x, 0, 0))) @ Matrix.Rotation(math.radians(90), 4, "Y"))
        finish(b, "pl_cap", "metal", texel=0.2)
    # the lit tube inside, facing the wall
    b = tube([G(*lamp) + Vector((-L / 2 + 0.01, 0, 0)) + open_dir * 0.004, G(*lamp) + Vector((L / 2 - 0.01, 0, 0)) + open_dir * 0.004], 0.006, sides=8)
    ob = finish(b, "pl_tube", common.emissive("screen_glow", 3.0), texel=0.1)
    ob.visible_shadow = False


# --------------------------------------------------------------------------- #
# Chair and rug
# --------------------------------------------------------------------------- #

def build_chair():
    parts = []
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        ca, sa = math.cos(a), math.sin(a)

        def P(r, y, side, half, ca=ca, sa=sa):
            return G(ca * r - sa * side * half, y, sa * r + ca * side * half)
        rings = []
        for r, y, hw, hh in ((0.03, 0.095, 0.024, 0.022), (0.27, 0.06, 0.016, 0.014)):
            rings.append([P(r, y - hh, -1, hw), P(r, y - hh, 1, hw), P(r, y + hh, 1, hw), P(r, y + hh, -1, hw)])
        b = loft(rings)
        bevel(b, 0.005, 2, angle=40)
        parts.append((b, "metal", 0.4))
        cpos = G(ca * 0.28, 0.0, sa * 0.28)
        hous = bm_box((0.03, 0.03, 0.03), (ca * 0.28, 0.052, sa * 0.28))
        bevel(hous, 0.006, 2)
        parts.append((hous, "device", 0.2))
        wheel = lathe([(0, -0.012), (0.019, -0.012), (0.024, -0.008), (0.024, 0.008), (0.019, 0.012), (0, 0.012)], segs=10)
        wheel.transform(Matrix.Translation(cpos + Vector((0, 0, 0.024))) @ Matrix.Rotation(-a, 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "Y"))
        parts.append((wheel, "device", 0.2))
    parts.append((lathe([(0, 0.07), (0.05, 0.07), (0.052, 0.09), (0.04, 0.12), (0, 0.12)], segs=20), "metal", 0.3))
    parts.append((lathe([(0, 0.12), (0.033, 0.12), (0.033, 0.26), (0.024, 0.27), (0.024, 0.37), (0, 0.37)], segs=20), "device", 0.3))
    mech = bm_box((0.2, 0.035, 0.22), (0, 0.385, 0.0))
    bevel(mech, 0.008, 2)
    parts.append((mech, "device", 0.2))
    shell = bm_box((0.47, 0.02, 0.45), (0, 0.41, 0.0))
    bevel(shell, 0.009, 3)
    parts.append((shell, "furniture", 0.3))
    seat = bm_box((0.48, 0.07, 0.46), (0, 0.453, 0.0))
    bevel(seat, 0.03, 4, angle=30)
    for v in seat.verts:
        x, yb, z = v.co
        if z > 0.44:
            v.co.z += 0.008 * (1 - (x / 0.24) ** 2) * (1 - (yb / 0.23) ** 2)
    parts.append((seat, "fabric", 1.2))
    bar = tube([G(0, 0.395, 0.17), G(0, 0.40, 0.255), G(0, 0.47, 0.285), G(0, 0.62, 0.29)], 0.012, sides=8)
    for v in bar.verts:
        v.co.x *= 2.6
    parts.append((bar, "metal", 0.3))
    back = bm_box((0.42, 0.17, 0.055), (0, 0, 0))
    bevel(back, 0.024, 4, angle=30)
    for v in back.verts:
        v.co.y -= 0.35 * v.co.x ** 2
    back.transform(Matrix.Translation(G(0, 0.72, 0.30)) @ Matrix.Rotation(math.radians(-9), 4, "X"))
    parts.append((back, "fabric", 1.0))
    M = Matrix.Translation(G(0.36, 0.012, -1.28)) @ rot_z(28)
    top = 0.0
    for b, key, w in parts:
        b.transform(M)
        ob = finish(b, "chair_" + key, key, texel=w)
        top = max(top, max((ob.matrix_world @ v.co).z for v in ob.data.vertices))
    common.log("chair highest point y = %.3f (limit %.2f)" % (top, CHAIR_LIMIT))
    assert top <= CHAIR_LIMIT


def build_rug():
    hx, hz, cx, cz = 1.12, 0.74, 0.08, -1.62
    bm = rounded_slab(hx, hz, 0.05, 0.0, 0.011, 0.004, n=4, cx=cx, cz=cz, bevel_segs=2)
    finish(bm, "rug", "rug", sharp_deg=60, texel=0.8, drop_bottom=True)
    # a woven border band, 6 cm in from the edge (slightly lower: reads as a groove)
    rings = []
    for inset in (0.06, 0.075):
        pts = rrect_pts(hx - inset, hz - inset, (0.03,) * 4, n=4, cx=cx, cz=cz)
        rings.append([Vector((x, y, 0.0113)) for x, y in pts])
    bm = bmesh.new()
    va = [bm.verts.new(p) for p in rings[0]]
    vb = [bm.verts.new(p) for p in rings[1]]
    nn = len(va)
    for i in range(nn):
        j = (i + 1) % nn
        bm.faces.new((va[i], va[j], vb[j], vb[i]))
    finish(bm, "rug_band", "fabric", smooth=False, texel=0.5)


# --------------------------------------------------------------------------- #
# Cables
# --------------------------------------------------------------------------- #

def build_cables(tray_z, tray_y, mon_back, mon2_runs, kb_back, mouse_back, spk_backs, voice_back, lamp_base):
    gap_z = DESK_Z0 - 0.009  # between the desk's back edge and the wall
    drop = tray_y + 0.01
    cable("cab_mon_power", [mon_back, (mon_back[0] + 0.01, TOP + 0.006, mon_back[2] - 0.08), (0.02, TOP + 0.006, DESK_Z0 + 0.02), (0.03, TOP - 0.01, gap_z), (0.04, TOP - 0.06, gap_z), (0.06, drop, tray_z)], r=0.0035)
    cable("cab_mon_dp", [(mon_back[0] - 0.012, mon_back[1], mon_back[2]), (mon_back[0] - 0.02, TOP + 0.006, mon_back[2] - 0.07), (-0.03, TOP + 0.006, DESK_Z0 + 0.025), (-0.035, TOP - 0.01, gap_z), (-0.04, drop, tray_z)], r=0.003)
    # the second monitor's two cables: `mon2_runs` brings each from its port down the neck onto the desk
    # (they cross the desk's back edge right of the speaker and reach the tray left of its hanger, over its back wall)
    for run, r, x_edge, x_tray in zip(mon2_runs, (0.0030, 0.0034), (0.59, 0.63), (0.45, 0.50)):
        end = run[-1]
        cable("cab_mon2", run + [((end[0] + x_edge) / 2 + 0.02, TOP + 0.004, (end[2] + DESK_Z0) / 2 - 0.02), (x_edge, TOP + 0.005, DESK_Z0 + 0.022),
                                 (x_edge - 0.01, TOP - 0.012, gap_z), (x_edge - 0.07, tray_y + 0.085, gap_z + 0.004),
                                 ((x_edge - 0.07 + x_tray) / 2, tray_y + 0.074, tray_z - 0.058), (x_tray, drop, tray_z)], r=r, n=48)
    cable("cab_kb", [kb_back, (kb_back[0] + 0.03, TOP + 0.003, kb_back[2] - 0.08), (0.09, TOP + 0.003, -2.30), (0.07, TOP + 0.003, -2.42), (0.12, TOP + 0.004, DESK_Z0 + 0.03), (0.13, TOP - 0.01, gap_z), (0.15, drop, tray_z)], r=0.0025)
    cable("cab_mouse", [mouse_back, (mouse_back[0] - 0.02, TOP + 0.004, mouse_back[2] - 0.08), (0.30, TOP + 0.003, -2.42), (0.26, TOP + 0.004, DESK_Z0 + 0.02), (0.25, TOP - 0.01, gap_z), (0.24, drop, tray_z)], r=0.0022)
    for i, sb in enumerate(spk_backs):
        cable("cab_spk%d" % i, [sb, (sb[0], TOP + 0.03, sb[2] - 0.03), (sb[0] * 0.92, TOP + 0.006, DESK_Z0 + 0.02), (sb[0] * 0.9, TOP - 0.01, gap_z), (sb[0] * 0.8, drop, tray_z)], r=0.0025)
    cable("cab_voice", [voice_back, (voice_back[0] + 0.03, TOP + 0.004, voice_back[2] - 0.1), (-0.86, TOP + 0.004, -2.42), (-0.80, TOP + 0.004, DESK_Z0 + 0.02), (-0.78, TOP - 0.01, gap_z), (-0.62, drop, tray_z)], r=0.0022)
    lb = common.to_gltf(lamp_base)
    cable("cab_lamp", [(lb[0] + 0.02, TOP + 0.01, lb[2] - 0.06), (lb[0] + 0.04, TOP + 0.004, DESK_Z0 + 0.02), (lb[0] + 0.05, TOP - 0.01, gap_z), (lb[0] + 0.07, 0.40, gap_z + 0.004), (lb[0] + 0.12, 0.012, DESK_Z0 + 0.03), (lb[0] + 0.30, 0.004, DESK_Z0 + 0.03)], r=0.0028)
    # the bundle from the tray to the tower and the tower's power cable to the wall
    cable("cab_bundle", [(0.55, tray_y + 0.02, tray_z), (0.70, tray_y, tray_z - 0.01), (0.92, 0.45, -2.60), (1.02, 0.30, -2.62), (1.08, 0.18, -2.60)], r=0.0075, texel=0.3)
    cable("cab_pc_power", [(1.03, 0.12, -2.60), (1.0, 0.04, -2.66), (0.90, 0.006, -2.68), (0.70, 0.006, -2.688)], r=0.004, texel=0.2)
    # wall socket the cables end at
    rbox("wall_socket", "paper_dim", (0.14, 0.08, 0.012), (0.68, 0.30, -2.694), bev=0.003, texel=0.3)
    rbox("power_strip", "device", (0.32, 0.04, 0.055), (0.22, 0.03, -2.64), bev=0.006, texel=0.3, drop_bottom=True)
    cable("cab_strip", [(0.38, 0.02, -2.64), (0.55, 0.008, -2.67), (0.66, 0.10, -2.69), (0.68, 0.27, -2.692)], r=0.004, texel=0.2)


# --------------------------------------------------------------------------- #

# Where the site looks at each screen from. Nothing may stand between a screen and these points.
# Screen: the spec's point, with 6 cm to spare around the pyramid. Screen2: the two cameras that
# show it and a point above the seat.
SCREEN_VIEWS = {
    "Screen": ([(0.0, 1.16, -0.2)], 0.06),
    "Screen2": ([CAMERAS["desk_medium"][0], CAMERAS["desk_wide"][0], (0.3, 1.2, -1.2)], 0.02),
}
SCREEN_OWN = {"Screen": ("mon_", "bar_"), "Screen2": ("mon2_",)}  # each screen's own housing


def _is(o, prefixes):
    return o.name.startswith(tuple(prefixes))


def _tree(objs):
    verts, polys = [], []
    for o in objs:
        n0 = len(verts)
        verts.extend(o.matrix_world @ v.co for v in o.data.vertices)
        polys.extend(tuple(n0 + i for i in p.vertices) for p in o.data.polygons)
    return verts, BVHTree.FromPolygons(verts, polys)


def clearance(a, b):
    """The smallest distance between two groups of objects (0 when their surfaces cross)."""
    (va, ta), (vb, tb) = _tree(a), _tree(b)
    if ta.overlap(tb):
        return 0.0
    return min(min(tb.find_nearest(v)[3] for v in va), min(ta.find_nearest(v)[3] for v in vb))


def view_blockers(quad, eye, margin, objs):
    """Objects with a vertex inside the pyramid from `eye` (glTF) to the quad, widened by `margin`."""
    c, right, up, normal, (w, h) = quad_frame(quad)
    e = G(*eye)
    axis = c - e
    depth = axis.dot(normal)
    hits = {}
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            s = (p - e).dot(normal) / depth  # 0 at the eye, 1 on the quad's plane
            if not 0.02 < s < 0.999:
                continue
            off = p - e - axis * s
            if abs(off.dot(right)) < s * w / 2 + margin and abs(off.dot(up)) < s * h / 2 + margin:
                k = o.name.split(".")[0]
                hits[k] = hits.get(k, 0) + 1
    return hits


def check_layout(objs):
    """Log, and fail on, what the desk must keep: the second monitor's clearances, its foot on the
    desk top, both screens free from where they are looked at, the zone's box and its triangle budget."""
    meshes = [o for o in objs if o.type == "MESH" and not o.get("quad") and o.data.polygons]
    mon2 = [o for o in meshes if _is(o, ["mon2_"])]
    corners = quad_corners("Screen2")
    common.log("Screen2 corners (bl, br, tr, tl): " + ", ".join("(%.3f, %.3f, %.3f)" % c for c in corners))
    # the housing's glass face lies 1 to 2 mm behind the quad, and nothing of the monitor is in front of it
    c, right, up, normal, (w, h) = quad_frame("Screen2")
    panel = next(o for o in mon2 if o.name.startswith("mon2_panel"))
    behind = min(-(v.co - c).dot(normal) for v in panel.data.vertices)
    common.log("mon2: glass %.2f mm behind the quad" % (behind * 1000))
    assert 0.001 <= behind <= 0.002, "the second monitor's glass must lie 1 to 2 mm behind its quad"
    # the foot stands on the desk top, inside its edges
    foot = next(o for o in mon2 if o.name.startswith("mon2_foot"))
    fp = [common.to_gltf(v.co) for v in foot.data.vertices]
    fx0, fx1, fz0, fz1 = min(p[0] for p in fp), max(p[0] for p in fp), min(p[2] for p in fp), max(p[2] for p in fp)
    edge = min(DESK_X - fx1, fx0 + DESK_X, fz0 - DESK_Z0, DESK_Z1 - fz1)
    common.log("mon2 foot: x %.3f..%.3f, z %.3f..%.3f, stands at y %.3f; %.0f mm inside the desk's nearest edge" % (fx0, fx1, fz0, fz1, min(p[1] for p in fp), edge * 1000))
    assert abs(min(p[1] for p in fp) - TOP) < 1e-5 and edge > 0.02, "the second monitor's foot must stand on the desk top"
    # clearances
    wall = min(common.to_gltf(o.matrix_world @ v.co)[2] for o in mon2 for v in o.data.vertices) - ROOM["z"][0]
    gaps = {"wall": wall}
    for label, prefixes in (("main monitor", ["mon_"]), ("light bar", ["bar_"]), ("speakers", ["spk_"])):
        gaps[label] = clearance(mon2, [o for o in meshes if _is(o, prefixes)])
    others = [o for o in meshes if not _is(o, ["mon2_", "cab_mon2", "desk_top"])]
    nearest = min(((clearance(mon2, [o]), o.name) for o in others if (o.matrix_world @ o.data.vertices[0].co - c).length < 1.5), default=(9.0, "-"))
    common.log("mon2 clearances: " + ", ".join("%s %.0f mm" % (k, v * 1000) for k, v in gaps.items()) + "; nearest other object %s at %.0f mm" % (nearest[1], nearest[0] * 1000))
    assert min(gaps.values()) >= 0.03 and nearest[0] >= 0.015, "the second monitor touches or crowds something"
    # both screens free from where they are looked at
    for quad, (eyes, margin) in SCREEN_VIEWS.items():
        proxy = bpy.data.objects.get("MascotProxy")
        cand = [o for o in meshes if not _is(o, SCREEN_OWN[quad])] + ([proxy] if proxy else [])
        for eye in eyes:
            hits = view_blockers(quad, eye, margin, cand)
            common.log("%s from (%.2f, %.2f, %.2f), %.0f mm to spare: %s" % (quad, *eye, margin * 1000, "free" if not hits else "BLOCKED by " + ", ".join("%s (%d)" % kv for kv in hits.items())))
            assert not hits, "%s is not free from %s: %s" % (quad, eye, sorted(hits))
    # the zone's box and budget
    x0, x1, z0, z1, y1 = ZONES["desk"]["box"]
    box_lo, box_hi = np.array((x0, 0.0, z0)) - 1e-4, np.array((x1, y1, z1)) + 1e-4
    lo, hi, out = np.full(3, np.inf), np.full(3, -np.inf), set()
    for o in meshes:
        pts = np.array([common.to_gltf(o.matrix_world @ v.co) for v in o.data.vertices])
        lo, hi = np.minimum(lo, pts.min(axis=0)), np.maximum(hi, pts.max(axis=0))
        if (pts.min(axis=0) < box_lo).any() or (pts.max(axis=0) > box_hi).any():
            out.add(o.name.split(".")[0])
    inside = not out
    common.log("zone extent x %.3f..%.3f, y %.3f..%.3f, z %.3f..%.3f; box x %.2f..%.2f, y 0..%.1f, z %.2f..%.2f: %s" % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], x0, x1, y1, z0, z1, "inside" if inside else "OUTSIDE: " + ", ".join(sorted(out))))
    tris = 0
    for o in meshes:
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
    budget = ZONES["desk"]["triangles"]
    common.log("zone triangles %d of %d" % (tris, budget))
    assert inside and tris <= budget, "the desk zone left its box or its triangle budget"


def build():
    before = set(bpy.data.objects)
    tray_z, tray_y = build_desk()
    mon_back = build_monitor()
    mon2_runs = build_monitor2()
    kb_back, mouse_back = build_keyboard()
    lamp_base = build_lamp()
    build_mic()
    voice_back = build_voice_sign()
    spk_backs = build_speakers()
    build_headphones()
    build_mug()
    build_notebook()
    build_sticky_notes()
    build_plant()
    build_tower()
    build_led_channel()
    build_wordmark()
    build_picture_light()
    build_chair()
    build_rug()
    build_cables(tray_z, tray_y, mon_back, mon2_runs, kb_back, mouse_back, spk_backs, voice_back, lamp_base)
    common.make_anchor("MascotAnchor")
    common.make_anchor("Wordmark")
    check_layout([o for o in bpy.data.objects if o not in before])


if __name__ == "__main__":
    common.run_zone("desk", build, cameras=["hero", "desk_medium", "mascot", "desk_wide"])
