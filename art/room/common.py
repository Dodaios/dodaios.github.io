# ruff: noqa: E501
# ruff: noqa: UP031, B905, S110, S324
"""The room's shared pipeline: materials, quads, anchors, the shell, the one
light rig, the lightmap bake, the GLB export and the previews.

Every zone script does

    import common
    def build(): ...
    if __name__ == "__main__":
        common.run_zone("<name>", build)

and runs headless:

    blender --background --factory-startup --python zone_<name>.py -- [flags]

Flags after `--`:
  --skip-bake       build, then fast lit Cycles renders from the zone's cameras (out/lit_<zone>_<state>_<cam>.png)
  --previews-only   only re-render the previews from the GLBs and atlases already in out/
  --samples N       bake samples for the lighting passes (default 512, denoised)
  --regrade         reuse the cached float bakes in cache/ (same geometry and UVs), redo grading, export, previews
  --no-previews     skip the previews
  --cameras a,b     override the preview cameras
  --states night    bake/preview only these states (default night,dawn)

All positions are glTF / three.js (X right, Y up, Z toward the viewer) unless a
name says Blender; convert with G() / spec.to_blender, never by hand.
"""

from __future__ import annotations

import hashlib
import importlib.util
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from bpy_extras import mesh_utils
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.abspath(__file__)).replace("\\", "/")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
import spec  # noqa: E402
from spec import ANCHORS, CAMERAS, EMISSION, LIGHTS, PALETTE, QUADS, ROOM, ZONES  # noqa: E402

OUT = ROOT + "/out"
CACHE = ROOT + "/cache"
FONTS = ROOT + "/fonts"
FONT_HEAVY = FONTS + "/Inter-ExtraBold.ttf"  # wght 800
FONT_MEDIUM = FONTS + "/Inter-Medium.ttf"  # wght 500
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(flag, default=None):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default


SKIP_BAKE = "--skip-bake" in ARGS
PREVIEWS_ONLY = "--previews-only" in ARGS
REGRADE = "--regrade" in ARGS
NO_PREVIEWS = "--no-previews" in ARGS
SAMPLES = int(_arg("--samples", 512))
STATES = _arg("--states", "night,dawn").split(",")
ATLAS = 2048
PACK_MARGIN = 0.0025  # SCALED pack margin: about 5 px between islands (the 16 px bake margin covers the bleed)
BAKE_MARGIN = 16  # px of edge extension around islands

# Cameras a zone is judged from, if run_zone() is not given a list.
ZONE_CAMERAS = {
    "desk": ["hero", "desk_medium", "mascot", "desk_wide"],
    "right": ["agents", "agents_close", "finale"],
    "lounge": ["holo", "finale"],
    "window": ["window", "corkboard"],
    "corner": ["whiteboard", "blueprint"],
}

T0 = time.time()
_TAG = "room"


def log(*a):
    print("[%s %6.1fs]" % (_TAG, time.time() - T0), *a, flush=True)


# --------------------------------------------------------------------------- #
# Coordinates and colour
# --------------------------------------------------------------------------- #

def G(x, y=None, z=None):
    """glTF (x, y, z) -> Blender Vector. Accepts G(x, y, z) or G((x, y, z))."""
    if y is None:
        x, y, z = x
    return Vector((x, -z, y))


def to_gltf(v):
    """Blender Vector -> glTF tuple."""
    return (v[0], v[2], -v[1])


def srgb2lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    """sRGB hex -> linear RGB tuple."""
    h = h.lstrip("#")
    return tuple(srgb2lin(int(h[i:i + 2], 16)) for i in (0, 2, 4))


def colour(c):
    """A palette key, a hex string or a linear tuple -> linear RGB."""
    if isinstance(c, (tuple, list)):
        return tuple(c[:3])
    if c in PALETTE:
        return hexcol(PALETTE[c])
    return hexcol(c)


def _kelvin_raw(k):
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


WHITE_K = 5000.0  # the camera's white: light colours are relative to this


def kelvin(k):
    c = [a / b for a, b in zip(_kelvin_raw(k), _kelvin_raw(WHITE_K))]
    m = max(c)
    return tuple(x / m for x in c)


# --------------------------------------------------------------------------- #
# GPU
# --------------------------------------------------------------------------- #

def setup_gpu(scene=None):
    scene = scene or bpy.context.scene
    prefs = bpy.context.preferences.addons["cycles"].preferences
    used = []
    for dev_type in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dev_type
        except TypeError:
            continue
        prefs.get_devices()
        used = []
        for d in prefs.devices:
            d.use = d.type == dev_type
            if d.use:
                used.append(d.name)
        if used:
            break
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU" if used else "CPU"
    log("Cycles device:", scene.cycles.device, prefs.compute_device_type, used)
    if not used:
        log("WARNING: no GPU device found, rendering on the CPU")


# --------------------------------------------------------------------------- #
# Materials
# --------------------------------------------------------------------------- #

def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _new_principled(name, base, rough=0.9, metallic=0.0, spec_level=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = principled(m)
    p.inputs["Base Color"].default_value = (*base, 1.0)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Specular IOR Level"].default_value = spec_level
    return m


GOLD_VALUE = 0.45


def mat(key):
    """The material for a palette key. Matte (roughness 0.9, no specular), no textures.
    'gold' is the one exception: metallic, and baked with glossy (the wordmark)."""
    name = "M_" + key
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    if key == "gold":
        # forged gold: the palette hue at a lower value, so that at the room's exposure it stays
        # gold instead of bleaching to cream under AgX; metallic, baked with glossy
        g = colour(key)
        m = _new_principled(name, tuple(c * GOLD_VALUE for c in g), rough=0.33, metallic=0.9, spec_level=0.5)
        m["glossy"] = True
    else:
        m = _new_principled(name, colour(key), rough=0.9)
    m["key"] = key
    return m


def emissive(key, strength=4.0):
    """A small emitter (LED line, status light): 'accent', 'success' or 'screen_glow'.
    Same in both states; it is baked into the zone's atlas and lights its surroundings."""
    name = "E_%s_%g" % (key, strength)
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = _new_principled(name, colour("device"), rough=0.9)
    p = principled(m)
    p.inputs["Emission Color"].default_value = (*colour(key), 1.0)
    p.inputs["Emission Strength"].default_value = strength
    m["key"] = key
    m["emit"] = strength
    return m


def tag_glossy(obj):
    """Bake this object WITH glossy reflections (only the wordmark needs it).
    Its materials are copied and flagged; give them some metallic/specular yourself."""
    for slot in obj.material_slots:
        m = slot.material
        if m is None or m.get("glossy"):
            continue
        c = m.copy()
        c.name = m.name + "_gloss"
        c["glossy"] = True
        slot.material = c
    obj["glossy"] = True


# --------------------------------------------------------------------------- #
# Modelling helpers (optional; the desk is built with them). bmesh, Blender space.
# --------------------------------------------------------------------------- #

def bevel(bm, width, segs=3, angle=30.0, only=None):
    """Bevel every edge sharper than `angle` degrees."""
    edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(angle)]
    if only:
        edges = [e for e in edges if only(e)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=width, offset_type="OFFSET", segments=segs,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    return bm


def bm_box(size, center=(0, 0, 0)):
    """A box bmesh; size and centre in glTF axes (x width, y height, z depth)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    c = G(*center)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy)) + c
    return bm


def xform(at=(0, 0, 0), yaw=0.0, tilt=0.0, roll=0.0):
    """glTF placement -> Blender matrix: translate to `at`, yaw about vertical (deg),
    tilt about the local X axis (deg, positive leans the top toward -Z/back), roll about the local depth axis."""
    return (Matrix.Translation(G(*at)) @ Matrix.Rotation(math.radians(yaw), 4, "Z")
            @ Matrix.Rotation(math.radians(-tilt), 4, "X") @ Matrix.Rotation(math.radians(roll), 4, "Y"))


def finish(bm, name, key, smooth=True, sharp_deg=40.0, weighted=True, texel=1.0, drop_bottom=False, collection=None):
    """bmesh -> object with crisp-smooth normals. `key` is a palette key, a material,
    or a list of either (faces keep their material_index)."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if drop_bottom and bm.verts:
        zmin = min(v.co.z for v in bm.verts)
        kill = [f for f in bm.faces if f.normal.z < -0.99 and all(abs(v.co.z - zmin) < 1e-4 for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
    _orient_closed(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    keys = key if isinstance(key, (list, tuple)) else [key]
    for k in keys:
        me.materials.append(k if isinstance(k, bpy.types.Material) else mat(k))
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


def _orient_closed(bm):
    """recalc_face_normals can leave a closed mesh inside out: flip it if its signed volume is negative."""
    if not bm.faces or any(not e.is_manifold for e in bm.edges):
        return
    bm.normal_update()
    vol = 0.0
    for f in bm.faces:
        vs = [v.co for v in f.verts]
        for i in range(1, len(vs) - 1):
            vol += vs[0].dot(vs[i].cross(vs[i + 1]))
    if vol < 0:
        for f in bm.faces:
            f.normal_flip()


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)


def box(name, key, size, center, bev=0.006, segs=3, yaw=0.0, tilt=0.0, texel=1.0, drop_bottom=False):
    """A bevelled box. size/centre glTF; yaw/tilt in degrees about the centre."""
    bm = bm_box(size)
    bevel(bm, min(bev, min(size) * 0.45), segs)
    bm.transform(xform(center, yaw, tilt))
    return finish(bm, name, key, texel=texel, drop_bottom=drop_bottom)


def rrect_pts(hx, hz, radii, n=8, cx=0.0, cz=0.0):
    """Rounded rectangle in the glTF XZ plane as Blender XY points, CCW from above.
    radii: (front-right, back-right, back-left, front-left)."""
    pts = []
    corners = [((hx, hz), radii[1], 0.0), ((-hx, hz), radii[2], 90.0), ((-hx, -hz), radii[3], 180.0), ((hx, -hz), radii[0], 270.0)]
    for (x, y), r, a0 in corners:
        r = max(r, 1e-4)
        ccx = x - math.copysign(r, x)
        ccy = y - math.copysign(r, y)
        for i in range(n + 1):
            a = math.radians(a0 + 90.0 * i / n)
            pts.append((cx + ccx + r * math.cos(a), -cz + ccy + r * math.sin(a)))
    return pts


def loft(rings, cap_start=True, cap_end=True):
    """rings: list of equal-length closed loops of Blender Vectors."""
    bm = bmesh.new()
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(rings[0])
    for a, b in zip(vr[:-1], vr[1:]):
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


def lathe(profile, segs=32, mat_of_seg=None):
    """profile: (r, h) points along the surface, revolved about local +Z (Blender). r == 0 makes a pole."""
    bm = bmesh.new()
    rings = []
    for r, h in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, h))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), h)) for i in range(segs)])
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
    """Matrix moving local +Z onto `axis` at `origin` (Blender space)."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    return Matrix.Translation(origin) @ q.to_matrix().to_4x4()


def tube(path, r, sides=10, caps=True):
    """Sweep a circle of radius r along a polyline of Blender Vectors."""
    n = len(path)
    tangents = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    u = tangents[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        u = (u - t * u.dot(t)).normalized()
        v = t.cross(u)
        rings.append([path[i] + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)])
    return loft(rings, caps, caps)


def bezier_path(pts, n=24):
    """Catmull-Rom through glTF points -> list of Blender Vectors (for cables)."""
    P = [G(*p) for p in pts]
    P = [P[0]] + P + [P[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        steps = max(2, n // (len(P) - 3))
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return out


def merge_bm(dst, src):
    me = bpy.data.meshes.new("tmp")
    src.to_mesh(me)
    src.free()
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    return dst


def text_mesh(name, text, font=FONT_HEAVY, size=0.2, depth=0.02, bevel_depth=0.004, bevel_res=2, key="paper", align="CENTER", resolution=5):
    """Lettering as geometry (Blender text -> mesh). Lies in the Blender XY plane, extruded
    along +Z; place it with obj.matrix_world. Returns the mesh object."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = text
    cu.font = bpy.data.fonts.load(font, check_existing=True)
    cu.size = size
    cu.extrude = depth / 2
    cu.bevel_depth = bevel_depth
    cu.bevel_resolution = bevel_res
    cu.resolution_u = resolution
    cu.align_x = align
    cu.align_y = "CENTER"
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    mo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mo)
    me.materials.clear()
    me.materials.append(key if isinstance(key, bpy.types.Material) else mat(key))
    return mo


# --------------------------------------------------------------------------- #
# Quads, anchors, the mascot proxy
# --------------------------------------------------------------------------- #

# The desk zone moves these two to where its lamp really is; the light rig reads them.
ANCHOR_OVERRIDES = {
    "LampBulb": (-0.8335, 1.2265, -2.3407),
    "LampPool": (-0.5813, 0.74, -2.1229),
}


def anchor_at(name):
    return tuple(ANCHOR_OVERRIDES.get(name, ANCHORS[name]["at"]))


def quad_matrix(q):
    at, yaw, lean = q["at"], q.get("yaw", 0.0), q.get("lean", 0.0)
    return Matrix.Translation(G(*at)) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(-lean), 4, "X")


def _quad_bake_material(kind):
    name = "QB_" + kind
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.name = "EMIT"
    em.inputs["Color"].default_value = (*colour("screen_glow"), 1.0)
    em.inputs["Strength"].default_value = EMISSION["night"].get(kind, 0.0)
    back = nt.nodes.new("ShaderNodeBsdfDiffuse")
    back.inputs["Color"].default_value = (*colour("device"), 1.0)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(back.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m["kind"] = kind
    return m


def _quad_export_material(kind):
    name = "Quad_" + kind
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = principled(m)
    p.inputs["Roughness"].default_value = 1.0
    p.inputs["Specular IOR Level"].default_value = 0.0
    if kind == "surface":
        p.inputs["Base Color"].default_value = (1, 1, 1, 1)
        p.inputs["Alpha"].default_value = 0.0
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    else:
        p.inputs["Base Color"].default_value = (0, 0, 0, 1)
        p.inputs["Emission Color"].default_value = (*colour("screen_glow"), 1.0)
        p.inputs["Emission Strength"].default_value = 1.0
    m.use_backface_culling = True
    return m


def make_quad(name):
    """The spec's quad `name`: one face, exact size/centre/yaw/lean, UVs 0..1 (U left->right,
    V bottom->top as seen from its front). Never move, resize or re-UV it."""
    q = QUADS[name]
    if name in bpy.data.objects and bpy.data.objects[name].get("quad"):
        return bpy.data.objects[name]
    w, h = q["size"]
    me = bpy.data.meshes.new(name)
    verts = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    me.from_pydata(verts, [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for li, (u, v) in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[li].uv = (u, v)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = G(*q["at"])
    ob.rotation_euler = (math.radians(-q.get("lean", 0.0)), 0.0, math.radians(q.get("yaw", 0.0)))
    kind = q["kind"]
    ob["quad"] = kind
    if kind == "surface":
        me.materials.append(_quad_export_material("surface"))
        ob.hide_render = True  # surface quads take no part in the bake
    else:
        me.materials.append(_quad_bake_material(kind))
    return ob


def make_anchor(name, at=None, yaw=None):
    """An empty at the spec's anchor (the desk zone may pass its real `at` for LampBulb/LampPool)."""
    a = ANCHORS[name]
    if at is not None:
        ANCHOR_OVERRIDES[name] = tuple(at)
    pos = anchor_at(name)
    if name in bpy.data.objects and bpy.data.objects[name].get("anchor"):
        e = bpy.data.objects[name]
    else:
        e = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(e)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = 0.1
    e.location = G(*pos)
    e.rotation_euler = (0.0, 0.0, math.radians(a.get("yaw", 0.0) if yaw is None else yaw))
    e["anchor"] = True
    return e


def mascot_proxy():
    """A dark blob of the mascot's size at MascotAnchor, for the bake only (never exported)."""
    ob = bpy.data.objects.get("MascotProxy")
    if ob is not None:
        return ob
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        zz = (z + 1) / 2
        widen = 1.0 - 0.15 * zz
        v.co = Vector((x * 0.13 * widen, y * 0.11 * widen, zz * 0.36))
    a = ANCHORS["MascotAnchor"]
    bm.transform(xform(a["at"], a.get("yaw", 0.0)))
    ob = finish(bm, "MascotProxy", _proxy_material(), weighted=False)
    ob["proxy"] = True
    return ob


def _proxy_material():
    m = bpy.data.materials.get("M_proxy")
    if m is None:
        m = _new_principled("M_proxy", hexcol("#262626"), rough=0.9)
    return m


# --------------------------------------------------------------------------- #
# The shell: walls (window opening in the left wall, door recess in the front
# wall), floor, ceiling, skirting. Interior faces only (they cast and bake);
# separate exterior occluder planes (proxy, never exported) keep the room tight.
# --------------------------------------------------------------------------- #

X0, X1 = ROOM["x"]
Y0, Y1 = ROOM["y"]
Z0, Z1 = ROOM["z"]
WT = ROOM["wall_thickness"]
WIN = spec.WINDOW
DOOR = spec.DOOR
DOOR_DEPTH = 0.10  # recess depth into the front wall
SKIRT_H, SKIRT_D = 0.075, 0.014


def _wall_with_hole(name, frame, hole, depth, group, key="wall", reveal_key="wall_trim", back=False):
    """A wall face from 2D frame (u0, u1, v0, v1) in its own plane with a rectangular hole
    (u0, u1, v0, v1) or None, extruded `depth` behind the face as reveal; `back` closes the
    hole with a back face (a recess). `frame` lives in a local space mapped by the caller."""
    bm = bmesh.new()
    u0, u1, v0, v1 = frame
    if hole is None:
        us, vs = [u0, u1], [v0, v1]
    else:
        us = sorted(set([u0, hole[0], hole[1], u1]))
        vs = sorted(set([v0, hole[2], hole[3], v1]))
    grid = [[bm.verts.new((u, v, 0.0)) for u in us] for v in vs]
    for j in range(len(vs) - 1):
        for i in range(len(us) - 1):
            cu, cv = (us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2
            if hole is not None and hole[0] < cu < hole[1] and hole[2] < cv < hole[3]:
                continue
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.material_index = 0
    if hole is not None:
        hu0, hu1, hv0, hv1 = hole
        ring_front = [grid[vs.index(hv0)][us.index(hu0)], grid[vs.index(hv0)][us.index(hu1)],
                      grid[vs.index(hv1)][us.index(hu1)], grid[vs.index(hv1)][us.index(hu0)]]
        ring_back = [bm.verts.new((v.co.x, v.co.y, -depth)) for v in ring_front]
        for i in range(4):
            j = (i + 1) % 4
            if hv0 <= v0 + 1e-6 and i == 0:
                continue  # no reveal face at the floor (door)
            f = bm.faces.new((ring_front[i], ring_back[i], ring_back[j], ring_front[j]))
            f.material_index = 1
        if back:
            f = bm.faces.new(ring_back)
            f.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # face normals must point toward the room (+Z local)
    for f in bm.faces:
        if f.material_index == 0 and f.normal.z < 0:
            f.normal_flip()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if any(f.normal.z < -0.5 for f in bm.faces if f.material_index == 0):
        for f in bm.faces:
            f.normal_flip()
    if hole is not None:
        bevel(bm, 0.012, 3, angle=60, only=lambda e: all(abs(v.co.z) < 1e-6 for v in e.verts))
    return bm


def _place_wall(bm, which):
    """Map local (u, v, w) of a wall (w toward the room) into Blender space."""
    if which == "back":   # z = Z0, faces +Z; u = x, v = y
        M = lambda u, v, w: G(u, v, Z0 + w)  # noqa: E731
    elif which == "front":  # z = Z1, faces -Z; u = -x so the face looks into the room
        M = lambda u, v, w: G(-u, v, Z1 - w)  # noqa: E731
    elif which == "left":  # x = X0, faces +X; u = -z
        M = lambda u, v, w: G(X0 + w, v, -u)  # noqa: E731
    elif which == "right":  # x = X1, faces -X; u = z
        M = lambda u, v, w: G(X1 - w, v, u)  # noqa: E731
    for vtx in bm.verts:
        vtx.co = M(vtx.co.x, vtx.co.y, vtx.co.z)
    return bm


def _wall_frame(which):
    if which in ("back",):
        return (X0, X1, Y0, Y1)
    if which == "front":
        return (-X1, -X0, Y0, Y1)
    if which == "left":
        return (-Z1, -Z0, Y0, Y1)
    return (Z0, Z1, Y0, Y1)


def _skirting(which, gaps=()):
    """Skirting along a wall's base, broken at `gaps` (u ranges)."""
    u0, u1 = _wall_frame(which)[:2]
    spans, cur = [], u0
    for g0, g1 in sorted(gaps):
        spans.append((cur, g0))
        cur = g1
    spans.append((cur, u1))
    bm = bmesh.new()
    for a, b in spans:
        if b - a < 0.02:
            continue
        piece = bmesh.new()
        bmesh.ops.create_cube(piece, size=1.0)
        for v in piece.verts:
            v.co = Vector(((a + b) / 2 + v.co.x * (b - a), SKIRT_H / 2 + v.co.y * SKIRT_H, SKIRT_D / 2 + v.co.z * SKIRT_D))
        bevel(piece, 0.004, 2, angle=60, only=lambda e: all(v.co.y > SKIRT_H * 0.5 for v in e.verts) and all(v.co.z > SKIRT_D * 0.5 for v in e.verts))
        # drop the faces against the wall and the floor
        kill = [f for f in piece.faces if f.normal.z < -0.99 or f.normal.y < -0.99
                or (abs(f.normal.x) > 0.99 and min(abs(f.calc_center_median().x - u0), abs(f.calc_center_median().x - u1)) < 1e-4)]
        bmesh.ops.delete(piece, geom=kill, context="FACES")
        merge_bm(bm, piece)
    return _place_wall(bm, which)


def build_shell():
    """Walls with the window opening and the door recess, floor, ceiling, skirting.
    Returns {"a": [objects], "b": [objects]}; a = back wall + floor, b = the rest.
    Also adds exterior occluder planes (proxy). Idempotent."""
    if "Shell_floor" in bpy.data.objects:
        return {g: [o for o in bpy.data.objects if o.get("shell") == g] for g in ("a", "b")}
    parts = {"a": [], "b": []}

    def add(bm, name, group, keys, texel=1.0):
        ob = finish(bm, name, keys, smooth=True, sharp_deg=30, weighted=False, texel=texel)
        ob["shell"] = group
        _orient_into_room(ob, strict=True)
        parts[group].append(ob)
        return ob

    # floor (faces up) and ceiling (faces down)
    bm = bmesh.new()
    vs = [bm.verts.new(G(x, Y0, z)) for x, z in ((X0, Z1), (X1, Z1), (X1, Z0), (X0, Z0))]
    bm.faces.new(vs)
    add(bm, "Shell_floor", "a", ["floor"])
    bm = bmesh.new()
    vs = [bm.verts.new(G(x, Y1, z)) for x, z in ((X0, Z0), (X1, Z0), (X1, Z1), (X0, Z1))]
    bm.faces.new(vs)
    add(bm, "Shell_ceiling", "b", ["ceiling"], texel=0.6)
    # walls
    win_hole = (-WIN["z"][1], -WIN["z"][0], WIN["y"][0], WIN["y"][1])  # left wall u = -z
    door_hole = (-DOOR["x"][1], -DOOR["x"][0], DOOR["y"][0], DOOR["y"][1])  # front wall u = -x
    add(_place_wall(_wall_with_hole("back", _wall_frame("back"), None, 0, "a"), "back"), "Shell_wall_back", "a", ["wall", "wall_trim"])
    add(_place_wall(_wall_with_hole("left", _wall_frame("left"), win_hole, WT, "b"), "left"), "Shell_wall_left", "b", ["wall", "wall_trim"])
    add(_place_wall(_wall_with_hole("front", _wall_frame("front"), door_hole, DOOR_DEPTH, "b", back=True), "front"), "Shell_wall_front", "b", ["wall", "wall_trim"])
    add(_place_wall(_wall_with_hole("right", _wall_frame("right"), None, 0, "b"), "right"), "Shell_wall_right", "b", ["wall", "wall_trim"])
    # skirting
    add(_skirting("back"), "Shell_skirt_back", "a", ["wall_trim"], texel=0.5)
    add(_skirting("left"), "Shell_skirt_left", "b", ["wall_trim"], texel=0.4)
    add(_skirting("right"), "Shell_skirt_right", "b", ["wall_trim"], texel=0.4)
    add(_skirting("front", gaps=[(door_hole[0] - 0.0, door_hole[1] + 0.0)]), "Shell_skirt_front", "b", ["wall_trim"], texel=0.4)
    _shell_occluders()
    return parts


def in_room(p, tol=1e-4):
    """glTF point inside the room's air: the box, the window opening tunnel or the door recess."""
    x, y, z = p
    if X0 - tol < x < X1 + tol and Y0 - tol < y < Y1 + tol and Z0 - tol < z < Z1 + tol:
        return True
    if X0 - WT - 0.05 < x <= X0 + tol and WIN["y"][0] - tol < y < WIN["y"][1] + tol and WIN["z"][0] - tol < z < WIN["z"][1] + tol:
        return True
    if Z1 - tol <= z < Z1 + DOOR_DEPTH + tol and DOOR["x"][0] - tol < x < DOOR["x"][1] + tol and Y0 - tol < y < DOOR["y"][1] + tol:
        return True
    return False


def _orient_into_room(ob, strict=False, eps=0.02):
    """Flip every face whose front side is not in the room's air; with strict, fail loudly
    if any face still does not face into the room."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    flipped, bad = 0, 0
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        front, back = in_room(to_gltf(c + n * eps)), in_room(to_gltf(c - n * eps))
        if not front and back:
            f.normal_flip()
            flipped += 1
        elif not front:
            bad += 1
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    if strict:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.normal_update()
        wrong = [f.index for f in bm.faces if not in_room(to_gltf(f.calc_center_median() + f.normal * eps))]
        bm.free()
        if wrong:
            raise RuntimeError("shell %s: %d faces do not face into the room (e.g. %s)" % (ob.name, len(wrong), wrong[:5]))
    log("%s: %d faces, %d flipped to face into the room" % (ob.name, len(ob.data.polygons), flipped))
    return flipped


def check_faces_into_walls(objs, eps=0.003):
    """Warn about faces of a zone that point out of the room (into a wall, the floor or the ceiling):
    they bake black and waste atlas space. Returns the count."""
    total, names = 0, {}
    for o in objs:
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        nm = mw.to_3x3().inverted_safe().transposed()
        for poly in o.data.polygons:
            c = mw @ poly.center
            n = (nm @ poly.normal).normalized()
            if not in_room(to_gltf(c + n * eps)) and in_room(to_gltf(c - n * eps)):
                total += 1
                k = o.name.split(".")[0]
                names[k] = names.get(k, 0) + 1
    if total:
        log("WARNING: %d faces point into a wall/floor/ceiling (they bake black; delete or flip them): %s" % (total, ", ".join("%s %d" % kv for kv in sorted(names.items(), key=lambda kv: -kv[1])[:12])))
    return total


def _shell_occluders():
    """Exterior planes one wall thickness outside: the room is light-tight except the window."""
    m = _proxy_material()
    e = WT + 0.002
    pad = 0.4

    def plane(name, pts, hole=None):
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in pts]
        bm.faces.new(vs)
        if hole is not None:
            hv = [bm.verts.new(p) for p in hole]
            hf = bm.faces.new(hv)
            bmesh.ops.delete(bm, geom=[hf], context="FACES_ONLY")
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(m)
        ob["proxy"] = True
        return ob
    plane("Occ_floor", [G(x, Y0 - e, z) for x, z in ((X0 - pad, Z0 - pad), (X1 + pad, Z0 - pad), (X1 + pad, Z1 + pad), (X0 - pad, Z1 + pad))])
    plane("Occ_ceiling", [G(x, Y1 + e, z) for x, z in ((X0 - pad, Z0 - pad), (X1 + pad, Z0 - pad), (X1 + pad, Z1 + pad), (X0 - pad, Z1 + pad))])
    plane("Occ_back", [G(x, y, Z0 - e) for x, y in ((X0 - pad, Y0 - pad), (X1 + pad, Y0 - pad), (X1 + pad, Y1 + pad), (X0 - pad, Y1 + pad))])
    plane("Occ_front", [G(x, y, Z1 + e) for x, y in ((X0 - pad, Y0 - pad), (X1 + pad, Y0 - pad), (X1 + pad, Y1 + pad), (X0 - pad, Y1 + pad))])
    plane("Occ_right", [G(X1 + e, y, z) for z, y in ((Z0 - pad, Y0 - pad), (Z1 + pad, Y0 - pad), (Z1 + pad, Y1 + pad), (Z0 - pad, Y1 + pad))])
    # left: four strips around the window opening
    xl = X0 - e
    wz0, wz1 = WIN["z"]
    wy0, wy1 = WIN["y"]
    plane("Occ_left_a", [G(xl, y, z) for z, y in ((Z0 - pad, Y0 - pad), (wz0, Y0 - pad), (wz0, Y1 + pad), (Z0 - pad, Y1 + pad))])
    plane("Occ_left_b", [G(xl, y, z) for z, y in ((wz1, Y0 - pad), (Z1 + pad, Y0 - pad), (Z1 + pad, Y1 + pad), (wz1, Y1 + pad))])
    plane("Occ_left_c", [G(xl, y, z) for z, y in ((wz0, Y0 - pad), (wz1, Y0 - pad), (wz1, wy0), (wz0, wy0))])
    plane("Occ_left_d", [G(xl, y, z) for z, y in ((wz0, wy1), (wz1, wy1), (wz1, Y1 + pad), (wz0, Y1 + pad))])


# --------------------------------------------------------------------------- #
# Stand-ins for zones that are not being built: dark furniture-like blocks
# against their walls (x0, x1, y0, y1, z0, z1), glTF.
# --------------------------------------------------------------------------- #

STANDINS = {
    "desk": [(-1.1, 1.1, 0.0, 0.74, -2.70, -1.95), (-0.40, 0.40, 0.93, 1.40, -2.47, -2.40)],
    "right": [(3.10, 3.60, 0.0, 0.95, -2.20, 2.20)],
    "lounge": [(-2.92, -2.24, 0.0, 0.80, 1.08, 1.76), (-1.85, -1.05, 0.0, 0.45, 0.85, 1.65)],
    "window": [(-3.60, -3.22, 0.0, 0.88, -0.90, 1.30), (-3.60, -3.20, 0.0, 0.90, 1.50, 2.60)],
    "corner": [(-3.40, -1.70, 0.0, 0.90, -2.70, -2.30)],
}


def standins(zone):
    out = []
    for i, (x0, x1, y0, y1, z0, z1) in enumerate(STANDINS[zone]):
        ob = box("Standin_%s_%d" % (zone, i), _proxy_material(), (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), bev=0.01, segs=1)
        ob["proxy"] = True
        out.append(ob)
    return out


# --------------------------------------------------------------------------- #
# The light rig. Tuning lives here (scale factors on spec.LIGHTS), nowhere else.
# --------------------------------------------------------------------------- #

# Multipliers on the spec's watts/strengths, by state and light name.
RIG_SCALE = {
    "night": {"WordmarkLight": 0.5, "LoungeLamp": 0.45},
    "dawn": {"Sun": 3.3, "Sky": 2.0, "WordmarkLight": 0.5},
}
# Extra lights the spec does not list (a dim neutral fill so the darkest surfaces read).
RIG_EXTRA = {
    "night": [
        {"name": "NightFill", "type": "AREA", "at": (0.0, 2.96, -0.1), "size": (5.0, 3.6), "aim_dir": (0.0, -1.0, 0.0), "kelvin": 5600, "watts": 22},
    ],
    "dawn": [
        # sky fill: a soft panel just outside the window opening, facing in (the occluders let it in only through the window)
        {"name": "WindowSky", "type": "AREA", "at": (-3.95, 1.7, 0.2), "size": (2.2, 1.6), "aim_dir": (1.0, -0.12, 0.0), "color": "#dccbb6", "watts": 230},
    ],
}
# Per-light overrides of spec fields (direction of the LED strip: up the wall behind the monitors).
RIG_OVERRIDE = {
    "DeskLedStrip": {"aim_dir": (0.0, 0.72, -0.69)},
    "Sun": {"kelvin": 2950},
}
# Area light watts per unit of (emission strength x quad area); measured in Cycles.
AREA_W_PER_EMISSION = math.pi
# Grading: fixed per state, the same for every zone.
GRADE = {
    "night": {"view": "AgX", "look": "Medium High Contrast", "exposure": 3.5},
    "dawn": {"view": "AgX", "look": "Medium High Contrast", "exposure": 4.0},
}


def _light_colour(d):
    if "kelvin" in d:
        return kelvin(d["kelvin"])
    if "color" in d:
        return colour(d["color"])
    return (1.0, 1.0, 1.0)


def _aim_rotation(src_b, dst_b):
    return (dst_b - src_b).to_track_quat("-Z", "Y").to_euler()


def _pos(v):
    return anchor_at(v) if isinstance(v, str) else tuple(v)


def setup_lights(state):
    """Build the rig for `state` ('night' or 'dawn'): spec.LIGHTS plus an area light for every
    emissive quad that is not in the scene (a neighbour zone's screen or lightbox).
    Also sets the emission of the quads that are in the scene. Replaces a previous rig."""
    for ob in [o for o in bpy.data.objects if o.get("rig")]:
        bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    scale = RIG_SCALE.get(state, {})
    world_set = False
    made = []

    def add(name, ltype, loc_b, **kw):
        ld = bpy.data.lights.new("RIG_" + name, ltype)
        for k, v in kw.items():
            setattr(ld, k, v)
        ob = bpy.data.objects.new("RIG_" + name, ld)
        ob.location = loc_b
        scene.collection.objects.link(ob)
        ob["rig"] = True
        made.append(ob)
        return ob

    for d in list(LIGHTS[state]) + list(RIG_EXTRA.get(state, [])):
        d = dict(d, **RIG_OVERRIDE.get(d["name"], {}))
        k = scale.get(d["name"], 1.0)
        t = d["type"]
        col = _light_colour(d)
        if t == "WORLD":
            w = scene.world or bpy.data.worlds.new("World")
            scene.world = w
            w.use_nodes = True
            bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
            bg.inputs["Color"].default_value = (*col, 1.0)
            bg.inputs["Strength"].default_value = d["strength"] * k
            world_set = True
        elif t == "SUN":
            ob = add(d["name"], "SUN", G(0, 6, 0), energy=d["strength"] * k, color=col, angle=math.radians(d.get("angle_deg", 1.0)))
            ob.rotation_euler = G(*d["direction"]).to_track_quat("-Z", "Y").to_euler()
        elif t == "SPOT":
            at = G(*_pos(d["at"]))
            ob = add(d["name"], "SPOT", at, energy=d["watts"] * k, color=col, spot_size=math.radians(d.get("spot_deg", 60)),
                     spot_blend=d.get("blend", 0.35), shadow_soft_size=d.get("radius", 0.025))
            ob.rotation_euler = _aim_rotation(at, G(*_pos(d["aim"])))
        elif t == "POINT":
            add(d["name"], "POINT", G(*_pos(d["at"])), energy=d["watts"] * k, color=col, shadow_soft_size=d.get("radius", 0.05))
        elif t == "AREA":
            sx, sy = d["size"]
            ob = add(d["name"], "AREA", G(*_pos(d["at"])), energy=d["watts"] * k, color=col, shape="RECTANGLE", size=sx, size_y=sy)
            if "aim_dir" in d:  # glTF direction the light faces
                fwd = G(*d["aim_dir"])
                ob.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()
            else:  # faces its yaw direction (yaw 0 = +Z)
                ob.rotation_euler = (math.radians(90), 0.0, math.radians(d.get("yaw", 0.0)))
    if not world_set:
        w = scene.world or bpy.data.worlds.new("World")
        scene.world = w
        w.use_nodes = True
        next(n for n in w.node_tree.nodes if n.type == "BACKGROUND").inputs["Strength"].default_value = 0.0
    # emissive quads: those in the scene emit; those missing get an area light
    present = {o.name for o in bpy.data.objects if o.get("quad")}
    em = EMISSION[state]
    for name, q in QUADS.items():
        kind = q["kind"]
        if kind == "surface":
            continue
        if name in present:
            continue
        w, h = q["size"]
        ob = add("Q_" + name, "AREA", G(*q["at"]), energy=AREA_W_PER_EMISSION * em[kind] * w * h, color=colour("screen_glow"),
                 shape="RECTANGLE", size=w, size_y=h)
        ob.matrix_world = quad_matrix(q) @ Matrix.Rotation(math.radians(-90), 4, "X")
        ob.data.cycles.is_caustics_light = False
    for kind in ("screen", "lightbox", "ledbar"):
        m = bpy.data.materials.get("QB_" + kind)
        if m is not None:
            m.node_tree.nodes["EMIT"].inputs["Strength"].default_value = em[kind]
    return made


# --------------------------------------------------------------------------- #
# Scene reset, collecting a zone's objects
# --------------------------------------------------------------------------- #

def _reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    setup_gpu(scene)
    scene.unit_settings.system = "METRIC"
    scene.render.resolution_percentage = 100
    return scene


def _call_build(build, zone):
    before = set(bpy.data.objects)
    build()
    created = [o for o in bpy.data.objects if o not in before]
    parts, quads, anchors, proxies = [], [], [], []
    for o in created:
        if o.get("quad"):
            quads.append(o)
        elif o.get("anchor"):
            anchors.append(o)
        elif o.get("proxy") or o.get("shell") or o.get("rig"):
            proxies.append(o)
        elif o.type in ("LIGHT", "CAMERA", "LIGHT_PROBE", "SPEAKER"):
            log("WARNING: zone %s created a %s (%s); removed (the rig is common's)" % (zone, o.type, o.name))
            bpy.data.objects.remove(o, do_unlink=True)
        elif o.type == "EMPTY":
            pass
        elif o.type in ("MESH", "CURVE", "FONT", "SURFACE", "META", "CURVES"):
            parts.append(o)
    want_q = [n for n, q in QUADS.items() if q["zone"] == zone]
    want_a = [n for n, a in ANCHORS.items() if a["zone"] == zone]
    missing = [n for n in want_q if n not in {o.name for o in quads}] + [n for n in want_a if n not in {o.name for o in anchors}]
    if missing:
        log("WARNING: zone %s did not create: %s" % (zone, ", ".join(missing)))
    return parts, quads, anchors, proxies


def _prepare_parts(parts):
    """Make every part a plain mesh with applied transforms and a texel weight attribute."""
    keep = []
    for o in parts:
        if o.name not in bpy.data.objects:
            continue
        if o.type != "MESH" or o.modifiers:
            dg = bpy.context.evaluated_depsgraph_get()
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
            mats = [s.material for s in o.material_slots]
            mw = o.matrix_world.copy()
            tex = o.get("texel", 1.0)
            gl = o.get("glossy", False)
            name = o.name
            bpy.data.objects.remove(o, do_unlink=True)
            o = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(o)
            o.matrix_world = mw
            o["texel"] = tex
            o["glossy"] = gl
            if not me.materials:
                for m in mats:
                    me.materials.append(m)
        if o.data.users > 1:
            o.data = o.data.copy()
        mw = o.matrix_world.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        if not o.data.materials:
            o.data.materials.append(mat("furniture"))
        me = o.data
        if len(me.polygons) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        if "uvw" in me.attributes:
            me.attributes.remove(me.attributes["uvw"])
        attr = me.attributes.new("uvw", "FLOAT", "FACE")
        attr.data.foreach_set("value", [float(o.get("texel", 1.0))] * len(me.polygons))
        keep.append(o)
    return keep


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


# --------------------------------------------------------------------------- #
# Lightmap UVs: smart project, per-island texel density (x sqrt(texel weight),
# little for faces looking down), packed into one atlas with margin.
# --------------------------------------------------------------------------- #

def unwrap_parts(parts):
    """Smart-project every part on its own (fewer, cleaner islands than projecting the joined
    mesh, where round parts add projection axes that cut everything else). join() keeps the UVs."""
    t0 = time.time()
    for o in parts:
        me = o.data
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        me.uv_layers.new(name="UVMap")
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(52), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    log("smart-projected %d parts in %.1fs" % (len(parts), time.time() - t0))


def _shelf_pack(uvs, islands, lstart, ltot, pad=10.0 / ATLAS):
    """Pack the islands as rectangles, row by row, the long side of each lying flat, and as
    large as the atlas allows. For the shell: a handful of wall-sized rectangles, which
    Blender's packer was seen to leave lying on top of each other (every wall then bakes into
    the same texels). Returns the new UVs; the islands keep their relative sizes."""
    items = []
    for isl in islands:
        loops = np.concatenate([np.arange(lstart[q], lstart[q] + ltot[q]) for q in isl])
        pts = uvs[loops].astype(np.float64)
        size = pts.max(axis=0) - pts.min(axis=0)
        if size[1] > size[0]:  # turn it a quarter: (x, y) -> (y, -x)
            pts = np.stack([pts[:, 1], -pts[:, 0]], axis=1)
        lo = pts.min(axis=0)
        size = pts.max(axis=0) - lo
        items.append((loops, pts - lo, float(size[0]), float(size[1])))
    items.sort(key=lambda it: -it[3])

    def layout(k):
        x, y, row, out = pad, pad, 0.0, []
        for _, _, w, h in items:
            w, h = w * k, h * k
            if w + 2 * pad > 1.0:
                return None
            if x + w + pad > 1.0:
                x, y, row = pad, y + row + pad, 0.0
            out.append((x, y))
            x += w + pad
            row = max(row, h)
        return out if y + row + pad <= 1.0 else None

    lo_k, hi_k, best = 0.0, 1.0 / max(max(it[2] for it in items), 1e-9), None
    for _ in range(48):
        mid = (lo_k + hi_k) / 2
        got = layout(mid)
        if got is None:
            hi_k = mid
        else:
            lo_k, best = mid, (mid, got)
    if best is None:
        raise RuntimeError("shelf pack: the islands do not fit the atlas")
    k, places = best
    out = uvs.astype(np.float64).copy()
    for (loops, pts, _, _), (x, y) in zip(items, places):
        out[loops] = pts * k + (x, y)
    return out.astype(np.float32)


def _assert_no_overlap(name, uvs, islands, lstart, ltot):
    """Fail loudly when two islands' rectangles share atlas space (islands of at least 4 px)."""
    boxes = []
    for isl in islands:
        loops = np.concatenate([np.arange(lstart[q], lstart[q] + ltot[q]) for q in isl])
        lo, hi = uvs[loops].min(axis=0), uvs[loops].max(axis=0)
        if min(hi - lo) * ATLAS >= 4:
            boxes.append((lo, hi))
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (alo, ahi), (blo, bhi) = boxes[i], boxes[j]
            if alo[0] < bhi[0] and blo[0] < ahi[0] and alo[1] < bhi[1] and blo[1] < ahi[1]:
                raise RuntimeError("%s: lightmap islands %d and %d overlap" % (name, i, j))


def lightmap_uvs(ob):
    """Per-island texel density on the (already per-part unwrapped) joined mesh, then one pack."""
    me = ob.data
    t0 = time.time()
    if not me.uv_layers:
        unwrap_parts([ob])
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    nl = len(me.loops)
    uvs = np.zeros(nl * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(-1, 2)
    w = np.ones(len(me.polygons), np.float32)
    if "uvw" in me.attributes:
        me.attributes["uvw"].data.foreach_get("value", w)
    nz = np.zeros(len(me.polygons) * 3, np.float32)
    me.polygons.foreach_get("normal", nz)
    nz = nz.reshape(-1, 3)[:, 2]
    area = np.zeros(len(me.polygons), np.float32)
    me.polygons.foreach_get("area", area)
    lstart = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", lstart)
    ltot = np.zeros(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_total", ltot)
    islands = mesh_utils.mesh_linked_uv_islands(me)
    for isl in islands:
        isl = np.array(isl)
        a3 = float(area[isl].sum())
        if a3 <= 1e-12:
            continue
        loops = np.concatenate([np.arange(lstart[p], lstart[p] + ltot[p]) for p in isl])
        auv = 0.0
        for p in isl:
            pts = uvs[lstart[p]:lstart[p] + ltot[p]]
            x, y = pts[:, 0], pts[:, 1]
            auv += 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
        if auv <= 1e-12:
            continue
        ww = w[isl].copy()
        ww[nz[isl] < -0.7] *= 0.15  # faces looking down are rarely seen
        wi = float((ww * area[isl]).sum() / a3)
        s = math.sqrt(a3 / auv) * math.sqrt(max(wi, 0.01))
        c = uvs[loops].mean(axis=0)
        uvs[loops] = (uvs[loops] - c) * s + c
    # bring everything into the unit square before packing (CLOSEST_UDIM would otherwise pack
    # islands that lie far from tile 0 into other UDIM tiles, i.e. outside the atlas)
    lo = uvs.min(axis=0)
    span = float((uvs.max(axis=0) - lo).max())
    uvs = (uvs - lo) / max(span, 1e-9) * 0.98 + 0.01
    me.uv_layers.active.data.foreach_set("uv", uvs.ravel())
    me.update()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        bpy.ops.uv.select_all(action="SELECT")
    except Exception:
        pass
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True, merge_overlap=False,
                            margin_method="SCALED", margin=PACK_MARGIN, pin=False, shape_method="CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")
    uvs2 = np.zeros(nl * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uvs2)
    uvs2 = uvs2.reshape(-1, 2)
    if ob.name.startswith("Zone_shell"):
        # The shell is a few wall-sized rectangles; pack them ourselves (see _shelf_pack).
        uvs2 = _shelf_pack(uvs, islands, lstart, ltot)
        me.uv_layers.active.data.foreach_set("uv", uvs2.ravel())
        me.update()
        _assert_no_overlap(ob.name, uvs2, islands, lstart, ltot)
    if uvs2.min() < -1e-4 or uvs2.max() > 1 + 1e-4:
        raise RuntimeError("%s: lightmap UVs outside 0..1 after packing (%.3f..%.3f)" % (ob.name, uvs2.min(), uvs2.max()))
    # texel density report: px per metre for weight 1
    tot3 = float((area * w).sum())
    log("%s UVs: %d islands in %.1fs, uv range %.3f..%.3f / %.3f..%.3f" % (ob.name, len(islands), time.time() - t0, uvs2[:, 0].min(), uvs2[:, 0].max(), uvs2[:, 1].min(), uvs2[:, 1].max()))
    # density for weight-1 faces: sample one big face
    big = int(np.argmax(area * (w >= 0.99)))
    pts = uvs2[lstart[big]:lstart[big] + ltot[big]]
    x, y = pts[:, 0], pts[:, 1]
    auv = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    if area[big] > 0:
        dens = ATLAS * math.sqrt(auv / area[big] / max(w[big], 0.01)) if auv > 0 else 0
        log("  texel density (weight 1): %.0f px/m (%.1f mm per texel); weighted area %.1f m2" % (dens, 1000.0 / max(dens, 1), tot3))
    return hashlib.md5(uvs2.round(5).tobytes()).hexdigest()


# --------------------------------------------------------------------------- #
# Baking
# --------------------------------------------------------------------------- #

def _bake_image(name):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, ATLAS, ATLAS, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    return img


def _set_bake_target(ob, img):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("BAKE_TARGET")
        if n is None:
            n = nt.nodes.new("ShaderNodeTexImage")
            n.name = "BAKE_TARGET"
        n.image = img
        nt.nodes.active = n


def _do_bake(ob, img, btype, pass_filter=None, samples=64):
    scene = bpy.context.scene
    _set_bake_target(ob, img)
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    scene.cycles.samples = samples
    rb = scene.render.bake
    rb.margin = BAKE_MARGIN
    rb.margin_type = "EXTEND"
    rb.use_clear = True
    rb.target = "IMAGE_TEXTURES"
    t = time.time()
    kw = dict(type=btype, margin=BAKE_MARGIN, use_clear=True)
    if pass_filter:
        kw["pass_filter"] = pass_filter
    if btype == "NORMAL":
        kw["normal_space"] = "OBJECT"
    bpy.ops.object.bake(**kw)
    log("baked %-7s %-28s %-30s samples=%-5d %.1fs (%s)" % (btype, img.name, ",".join(sorted(pass_filter or [])), samples, time.time() - t, scene.cycles.device))


def _img_np(img):
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(img.size[1], img.size[0], 4)


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
    a = _img_np(img).copy()
    bpy.data.images.remove(img)
    return a


def denoise(arr, normal=None, albedo=None):
    """OIDN through a throw-away compositor scene (Cycles does not denoise bakes)."""
    h, w = arr.shape[:2]
    sc = bpy.data.scenes.new("DenoiseScene")
    sc.render.engine = "CYCLES"
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.resolution_percentage = 100
    sc.render.use_compositing = True
    tree = bpy.data.node_groups.new("DN", "CompositorNodeTree")
    sc.compositing_node_group = tree
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    imgs = []

    def img_node(a, nm):
        im = bpy.data.images.new(nm, w, h, alpha=True, float_buffer=True)
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
    for k, v in (("Quality", "High"), ("Prefilter", "Accurate")):
        try:
            dn.inputs[k].default_value = v
        except Exception:
            pass
    out = tree.nodes.new("NodeGroupOutput")
    tree.links.new(dn.outputs[0], out.inputs[0])
    bpy.ops.render.render(scene=sc.name)
    rr = bpy.data.images["Render Result"]
    sc.render.image_settings.file_format = "OPEN_EXR"
    sc.render.image_settings.color_depth = "32"
    sc.render.image_settings.color_mode = "RGBA"
    tmp = CACHE + "/_dn_tmp_%d.exr" % os.getpid()
    rr.save_render(tmp, scene=sc)
    res = load_exr(tmp)
    os.remove(tmp)
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.scenes.remove(sc)
    bpy.data.node_groups.remove(tree)
    return res


def set_view(scene, state):
    g = GRADE[state]
    vs = scene.view_settings
    vs.view_transform = g["view"]
    for cand in (g["look"], "%s - %s" % (g["view"], g["look"]), "None"):
        try:
            vs.look = cand
            break
        except TypeError:
            continue
    vs.exposure = g["exposure"]
    vs.gamma = 1.0


def write_png(arr, path, state):
    """Float linear atlas -> 8-bit sRGB PNG through the state's AgX grade."""
    scene = bpy.context.scene
    name = "grade_tmp"
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True)
    img.colorspace_settings.name = "Linear Rec.709"
    a = arr.copy()
    a[..., 3] = 1.0
    img.pixels.foreach_set(a.astype(np.float32).ravel())
    set_view(scene, state)
    st = scene.render.image_settings
    st.file_format = "PNG"
    st.color_mode = "RGB"
    st.color_depth = "8"
    st.compression = 90
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    log("wrote %s (%s / %s / exposure %+.2f)" % (os.path.basename(path), scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure))


def _glossy_isolate(ob, on):
    """For the glossy pass: silence specular/metal on every non-glossy material of `ob`."""
    for slot in ob.material_slots:
        m = slot.material
        if m is None or m.get("glossy"):
            continue
        try:
            p = principled(m)
        except StopIteration:
            continue
        if on:
            m["_save"] = [p.inputs["Specular IOR Level"].default_value, p.inputs["Metallic"].default_value, p.inputs["Coat Weight"].default_value]
            p.inputs["Specular IOR Level"].default_value = 0.0
            p.inputs["Metallic"].default_value = 0.0
            p.inputs["Coat Weight"].default_value = 0.0
        elif "_save" in m:
            s = m["_save"]
            p.inputs["Specular IOR Level"].default_value = s[0]
            p.inputs["Metallic"].default_value = s[1]
            p.inputs["Coat Weight"].default_value = s[2]
            del m["_save"]


def _cycles_bake_settings(scene):
    c = scene.cycles
    c.use_denoising = False
    c.max_bounces = 8
    c.diffuse_bounces = 5
    c.glossy_bounces = 2
    c.transmission_bounces = 2
    c.transparent_max_bounces = 8
    c.sample_clamp_direct = 0.0
    c.sample_clamp_indirect = 6.0
    c.use_adaptive_sampling = False
    try:
        c.use_light_tree = True
    except Exception:
        pass


def bake_atlas(ob, atlas, states, samples, uvhash):
    """Bake one joined mesh into out/<atlas>_<state>.png for each state."""
    scene = bpy.context.scene
    _cycles_bake_settings(scene)
    has_gloss = any(s.material is not None and s.material.get("glossy") for s in ob.material_slots)
    hp = CACHE + "/%s_uvhash.txt" % atlas
    cache_ok = REGRADE and os.path.exists(hp) and open(hp).read().strip() == uvhash
    if REGRADE and not cache_ok:
        log("WARNING: --regrade: no cache for this geometry, baking")
    ck = lambda tag: CACHE + "/%s_%s.exr" % (atlas, tag)  # noqa: E731
    if cache_ok:
        alb, nrm = load_exr(ck("albedo")), load_exr(ck("normal"))
    else:
        setup_lights(states[0])
        im = _bake_image(atlas + "_albedo")
        _do_bake(ob, im, "DIFFUSE", {"COLOR"}, samples=16)
        alb = _img_np(im).copy()
        im2 = _bake_image(atlas + "_normal")
        _do_bake(ob, im2, "NORMAL", None, samples=16)
        nrm = _img_np(im2).copy()
        nrm[..., :3] = nrm[..., :3] * 2 - 1
        save_exr(alb, ck("albedo"))
        save_exr(nrm, ck("normal"))
    results = {}
    for state in states:
        if cache_ok and os.path.exists(ck(state + "_irr")):
            irr, emi = load_exr(ck(state + "_irr")), load_exr(ck(state + "_emit"))
            glo = load_exr(ck(state + "_gloss")) if has_gloss and os.path.exists(ck(state + "_gloss")) else None
        else:
            setup_lights(state)
            im = _bake_image("%s_%s_irr" % (atlas, state))
            _do_bake(ob, im, "DIFFUSE", {"DIRECT", "INDIRECT"}, samples=samples)
            t = time.time()
            irr = denoise(_img_np(im), normal=nrm, albedo=np.ones_like(nrm))
            log("denoised %s %s in %.1fs" % (atlas, state, time.time() - t))
            im3 = _bake_image("%s_%s_emit" % (atlas, state))
            _do_bake(ob, im3, "EMIT", None, samples=4)
            emi = _img_np(im3).copy()
            glo = None
            if has_gloss:
                _glossy_isolate(ob, True)
                im4 = _bake_image("%s_%s_gloss" % (atlas, state))
                _do_bake(ob, im4, "GLOSSY", {"DIRECT", "INDIRECT", "COLOR"}, samples=samples)
                _glossy_isolate(ob, False)
                glo = denoise(_img_np(im4), normal=nrm)
                save_exr(glo, ck(state + "_gloss"))
            save_exr(irr, ck(state + "_irr"))
            save_exr(emi, ck(state + "_emit"))
        col = alb[..., :3] * np.maximum(irr[..., :3], 0) + emi[..., :3]
        if glo is not None:
            col = col + np.maximum(glo[..., :3], 0)
        outa = np.ones((ATLAS, ATLAS, 4), np.float32)
        outa[..., :3] = col
        path = OUT + "/%s_%s.png" % (atlas, state)
        write_png(outa, path, state)
        lum = 0.2126 * col[..., 0] + 0.7152 * col[..., 1] + 0.0722 * col[..., 2]
        cov = alb[..., :3].max(axis=2) > 1e-4
        if cov.any():
            p = np.percentile(lum[cov], [1, 5, 50, 95, 99.5])
            log("  %s %s linear luminance p1 %.4f p5 %.4f p50 %.4f p95 %.4f p99.5 %.4f" % (atlas, state, *p))
        results[state] = path
    open(hp, "w").write(uvhash)
    return results


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #

def _atlas_material(atlas, png):
    name = "Bake_" + atlas
    if name in bpy.data.materials:
        bpy.data.materials.remove(bpy.data.materials[name])
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    p = principled(m)
    p.inputs["Roughness"].default_value = 1.0
    p.inputs["Metallic"].default_value = 0.0
    p.inputs["Specular IOR Level"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png, check_existing=False)
    tex.image.colorspace_settings.name = "sRGB"
    tex.image.name = atlas + "_night"
    nt.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    return m


def export_glb(path, meshes, quads, anchors):
    """meshes: {atlas: object}. Writes the GLB with the meshes (night atlas), quads and anchors."""
    for atlas, ob in meshes.items():
        m = _atlas_material(atlas, OUT + "/%s_night.png" % atlas)
        ob.data.materials.clear()
        ob.data.materials.append(m)
        for an in [a.name for a in ob.data.attributes if a.name in ("uvw",)]:
            ob.data.attributes.remove(ob.data.attributes[an])
    for q in quads:
        q.hide_render = False
        q.data.materials.clear()
        q.data.materials.append(_quad_export_material(q["quad"]))
    bpy.ops.object.select_all(action="DESELECT")
    for o in list(meshes.values()) + list(quads) + list(anchors):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_animations=False, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT", export_image_format="AUTO", export_extras=False)
    log("exported %s %.2f MB" % (path, os.path.getsize(path) / 1e6))


# --------------------------------------------------------------------------- #
# Previews: the GLBs as the site shows them (unlit, atlas as emission)
# --------------------------------------------------------------------------- #

def look_at_cam(name, pos_g, target_g, fov_deg):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = math.radians(fov_deg)
    cd.clip_start = 0.02
    cd.clip_end = 50
    cam = bpy.data.objects.new(name, cd)
    cam.location = G(*pos_g)
    cam.rotation_euler = (G(*target_g) - G(*pos_g)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(cam)
    return cam


def _base(name):
    return name.split(".")[0]


def _emission_mat(name, tex_img=None, rgb=None, alpha=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em.inputs["Strength"].default_value = 1.0
    if tex_img is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "TEX"
        tex.image = tex_img
        tex.interpolation = "Linear"
        nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (*rgb, 1.0)
    if alpha is not None:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def _load_img(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "sRGB"
    return img


def report_glb(path):
    """Import a GLB into the current scene, log nodes, triangles, quad transforms. Returns objects."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    tri = 0
    for o in objs:
        if o.type == "MESH":
            tri += tri_count(o)
    log("GLB %s: %d triangles, nodes: %s" % (os.path.basename(path), tri, ", ".join(sorted(o.name for o in objs))))
    for o in objs:
        b = _base(o.name)
        if b in QUADS and o.type == "MESH":
            q = QUADS[b]
            mw = o.matrix_world
            pts = [mw @ v.co for v in o.data.vertices]
            ws = (pts[1] - pts[0]).length if len(pts) == 4 else 0
            hs = (pts[3] - pts[0]).length if len(pts) == 4 else 0
            ctr = sum(pts, Vector()) / max(len(pts), 1)
            n = (mw.to_3x3() @ o.data.polygons[0].normal).normalized()
            eul = mw.to_euler("XYZ")
            err = (Vector(to_gltf(ctr)) - Vector(q["at"])).length
            log("  quad %-12s centre (%.4f, %.4f, %.4f) size %.4f x %.4f normal (%.3f, %.3f, %.3f) yaw %.2f lean %.2f | spec at %s size (%.4f, %.4f) yaw %s lean %s | err %.5f m"
                % (b, *to_gltf(ctr), ws, hs, *to_gltf(n), math.degrees(eul.z), -math.degrees(eul.x), q["at"], q["size"][0], q["size"][1], q.get("yaw", 0), q.get("lean", 0), err))
        elif o.type == "EMPTY":
            log("  anchor %-12s at (%.4f, %.4f, %.4f) yaw %.1f" % (o.name, *to_gltf(o.matrix_world.translation), math.degrees(o.matrix_world.to_euler().z)))
    return objs


def _probe_preview(path):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color"
    a = _img_np(img)[..., :3] * 255
    bpy.data.images.remove(img)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    p = np.percentile(lum, [1, 5, 25, 50, 95, 99.9])
    clip = float((a.max(axis=2) >= 254.5).mean() * 100)
    log("  %s sRGB luma p1 %.0f p5 %.0f p25 %.0f p50 %.0f p95 %.0f p99.9 %.0f, clipped %.2f%%" % (os.path.basename(path), *p, clip))


WORLD_PREVIEW = {"night": "#06080d", "dawn": "#b9c4cf"}


def render_previews(tag, cameras, glbs, states=None, report_first=True):
    """Fresh scene: import the GLBs, emission-only materials with their atlases, render
    out/preview_<tag>_<state>_<camera>.png at 1600x1000 for each state."""
    states = states or STATES
    scene = _reset_scene()
    objs = []
    for i, g in enumerate(glbs):
        if os.path.exists(g):
            objs += report_glb(g) if (report_first or i == 0) else []
    meshes = [o for o in objs if o.type == "MESH"]
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    scene.world = w
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
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
    scene.render.image_settings.color_depth = "8"
    glow = colour("screen_glow")
    for state in states:
        bg.inputs["Color"].default_value = (*hexcol(WORLD_PREVIEW[state]), 1.0)
        for o in meshes:
            b = _base(o.name)
            o.data.materials.clear()
            if b.startswith("Zone_"):
                atlas = b[5:]
                png = OUT + "/%s_%s.png" % (atlas, state)
                if not os.path.exists(png):
                    png = OUT + "/%s_night.png" % atlas
                o.data.materials.append(_emission_mat("prev_%s_%s" % (atlas, state), tex_img=_load_img(png)))
            elif b in QUADS:
                kind = QUADS[b]["kind"]
                if kind in ("screen", "lightbox"):
                    o.data.materials.append(_emission_mat("prev_q_" + kind, rgb=glow))
                elif kind == "ledbar":
                    o.data.materials.append(_emission_mat("prev_q_ledbar", rgb=hexcol("#2c2f36")))
                else:
                    o.data.materials.append(_emission_mat("prev_q_surface", rgb=(0, 0, 0), alpha=0.0))
            else:
                o.data.materials.append(_emission_mat("prev_other", rgb=(0.02, 0.02, 0.02)))
        for cname in cameras:
            pos, tgt, fov = CAMERAS[cname]
            cam = look_at_cam("cam_%s_%s" % (cname, state), pos, tgt, fov)
            scene.camera = cam
            scene.render.filepath = OUT + "/preview_%s_%s_%s.png" % (tag, state, cname)
            bpy.ops.render.render(write_still=True)
            _probe_preview(scene.render.filepath)


def _other_glbs(exclude=()):
    out = []
    for name in ["shell"] + list(ZONES):
        if name in exclude:
            continue
        p = OUT + "/%s.glb" % name
        if os.path.exists(p):
            out.append(p)
    return out


# --------------------------------------------------------------------------- #
# Lit (live) renders for --skip-bake
# --------------------------------------------------------------------------- #

def lit_renders(tag, cameras, states):
    scene = bpy.context.scene
    scene.render.resolution_x = 960
    scene.render.resolution_y = 600
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.sample_clamp_indirect = 6.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    for state in states:
        setup_lights(state)
        set_view(scene, state)
        for cname in cameras:
            pos, tgt, fov = CAMERAS[cname]
            cam = look_at_cam("lit_%s_%s" % (cname, state), pos, tgt, fov)
            scene.camera = cam
            scene.render.filepath = OUT + "/lit_%s_%s_%s.png" % (tag, state, cname)
            bpy.ops.render.render(write_still=True)
            log("lit render", scene.render.filepath)


# --------------------------------------------------------------------------- #
# The runs
# --------------------------------------------------------------------------- #

def _populate_room(zone_being_built, build_others=False):
    """Shell, mascot proxy, and the other zones as stand-ins (or their real build())."""
    shell = build_shell()
    mascot_proxy()
    others = {}
    for z in ZONES:
        if z == zone_being_built:
            continue
        if build_others:
            ok = _try_build_zone(z)
            others[z] = ok
            if not ok:
                standins(z)
        else:
            standins(z)
    return shell, others


def _try_build_zone(z):
    path = ROOT + "/zone_%s.py" % z
    if not os.path.exists(path):
        log("zone %s: no script, stand-in" % z)
        return False
    snap = set(bpy.data.objects)
    try:
        sp = importlib.util.spec_from_file_location("zone_%s_mod" % z, path)
        mod = importlib.util.module_from_spec(sp)
        sp.loader.exec_module(mod)
        mod.build()
        log("zone %s: built from its script (%d objects)" % (z, len(set(bpy.data.objects) - snap)))
        return True
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        log("zone %s: build() failed (%s), stand-in" % (z, e))
        for o in [o for o in bpy.data.objects if o not in snap]:
            bpy.data.objects.remove(o, do_unlink=True)
        return False


def run_zone(name, build, cameras=None, samples=None, texel_scale=None):
    """Shell + stand-ins + rig, build(), join into Zone_<name>, one 2048 atlas, bake night and
    dawn, write out/<name>_<state>.png, export out/<name>.glb, render the previews."""
    global _TAG
    _TAG = name
    cams = cameras or ZONE_CAMERAS.get(name, ["finale"])
    cams = _arg("--cameras", ",".join(cams)).split(",")
    samples = int(_arg("--samples", samples or SAMPLES))
    glb = OUT + "/%s.glb" % name
    if PREVIEWS_ONLY:
        render_previews(name, cams, [glb] + _other_glbs(exclude=(name,)))
        log("ALL DONE (previews only)")
        return
    _reset_scene()
    _populate_room(name)
    parts, quads, anchors, _ = _call_build(build, name)
    log("build(): %d parts, quads %s, anchors %s" % (len(parts), [q.name for q in quads], [a.name for a in anchors]))
    if SKIP_BAKE:
        lit_renders(name, cams, STATES)
        log("ALL DONE (skip-bake)")
        return
    parts = _prepare_parts(parts)
    if not parts:
        raise RuntimeError("zone %s built no geometry" % name)
    check_faces_into_walls(parts)
    counts = {}
    for o in parts:
        o.data.calc_loop_triangles()
        k = o.name.split(".")[0].rstrip("0123456789_")
        counts[k] = counts.get(k, 0) + len(o.data.loop_triangles)
    log("triangles by part: " + ", ".join("%s %d" % kv for kv in sorted(counts.items(), key=lambda kv: -kv[1])[:16]))
    unwrap_parts(parts)
    zone = join(parts, "Zone_" + name)
    nt = tri_count(zone)
    budget = ZONES.get(name, {}).get("triangles", 0)
    log("Zone_%s: %d triangles (budget %d)%s, %d materials" % (name, nt, budget, "  OVER BUDGET" if budget and nt > budget else "", len(zone.data.materials)))
    uvhash = lightmap_uvs(zone)
    bake_atlas(zone, name, STATES, samples, uvhash)
    export_glb(glb, {name: zone}, quads, anchors)
    if not NO_PREVIEWS:
        render_previews(name, cams, [glb] + _other_glbs(exclude=(name,)))
    log("ALL DONE")


def run_shell(cameras=None, samples=None):
    """The shell, baked with every zone's build() standing in it (stand-ins for missing or
    failing zones): out/shell_a_*.png, out/shell_b_*.png, out/shell.glb, then the full-room
    previews out/preview_room_<state>_<camera>.png from every camera."""
    global _TAG
    _TAG = "shell"
    cams = cameras or list(CAMERAS)
    cams = _arg("--cameras", ",".join(cams)).split(",")
    samples = int(_arg("--samples", samples or SAMPLES))
    glb = OUT + "/shell.glb"
    if PREVIEWS_ONLY:
        render_previews("room", cams, [glb] + _other_glbs(exclude=("shell",)))
        log("ALL DONE (previews only)")
        return
    _reset_scene()
    build_others = "--standins" not in ARGS
    shell, others = _populate_room(None, build_others=build_others)
    log("zones in the shell bake: %s" % others)
    if SKIP_BAKE:
        lit_renders("room", cams, STATES)
        return
    meshes = {}
    for g in ("a", "b"):
        objs = _prepare_parts(shell[g])
        unwrap_parts(objs)
        meshes["shell_" + g] = join(objs, "Zone_shell_" + g)
        log("Zone_shell_%s: %d triangles" % (g, tri_count(meshes["shell_" + g])))
    for atlas, ob in meshes.items():
        uvhash = lightmap_uvs(ob)
        bake_atlas(ob, atlas, STATES, samples, uvhash)
    export_glb(glb, meshes, [], [])
    if not NO_PREVIEWS:
        render_previews("room", cams, [glb] + _other_glbs(exclude=("shell",)))
    log("ALL DONE")


