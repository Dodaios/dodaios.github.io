"""Build the Dodaios mascot (a small sitting hooded figure) from scratch in headless Blender.

Run:
    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup
        --python C:/demo/web-3d/art/mascot/build.py [-- --no-previews]

Pipeline:
    analytic signed distance field (numpy) -> surface nets -> projection onto the exact surface
    -> decimation -> UV unwrap -> GPU bake (albedo x ambient occlusion) -> GLB export
    -> previews rendered from the exported GLB in a fresh empty scene.

Blender is Z-up and the figure faces -Y; the glTF exporter converts to Y-up (+Z facing).
"""

import json
import math
import os
import struct
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
TMP = os.path.join(HERE, "tmp")
GLB = os.path.join(OUT, "mascot.glb")

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
T0 = time.time()


def log(*items):
    print(f"[mascot {time.time() - T0:6.1f}s]", *items, flush=True)


# ---------------------------------------------------------------------------------------------
# Shape parameters (metres, Blender coordinates)
# ---------------------------------------------------------------------------------------------

HEAD_C = (0.0, 0.004, 0.202)
HEAD_R = (0.128, 0.118, 0.108)
DRAPE_C = (0.0, 0.012, 0.140)
DRAPE_R = (0.114, 0.106, 0.040)

# Pear-shaped cloak body: a wide lower ellipsoid and a narrower upper one, plus a ground hem.
BODY_C = (0.0, 0.016, 0.060)
BODY_R = (0.103, 0.097, 0.064)
UPPER_C = (0.0, 0.012, 0.108)
UPPER_R = (0.084, 0.080, 0.050)
HEM_C = (0.0, 0.020, 0.024)
HEM_R = (0.106, 0.101, 0.030)

# Scarf collar around the neck, slightly lower in front.
COLLAR_C = (0.0, 0.010, 0.113)
COLLAR_A, COLLAR_B = 0.086, 0.082
COLLAR_R = 0.015
COLLAR_TILT = math.radians(8.0)

FOOT_C = (0.051, -0.068, 0.035)
FOOT_R = (0.038, 0.055, 0.036)
FOOT_YAW = math.radians(17.0)
FOOT_PITCH = math.radians(-22.0)

# Hood opening frame: centre, half axes of the rim centre line, tilt (positive = top forward).
OPEN_C = (0.0, -0.104, 0.192)
OPEN_A = 0.084
OPEN_B = 0.064
OPEN_TILT = math.radians(-4.0)
RIM_R = 0.0105
PUCK_PAD = 0.016
PUCK_FRONT = -0.004
PUCK_BACK = -0.085
CUT_DEPTH = 0.050

# Hood tip spine: x, y, z, radius. Rises from the crown, bends back and to the figure's left.
TIP_POINTS = [
    (0.000, 0.010, 0.212, 0.100),
    (0.006, 0.026, 0.268, 0.072),
    (0.020, 0.045, 0.306, 0.048),
    (0.046, 0.066, 0.327, 0.031),
    (0.079, 0.084, 0.330, 0.021),
    (0.109, 0.097, 0.320, 0.0145),
    (0.132, 0.104, 0.304, 0.0100),
    (0.147, 0.106, 0.292, 0.0068),
    (0.159, 0.105, 0.290, 0.0036),
]

K_TIP = 0.045
K_DRAPE = 0.040
K_PUCK = 0.030
K_HEM = 0.040
K_UPPER = 0.035
K_COLLAR = 0.006
K_NECK = 0.014
K_CUT = 0.004
K_RIM = 0.006
K_FEET = 0.008
K_GROUND = 0.006

# Face (dark concave surface) and eyes, all in the opening frame (u, w, m).
FACE_EDGE_M = -0.020
FACE_CONCAVITY = 0.010
FACE_EXTEND = 1.16
EYE_U = 0.036
EYE_W = -0.004
EYE_R = (0.0134, 0.0055, 0.0245)
EYE_GROUP_TILT = math.radians(-8.0)
EYE_EMBED = 0.0015

# Cape: a scarf-like sheet that leaves the figure's left shoulder from under the hood and flows
# outward (+X) and backward (+Y) to one soft point. Top and bottom edge paths, root first.
# Cylindrical layout around the body axis: angle 0 = figure's left (+X), 90 = back (+Y).
CAPE_NU, CAPE_NV = 6, 17
CAPE_PHI = (-25.0, 140.0)
CAPE_ROOT = (0.080, 0.112)          # radius, height (inside the scarf collar)
CAPE_HEM = (0.112, 0.060, 0.034)    # radius, hem height at the front edge and at the back end
CAPE_FRONT_TAPER = 0.22             # fraction of the span over which the front end tapers in
CAPE_FRONT_MIN = 0.010              # hanging length of the very front column
CAPE_WIND_PHI = 45.0                # centre of the part lifted by the wind (deg)
CAPE_WIND_WIDTH = 50.0
CAPE_WIND = (0.030, 0.030, 0.006)   # outward, backward, upward displacement at the hem
CAPE_POINTS = [(22.0, 15.0, 0.042), (72.0, 13.0, 0.034)]   # angle, width (deg), stretch
CAPE_FOLD, CAPE_FOLD_FREQ = 0.012, 2.6
CAPE_SUBSURF = 2
CAPE_CLEARANCE = 0.0075
CAPE_THICKNESS = 0.008
CAPE_TRIS = 2600

# Budget (triangles): the body gets whatever the other parts leave of the total.
TOTAL_TRIS = 15900
GRID_H = 0.0015

# Colours (sRGB hex)
COL_CLOTH = "2a2824"
COL_FEET = "1c1b18"
COL_RIM = "3a3731"
COL_FACE = "0b0a09"
COL_EYE = "f7f7f4"
AO_MIN = 0.45
AO_DISTANCE = 0.07
TEX_SIZE = 1024


# ---------------------------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------------------------

def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1.0 / 2.4) - 0.055)


def hex_linear(h):
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(float(v) for v in srgb_to_linear(rgb))


# ---------------------------------------------------------------------------------------------
# Signed distance field
# ---------------------------------------------------------------------------------------------

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1.0 - h) + a * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sd_ellipsoid(x, y, z, c, r):
    px, py, pz = (x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]
    k0 = np.sqrt(px * px + py * py + pz * pz)
    qx, qy, qz = px / r[0], py / r[1], pz / r[2]
    k1 = np.sqrt(qx * qx + qy * qy + qz * qz) + 1e-12
    return k0 * (k0 - 1.0) / k1


def sd_round_cone(x, y, z, a, b, r1, r2):
    """Exact distance to a cone with spherical caps of radius r1 at a and r2 at b."""
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pax, pay, paz = x - a[0], y - a[1], z - a[2]
    yv = pax * ba[0] + pay * ba[1] + paz * ba[2]
    zv = yv - l2
    wx, wy, wz = pax * l2 - ba[0] * yv, pay * l2 - ba[1] * yv, paz * l2 - ba[2] * yv
    x2 = wx * wx + wy * wy + wz * wz
    y2 = yv * yv * l2
    z2 = zv * zv * l2
    k = math.copysign(1.0, rr) * rr * rr * x2
    d_b = np.sqrt(x2 + z2) * il2 - r2
    d_a = np.sqrt(x2 + y2) * il2 - r1
    d_s = (np.sqrt(x2 * a2 * il2) + yv * rr) * il2 - r1
    return np.where(np.sign(zv) * a2 * z2 > k, d_b, np.where(np.sign(yv) * a2 * y2 < k, d_a, d_s))


def catmull_rom(points, per_segment):
    pts = np.asarray(points, dtype=np.float64)
    ext = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1:i + 3]
        for s in range(per_segment):
            t = s / per_segment
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return np.array(out)


TIP_SAMPLES = catmull_rom(TIP_POINTS, 4)
TIP_SEGS = [(TIP_SAMPLES[i, :3], TIP_SAMPLES[i + 1, :3], TIP_SAMPLES[i, 3], TIP_SAMPLES[i + 1, 3])
            for i in range(len(TIP_SAMPLES) - 1)]
TIP_LO = TIP_SAMPLES[:, :3].min(0) - TIP_SAMPLES[:, 3].max() - 0.07
TIP_HI = TIP_SAMPLES[:, :3].max(0) + TIP_SAMPLES[:, 3].max() + 0.07


def sd_tip(x, y, z):
    out = np.full(x.shape, 1.0)
    mask = ((x > TIP_LO[0]) & (x < TIP_HI[0]) & (y > TIP_LO[1]) & (y < TIP_HI[1])
            & (z > TIP_LO[2]) & (z < TIP_HI[2]))
    if not mask.any():
        return out
    xs, ys, zs = x[mask], y[mask], z[mask]
    d = np.full(xs.shape, 1.0)
    for a, b, r1, r2 in TIP_SEGS:
        d = np.minimum(d, sd_round_cone(xs, ys, zs, a, b, r1, r2))
    out[mask] = d
    return out


def opening_axes():
    t = OPEN_TILT
    up = np.array([0.0, -math.sin(t), math.cos(t)])
    nrm = np.array([0.0, -math.cos(t), -math.sin(t)])
    return np.array([1.0, 0.0, 0.0]), up, nrm


def opening_coords(x, y, z):
    _, up, nrm = opening_axes()
    dy, dz = y - OPEN_C[1], z - OPEN_C[2]
    return x - OPEN_C[0], dy * up[1] + dz * up[2], dy * nrm[1] + dz * nrm[2]


def opening_point(u, w, m):
    ax, up, nrm = opening_axes()
    return np.array(OPEN_C) + u * ax + w * up + m * nrm


def ellipse_dist(u, w, a, b):
    """Approximate signed distance to an ellipse in its plane (first order, exact near it)."""
    q = np.sqrt((u / a) ** 2 + (w / b) ** 2)
    g = np.sqrt((u / (a * a)) ** 2 + (w / (b * b)) ** 2)
    ratio = np.where(g > 1e-9, q / np.maximum(g, 1e-12), min(a, b))
    return (q - 1.0) * ratio


def sd_foot(x, y, z, side):
    cx, cy, cz = FOOT_C[0] * side, FOOT_C[1], FOOT_C[2]
    px, py, pz = x - cx, y - cy, z - cz
    yaw = FOOT_YAW * side
    c, s = math.cos(-yaw), math.sin(-yaw)
    lx, ly = px * c - py * s, px * s + py * c
    c, s = math.cos(-FOOT_PITCH), math.sin(-FOOT_PITCH)
    ly, lz = ly * c - pz * s, ly * s + pz * c
    return sd_ellipsoid(lx, ly, lz, (0.0, 0.0, 0.0), FOOT_R)


def sdf_parts(x, y, z):
    head = sd_ellipsoid(x, y, z, HEAD_C, HEAD_R)
    drape = sd_ellipsoid(x, y, z, DRAPE_C, DRAPE_R)
    u, w, m = opening_coords(x, y, z)
    e_open = ellipse_dist(u, w, OPEN_A, OPEN_B)
    puck = smax(ellipse_dist(u, w, OPEN_A + PUCK_PAD, OPEN_B + PUCK_PAD), m - PUCK_FRONT, 0.01)
    puck = smax(puck, PUCK_BACK - m, 0.01)
    hood = smin(head, sd_tip(x, y, z), K_TIP)
    hood = smin(hood, drape, K_DRAPE)
    hood = smin(hood, puck, K_PUCK)
    body = smin(sd_ellipsoid(x, y, z, BODY_C, BODY_R), sd_ellipsoid(x, y, z, UPPER_C, UPPER_R),
                K_UPPER)
    body = smin(body, sd_ellipsoid(x, y, z, HEM_C, HEM_R), K_HEM)
    d = smin(hood, body, K_NECK)
    cm = (z - COLLAR_C[2]) - math.tan(COLLAR_TILT) * (y - COLLAR_C[1])
    ce = ellipse_dist(x - COLLAR_C[0], y - COLLAR_C[1], COLLAR_A, COLLAR_B)
    d = smin(d, np.sqrt(ce * ce + cm * cm) - COLLAR_R, K_COLLAR)
    cutter = smax(e_open, -(m + CUT_DEPTH), K_CUT)
    d = smax(d, -cutter, K_CUT)
    rim = np.sqrt(e_open * e_open + m * m) - RIM_R
    d = smin(d, rim, K_RIM)
    feet = np.minimum(sd_foot(x, y, z, 1.0), sd_foot(x, y, z, -1.0))
    rest = d
    d = smin(d, feet, K_FEET)
    d = smax(d, -z, K_GROUND)
    return {"total": d, "rim": rim, "feet": feet, "rest": rest}


def sdf(x, y, z):
    return sdf_parts(x, y, z)["total"]


# ---------------------------------------------------------------------------------------------
# Surface extraction (naive surface nets) and projection onto the exact surface
# ---------------------------------------------------------------------------------------------

def sample_grid(lo, hi, h):
    xs = np.arange(lo[0], hi[0] + h, h)
    ys = np.arange(lo[1], hi[1] + h, h)
    zs = np.arange(lo[2], hi[2] + h, h)
    grid = np.empty((len(xs), len(ys), len(zs)), dtype=np.float32)
    yy, zz = np.meshgrid(ys, zs, indexing="ij")
    step = max(1, 900000 // yy.size)
    for i0 in range(0, len(xs), step):
        xi = xs[i0:i0 + step]
        x = np.broadcast_to(xi[:, None, None], (len(xi),) + yy.shape).ravel()
        y = np.broadcast_to(yy[None], (len(xi),) + yy.shape).ravel()
        z = np.broadcast_to(zz[None], (len(xi),) + zz.shape).ravel()
        grid[i0:i0 + len(xi)] = sdf(x, y, z).reshape((len(xi),) + yy.shape)
    return grid, np.array([xs[0], ys[0], zs[0]]), h


def surface_nets(grid, origin, h):
    nx, ny, nz = grid.shape
    shape_c = (nx - 1, ny - 1, nz - 1)
    all_cells, all_pos, quad_cells, quad_flip = [], [], [], []
    for axis in range(3):
        s0 = [slice(None)] * 3
        s1 = [slice(None)] * 3
        s0[axis] = slice(0, -1)
        s1[axis] = slice(1, None)
        a = grid[tuple(s0)]
        b = grid[tuple(s1)]
        idx = np.nonzero((a < 0) != (b < 0))
        fa = a[idx].astype(np.float64)
        fb = b[idx].astype(np.float64)
        pos = np.stack(idx, 1).astype(np.float64)
        pos[:, axis] += fa / (fa - fb)
        o1, o2 = [ax for ax in range(3) if ax != axis]
        corners = []
        ok = np.ones(len(fa), dtype=bool)
        for d1, d2 in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            ci = [idx[0].astype(np.int64), idx[1].astype(np.int64), idx[2].astype(np.int64)]
            ci[o1] = ci[o1] + d1
            ci[o2] = ci[o2] + d2
            valid = ((ci[o1] >= 0) & (ci[o1] < shape_c[o1]) & (ci[o2] >= 0)
                     & (ci[o2] < shape_c[o2]))
            lin = (np.clip(ci[0], 0, shape_c[0] - 1) * shape_c[1]
                   + np.clip(ci[1], 0, shape_c[1] - 1)) * shape_c[2] + np.clip(ci[2], 0,
                                                                                shape_c[2] - 1)
            all_cells.append(lin[valid])
            all_pos.append(pos[valid])
            corners.append(lin)
            ok &= valid
        sign = 1 if axis != 1 else -1
        flip = (fa < 0) != (sign == 1)
        quad_cells.append(np.stack(corners, 1)[ok])
        quad_flip.append(flip[ok])
    cells = np.concatenate(all_cells)
    pos = np.concatenate(all_pos)
    uniq, inv = np.unique(cells, return_inverse=True)
    cnt = np.bincount(inv, minlength=len(uniq)).astype(np.float64)
    verts = np.stack([np.bincount(inv, weights=pos[:, c], minlength=len(uniq)) / cnt
                      for c in range(3)], 1)
    verts = origin + verts * h
    quads = np.searchsorted(uniq, np.concatenate(quad_cells))
    flip = np.concatenate(quad_flip)
    quads[flip] = quads[flip][:, ::-1]
    # Ambiguous cells can emit the same quad twice with opposite winding (a zero-thickness fin);
    # drop every such pair so all edges stay two-manifold.
    _, inverse, counts = np.unique(np.sort(quads, 1), axis=0, return_inverse=True,
                                   return_counts=True)
    keep = counts[inverse.ravel()] == 1
    if not keep.all():
        log("surface nets: removed", int((~keep).sum()), "duplicate quads")
    return verts, quads[keep]


def project_to_surface(verts, iters=4, eps=1.5e-4):
    v = verts.copy()
    for _ in range(iters):
        x, y, z = v[:, 0], v[:, 1], v[:, 2]
        f = sdf(x, y, z)
        g = np.stack([
            (sdf(x + eps, y, z) - sdf(x - eps, y, z)),
            (sdf(x, y + eps, z) - sdf(x, y - eps, z)),
            (sdf(x, y, z + eps) - sdf(x, y, z - eps)),
        ], 1) / (2 * eps)
        g2 = np.maximum((g * g).sum(1), 1e-8)
        step = (f / g2)[:, None] * g
        v -= np.clip(step, -GRID_H, GRID_H)
    return v


# ---------------------------------------------------------------------------------------------
# Blender helpers
# ---------------------------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras,
                 bpy.data.lights, bpy.data.worlds):
        for item in list(coll):
            coll.remove(item)


def setup_cycles_gpu(scene, samples):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    used = []
    for dev in prefs.devices:
        dev.use = dev.type == "OPTIX"
        if dev.use:
            used.append(f"{dev.name} ({dev.type})")
    if not used:
        raise RuntimeError("No OptiX GPU device available")
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = samples
    log("Cycles device:", scene.cycles.device, prefs.compute_device_type, used)


def mesh_object(name, verts, faces, location=(0.0, 0.0, 0.0)):
    mesh = bpy.data.meshes.new(name)
    loc = np.asarray(location)
    faces = faces.tolist() if isinstance(faces, np.ndarray) else [list(f) for f in faces]
    mesh.from_pydata((np.asarray(verts) - loc).tolist(), [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(loc)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def shade_smooth(obj):
    obj.data.shade_smooth()


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    bpy.data.meshes.remove(old)
    new_mesh.name = obj.name


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def world_verts(obj):
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mat = np.array(obj.matrix_world)
    return co @ mat[:3, :3].T + mat[:3, 3]


def principled(name, base, roughness, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True  # closed meshes: export single-sided
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


# ---------------------------------------------------------------------------------------------
# Parts
# ---------------------------------------------------------------------------------------------

def build_body(target_tris):
    lo = (-0.165, -0.165, -0.008)
    hi = (0.200, 0.160, 0.380)
    grid, origin, h = sample_grid(lo, hi, GRID_H)
    log("SDF grid", grid.shape, "min", float(grid.min()))
    border = np.concatenate([grid[0].ravel(), grid[-1].ravel(), grid[:, 0].ravel(),
                             grid[:, -1].ravel(), grid[:, :, 0].ravel(), grid[:, :, -1].ravel()])
    if border.min() <= 0:
        raise RuntimeError("Shape touches the sampling box")
    verts, quads = surface_nets(grid, origin, h)
    log("surface nets", len(verts), "verts", len(quads), "quads")
    verts = project_to_surface(verts)
    obj = mesh_object("Body", verts, quads)
    repair_pinches(obj)
    dec = obj.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = target_tris / (2.0 * len(quads))
    dec.use_collapse_triangulate = True
    apply_modifiers(obj)
    shade_smooth(obj)
    log("Body tris", tri_count(obj))
    check_closed(obj)
    return obj


def repair_pinches(obj):
    """Surface nets can join two sheets at one cell (edges with four faces). Cut those few
    spots out and close the holes again so the mesh is a clean closed two-manifold."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for _ in range(4):
        bad = [e for e in bm.edges if len(e.link_faces) != 2]
        if not bad:
            break
        verts = {v for e in bad for v in e.verts}
        verts |= {n for v in list(verts) for e in v.link_edges for n in e.verts}
        bmesh.ops.delete(bm, geom=list(verts), context="VERTS")
        boundary = [e for e in bm.edges if e.is_boundary]
        filled = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
        bmesh.ops.triangulate(bm, faces=filled["faces"])
        log("repaired", len(bad), "pinched edges, filled", len(filled["faces"]), "holes")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def check_closed(obj):
    """Log open/non-manifold edges and the signed volume (positive = outward normals)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bad = [e for e in bm.edges if len(e.link_faces) != 2]
    where = [(len(e.link_faces),) + tuple(round(c, 3) for c in (e.verts[0].co + e.verts[1].co) / 2)
             for e in bad[:6]]
    volume = bm.calc_volume(signed=True)
    bm.free()
    log(obj.name, "non-manifold edges", len(bad), where, "signed volume", round(volume, 6))


def build_face():
    rings, segs = 10, 48
    radii = np.linspace(0.0, FACE_EXTEND, rings + 1)[1:]

    def point(r, th):
        rc = min(r, 1.0)
        m = FACE_EDGE_M - FACE_CONCAVITY * (1.0 - rc * rc)
        return opening_point(OPEN_A * r * math.cos(th), OPEN_B * r * math.sin(th), m)

    centre = point(0.0, 0.0)
    verts = [centre]
    for r in radii:
        for s in range(segs):
            verts.append(point(r, 2 * math.pi * s / segs))
    faces = [(0, 1 + (s + 1) % segs, 1 + s) for s in range(segs)]
    for ri in range(rings - 1):
        a0, b0 = 1 + ri * segs, 1 + (ri + 1) * segs
        for s in range(segs):
            s1 = (s + 1) % segs
            faces.append((a0 + s, a0 + s1, b0 + s1, b0 + s))
    obj = mesh_object("Face", verts, faces, location=centre)
    obj.data.update()
    _, _, nrm = opening_axes()
    if Vector(obj.data.polygons[0].normal).dot(Vector(nrm)) < 0:
        obj.data.flip_normals()
    shade_smooth(obj)
    return obj


def face_m(u, w):
    r2 = min(1.0, (u / OPEN_A) ** 2 + (w / OPEN_B) ** 2)
    return FACE_EDGE_M - FACE_CONCAVITY * (1.0 - r2)


def build_eye(name, side):
    # A negative rotation about +Y turns the eye pair counter-clockwise as seen by the viewer:
    # the figure's left eye (viewer's right) sits higher and the tops lean to the viewer's left.
    alpha = -EYE_GROUP_TILT
    c, s = math.cos(alpha), math.sin(alpha)
    u0, w0 = EYE_U * side, EYE_W
    u = u0 * c - w0 * s
    w = u0 * s + w0 * c
    m = face_m(u, w) + EYE_R[1] - EYE_EMBED
    centre = opening_point(u, w, m)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        y = math.copysign(abs(y) ** 0.7, y)
        v.co = Vector((x * EYE_R[0], y * EYE_R[1], z * EYE_R[2]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = tuple(centre)
    obj.rotation_euler = (0.0, EYE_GROUP_TILT, 0.0)
    bpy.context.scene.collection.objects.link(obj)
    shade_smooth(obj)
    return obj


def build_cape():
    """A short thick cape leaving the figure's left shoulder, flowing back and to its left."""
    nu, nv = CAPE_NU, CAPE_NV
    y_axis = 0.012

    def cyl(r, phi, z):
        return np.array([r * math.cos(phi), y_axis + r * math.sin(phi), z])

    us = np.linspace(0.0, 1.0, nu)
    vs = np.linspace(0.0, 1.0, nv)
    phis = np.radians(CAPE_PHI[0] + (CAPE_PHI[1] - CAPE_PHI[0]) * vs)
    pts = np.zeros((nu, nv, 3))
    for j, (v, phi) in enumerate(zip(vs, phis, strict=True)):
        root = cyl(CAPE_ROOT[0], phi, CAPE_ROOT[1])
        # Hem height: the front end emerges from the collar, the back end hangs lower.
        t_front = min(1.0, v / CAPE_FRONT_TAPER)
        t_front = t_front * t_front * (3.0 - 2.0 * t_front)
        hem_z = CAPE_HEM[1] + (CAPE_HEM[2] - CAPE_HEM[1]) * v
        hem_z = CAPE_ROOT[1] - CAPE_FRONT_MIN - (CAPE_ROOT[1] - CAPE_FRONT_MIN - hem_z) * t_front
        hem = cyl(CAPE_HEM[0], phi, hem_z)
        for i, u in enumerate(us):
            pts[i, j] = root + (hem - root) * u

    def push_out(rows):
        for i in rows:
            for _ in range(8):
                d, g = body_normal(pts[i])
                pts[i] += g * np.maximum(0.0, CAPE_CLEARANCE - d)[:, None]

    def body_normal(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        eps = 1e-4
        g = np.stack([sdf(x + eps, y, z) - sdf(x - eps, y, z),
                      sdf(x, y + eps, z) - sdf(x, y - eps, z),
                      sdf(x, y, z + eps) - sdf(x, y, z - eps)], 1) / (2 * eps)
        return sdf(x, y, z), g / np.maximum(np.linalg.norm(g, axis=1), 1e-9)[:, None]

    # 1. Let the cape hang on the body with a small clearance.
    push_out(range(1, nu))
    # 2. Wind: the lower part on the figure's left side blows outward, backward and a little up;
    #    a narrower extra stretch at its centre pulls the hem corner into one soft point.
    wind_phi, wind_w = math.radians(CAPE_WIND_PHI), math.radians(CAPE_WIND_WIDTH)
    for j, phi in enumerate(phis):
        radial = np.array([math.cos(phi), math.sin(phi), 0.0])
        tangent = np.array([-math.sin(phi), math.cos(phi), 0.0])
        g_wind = math.exp(-((phi - wind_phi) / wind_w) ** 2)
        for i, u in enumerate(us):
            a = g_wind * u ** 2
            pts[i, j] += a * (CAPE_WIND[0] * radial + CAPE_WIND[1] * tangent)
            pts[i, j, 2] += a * CAPE_WIND[2]
            for tip_phi, tip_w, stretch in CAPE_POINTS:
                g_tip = math.exp(-((phi - math.radians(tip_phi)) / math.radians(tip_w)) ** 2)
                pull = radial * 0.7 + tangent * 0.6 + np.array([0.0, 0.0, -0.40])
                pts[i, j] += g_tip * u ** 3 * stretch * pull
    push_out(range(1, nu))
    # 3. A few big soft folds that grow towards the hem, raised along the body normal.
    for i in range(1, nu):
        _, g = body_normal(pts[i])
        wave = 0.5 + 0.5 * np.sin(2.0 * math.pi * CAPE_FOLD_FREQ * vs - 0.5 * math.pi)
        grow = max(0.0, (us[i] - 0.25) / 0.75) ** 1.2
        pts[i] += g * (CAPE_FOLD * wave * grow)[:, None]
    verts = pts.reshape(-1, 3)
    faces = []
    for i in range(nu - 1):
        for j in range(nv - 1):
            a = i * nv + j
            faces.append((a, a + 1, a + nv + 1, a + nv))
    attach = pts[0].mean(0)
    obj = mesh_object("Cape", verts, faces, location=attach)
    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = CAPE_THICKNESS
    sol.offset = 0.0
    sol.use_even_offset = True
    sub = obj.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = CAPE_SUBSURF
    sub.render_levels = CAPE_SUBSURF
    apply_modifiers(obj)
    tris = tri_count(obj)
    if tris > CAPE_TRIS:
        dec = obj.modifiers.new("Decimate", "DECIMATE")
        dec.ratio = CAPE_TRIS / tris
        dec.use_collapse_triangulate = True
        apply_modifiers(obj)
    shade_smooth(obj)
    check_closed(obj)
    log("Cape tris", tri_count(obj), "origin", tuple(round(c, 4) for c in attach))
    return obj


# ---------------------------------------------------------------------------------------------
# Albedo, UVs and bake
# ---------------------------------------------------------------------------------------------

def assign_albedo(obj, body=True):
    co = world_verts(obj)
    cloth = np.array(hex_linear(COL_CLOTH))
    col = np.tile(cloth, (len(co), 1))
    if body:
        parts = sdf_parts(co[:, 0], co[:, 1], co[:, 2])
        w_foot = np.clip(0.5 + (parts["rest"] - parts["feet"]) / 0.012, 0.0, 1.0)
        w_rim = np.clip((0.0035 - parts["rim"]) / 0.005, 0.0, 1.0)
        w_foot = w_foot * w_foot * (3 - 2 * w_foot)
        w_rim = w_rim * w_rim * (3 - 2 * w_rim)
        col = col * (1 - w_foot[:, None]) + np.array(hex_linear(COL_FEET)) * w_foot[:, None]
        col = col * (1 - w_rim[:, None]) + np.array(hex_linear(COL_RIM)) * w_rim[:, None]
    rgba = np.concatenate([col, np.ones((len(co), 1))], 1).astype(np.float32)
    attr = obj.data.color_attributes.new("Albedo", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", rgba.ravel())


def unwrap(objs):
    view_layer = bpy.context.view_layer
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62.0), island_margin=0.012,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.012)
    bpy.ops.object.mode_set(mode="OBJECT")


def new_image(name, colour, is_float):
    img = bpy.data.images.new(name, TEX_SIZE, TEX_SIZE, alpha=False, float_buffer=is_float)
    img.generated_color = (*colour, 1.0)
    if is_float:
        img.colorspace_settings.name = "Linear Rec.709"
    return img


def image_array(img):
    arr = np.empty(TEX_SIZE * TEX_SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    return arr.reshape(TEX_SIZE, TEX_SIZE, 4)


def bake_cloth(body, cape, occluders):
    scene = bpy.context.scene
    setup_cycles_gpu(scene, samples=512)
    scene.cycles.use_denoising = False
    world = bpy.data.worlds.new("BakeWorld")
    scene.world = world
    world.light_settings.distance = AO_DISTANCE

    ground_mesh = bpy.data.meshes.new("BakeGround")
    ground_mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("BakeGround", ground_mesh)
    scene.collection.objects.link(ground)

    mat = bpy.data.materials.new("Cloth")
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Albedo"
    nt.links.new(attr.outputs["Color"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    img_node = nt.nodes.new("ShaderNodeTexImage")
    for o in (body, cape):
        o.data.materials.clear()
        o.data.materials.append(mat)

    ao_img = new_image("bake_ao", (1.0, 1.0, 1.0), True)
    alb_img = new_image("bake_albedo", hex_linear(COL_CLOTH), True)

    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    cape.select_set(True)
    bpy.context.view_layer.objects.active = body
    for kind, img in (("AO", ao_img), ("EMIT", alb_img)):
        img_node.image = img
        nt.nodes.active = img_node
        bpy.ops.object.bake(type=kind, margin=8, margin_type="EXTEND", use_clear=False,
                            target="IMAGE_TEXTURES")
        log("baked", kind)

    ao = image_array(ao_img)[..., :3].mean(-1, keepdims=True)
    alb = image_array(alb_img)[..., :3]
    mult = AO_MIN + (1.0 - AO_MIN) * np.clip(ao, 0.0, 1.0)
    final_lin = alb * mult
    # Texels outside every island (beyond the 8 px margin) get the plain cloth colour so that
    # mipmaps never bleed black into the seams.
    empty = alb.sum(-1) < 1e-6
    final_lin[empty] = np.array(hex_linear(COL_CLOTH))
    log("texture coverage", round(1.0 - float(empty.mean()), 3))
    final = np.concatenate([linear_to_srgb(final_lin), np.ones(final_lin.shape[:2] + (1,))], -1)
    log("AO range", float(ao.min()), float(ao.max()), "mult min", float(mult.min()))

    tex = bpy.data.images.new("Cloth_BaseColor", TEX_SIZE, TEX_SIZE, alpha=False)
    tex.colorspace_settings.name = "sRGB"
    tex.pixels.foreach_set(final.astype(np.float32).ravel())
    os.makedirs(TMP, exist_ok=True)
    tex.filepath_raw = os.path.join(TMP, "cloth_basecolor.png")
    tex.file_format = "PNG"
    tex.save()
    tex.pack()

    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex_node = nt.nodes.new("ShaderNodeTexImage")
    tex_node.image = tex
    nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    for img in (ao_img, alb_img):
        bpy.data.images.remove(img)
    bpy.data.objects.remove(ground)
    bpy.data.meshes.remove(ground_mesh)
    for o in (body, cape):
        for a in list(o.data.color_attributes):
            o.data.color_attributes.remove(a)
    scene.world = None
    bpy.data.worlds.remove(world)


def centre_on_footprint(body, others):
    """Move everything so the centre of the ground contact footprint sits at the origin."""
    co = world_verts(body)
    contact = co[co[:, 2] < 0.0005]
    off = (contact[:, :2].min(0) + contact[:, :2].max(0)) * 0.5
    off[0] = 0.0  # the figure is symmetric in X apart from the cape and the hood tip
    log("footprint bbox", np.round(contact[:, :2].min(0), 4).tolist(),
        np.round(contact[:, :2].max(0), 4).tolist(), "shift", np.round(-off, 4).tolist())
    shift = Vector((-off[0], -off[1], 0.0))
    body.data.transform(Matrix.Translation(shift))
    body.data.update()
    for o in others:
        o.location = o.location + shift
    bpy.context.view_layer.update()


# ---------------------------------------------------------------------------------------------
# Export and inspection
# ---------------------------------------------------------------------------------------------

def export_glb():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format="GLB", export_yup=True, export_apply=True,
        export_cameras=False, export_lights=False, export_animations=False,
        export_image_format="AUTO", export_vertex_color="NONE", export_texcoords=True,
        export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_extras=False, use_selection=False,
    )
    log("exported", GLB, os.path.getsize(GLB), "bytes")


def inspect_glb():
    with open(GLB, "rb") as fh:
        data = fh.read()
    length = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + length])
    tris = 0
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            tris += doc["accessors"][prim["indices"]]["count"] // 3
    log("GLB triangles", tris, "images", [im.get("mimeType") for im in doc.get("images", [])])
    for node in doc["nodes"]:
        acc = doc["accessors"][doc["meshes"][node["mesh"]]["primitives"][0]["attributes"]
                               ["POSITION"]]
        log("node", node["name"], "t", node.get("translation"), "r", node.get("rotation"),
            "s", node.get("scale"), "local min", acc["min"], "max", acc["max"])
    log("scene roots", [doc["nodes"][i]["name"] for i in doc["scenes"][0]["nodes"]])


# ---------------------------------------------------------------------------------------------
# Previews (rendered from the exported GLB in a fresh scene)
# ---------------------------------------------------------------------------------------------

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area(name, loc, target, energy, size, temperature=None, colour=None):
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.size = size
    if temperature is not None:
        light.use_temperature = True
        light.temperature = temperature
    if colour is not None:
        light.color = colour
    obj = bpy.data.objects.new(name, light)
    obj.location = loc
    bpy.context.scene.collection.objects.link(obj)
    look_at(obj, target)
    return obj


def camera_at(azimuth_deg, elevation_deg, target, distance):
    az, el = math.radians(azimuth_deg), math.radians(elevation_deg)
    # azimuth 0 = in front of the figure (-Y), positive towards the figure's left (+X)
    loc = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 85.0
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    cam.location = Vector(target) + loc * distance
    bpy.context.scene.collection.objects.link(cam)
    look_at(cam, target)
    bpy.context.scene.camera = cam
    return cam


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("rendered", path)


def render_previews():
    reset_scene()
    scene = bpy.context.scene
    setup_cycles_gpu(scene, samples=96)
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    bpy.ops.import_scene.gltf(filepath=GLB)
    meshes = [o for o in scene.objects if o.type == "MESH"]
    log("imported", sorted(o.name for o in meshes))
    pts = np.concatenate([world_verts(o) for o in meshes])
    lo, hi = pts.min(0), pts.max(0)
    log("imported bbox min", np.round(lo, 4).tolist(), "max", np.round(hi, 4).tolist())
    target = (0.012, 0.0, float(hi[2] * 0.5))

    world = bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.20, 0.20, 0.20, 1.0)
    bg.inputs["Strength"].default_value = 0.6

    ground_mesh = bpy.data.meshes.new("Ground")
    ground_mesh.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    ground = bpy.data.objects.new("Ground", ground_mesh)
    scene.collection.objects.link(ground)
    ground_mesh.materials.append(principled("GroundMat", (0.2, 0.2, 0.2), 0.9))

    lights = [
        add_area("Key", (-0.75, -0.85, 0.95), target, 28.0, 0.6),
        add_area("Fill", (0.95, -0.55, 0.35), target, 9.0, 0.9),
        add_area("Rim", (0.35, 0.95, 0.75), target, 22.0, 0.5),
    ]
    for name, az, el in (("front", 0, 6), ("34", 32, 16), ("side", 90, 6), ("back", 180, 8)):
        cam = camera_at(az, el, target, 1.35)
        render_to(os.path.join(OUT, f"preview_{name}.png"))
        bpy.data.objects.remove(cam)

    # Dark use-case render: near-black world, warm key upper left, cool rim behind right.
    bpy.data.objects.remove(ground)
    for light in lights:
        bpy.data.objects.remove(light)
    bg.inputs["Color"].default_value = (*hex_linear("060605"), 1.0)
    bg.inputs["Strength"].default_value = 1.0
    add_area("WarmKey", (-0.8, -0.75, 0.85), target, 10.0, 0.5, temperature=2700.0)
    add_area("CoolRim", (0.10, 1.00, 0.45), target, 45.0, 0.30, temperature=7500.0)
    camera_at(32, 16, target, 1.35)
    render_to(os.path.join(OUT, "preview_dark.png"))


# ---------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------

def main():
    reset_scene()
    face = build_face()
    eye_l = build_eye("EyeL", 1.0)
    eye_r = build_eye("EyeR", -1.0)
    cape = build_cape()
    body = build_body(TOTAL_TRIS - sum(tri_count(o) for o in (face, eye_l, eye_r, cape)))

    face.data.materials.append(principled("Face", hex_linear(COL_FACE), 1.0))
    eye_mat = principled("Eye", hex_linear(COL_EYE), 0.4, emission=hex_linear(COL_EYE))
    eye_l.data.materials.append(eye_mat)
    eye_r.data.materials.append(eye_mat)

    assign_albedo(body, body=True)
    assign_albedo(cape, body=False)
    unwrap([body, cape])
    bake_cloth(body, cape, [face, eye_l, eye_r])

    centre_on_footprint(body, [face, eye_l, eye_r, cape])

    total = sum(tri_count(o) for o in (body, face, eye_l, eye_r, cape))
    log("triangles", {o.name: tri_count(o) for o in (body, face, eye_l, eye_r, cape)}, total)
    pts = np.concatenate([world_verts(o) for o in (body, face, eye_l, eye_r, cape)])
    log("bbox min", np.round(pts.min(0), 4).tolist(), "max", np.round(pts.max(0), 4).tolist())
    body_pts = world_verts(body)
    log("body-only bbox", np.round(body_pts.min(0), 4).tolist(),
        np.round(body_pts.max(0), 4).tolist())
    for o in (body, face, eye_l, eye_r, cape):
        log("object", o.name, "loc", np.round(np.array(o.location), 4).tolist(),
            "rot", np.round(np.degrees(np.array(o.rotation_euler)), 2).tolist())
    for o in (eye_l, eye_r):
        log("eye", o.name, "dims", np.round(np.array(o.dimensions), 4).tolist())

    export_glb()
    inspect_glb()
    if "--no-previews" not in ARGS:
        render_previews()
    log("done")


main()
