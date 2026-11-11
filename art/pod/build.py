"""Agent pod: build, light-bake, export and preview a small floating workstation.

Run headless:
  "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup \
      --python C:/demo/web-3d/art/pod/build.py -- [options]

Options:
  --samples N    bake samples (default 4096)
  --skip-bake    reuse work/pod_atlas_linear.exr (regrade/re-export without rebaking)
  --no-denoise   skip the OIDN pass on the baked atlas
  --uvdebug      stop after unwrapping (writes work/uv_layout.png)
  --closeups     also render inspection shots into work/ (agent, back, underside)

Outputs (C:/demo/web-3d/art/pod/out/):
  pod.glb, pod_atlas.png, preview_front.png, preview_left.png, preview_top.png, preview_far.png
Work files (C:/demo/web-3d/art/pod/work/):
  pod_atlas_linear.exr (raw float bake), uv_layout.png (island check: grey island, red overlap)

Coordinates: geometry is authored directly in Blender space (Z up). The helpers g2b/b2g convert
from/to glTF space (X right, Y up, Z toward the viewer): Blender (x, y, z) = glTF (x, -z, y).
"""

import math
import os
import sys
import time

import bmesh
import bpy
from bpy_extras import bmesh_utils
from mathutils import Matrix, Vector

ROOT = "C:/demo/web-3d/art/pod"
OUT = ROOT + "/out"
WORK = ROOT + "/work"
GLB = OUT + "/pod.glb"
ATLAS_PNG = OUT + "/pod_atlas.png"
ATLAS_EXR = WORK + "/pod_atlas_linear.exr"
ATLAS_RES = 1024

# ---------------------------------------------------------------- arguments
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_value(name, default):
    if name in ARGV:
        return type(default)(ARGV[ARGV.index(name) + 1])
    return default


BAKE_SAMPLES = arg_value("--samples", 4096)
SKIP_BAKE = "--skip-bake" in ARGV

# ---------------------------------------------------------------- look settings
VIEW_TRANSFORM = "AgX"
LOOK = "AgX - Medium High Contrast"
EXPOSURE = 0.3
GAMMA = 1.0

# ---------------------------------------------------------------- lighting settings
LANTERN_POWER_W = 60.0       # point light inside the bulb
LANTERN_TEMP_K = 2700.0
LANTERN_RADIUS = 0.03
BULB_EMISSION = 6.0          # strength of the glass emission (also a small mesh light)
SCREEN_BAKE_STRENGTH = 16.0  # screen emission strength used only while baking
WORLD_AMBIENT = 0.065        # very weak neutral ambient (linear)

os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)


def log(*a):
    print("[pod]", *a, flush=True)


# ---------------------------------------------------------------- coordinate helpers
def g2b(x, y, z):
    return Vector((x, -z, y))


def b2g(v):
    return Vector((v[0], v[2], -v[1]))


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h, a=1.0):
    h = h.lstrip("#")
    return (srgb_to_lin(int(h[0:2], 16) / 255), srgb_to_lin(int(h[2:4], 16) / 255),
            srgb_to_lin(int(h[4:6], 16) / 255), a)


# ---------------------------------------------------------------- GPU
def setup_gpu(scene):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    used = []
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
        if d.use:
            used.append(d.name)
    scene.cycles.device = "GPU"
    log("cycles compute_device_type:", prefs.compute_device_type, "| scene.cycles.device:",
        scene.cycles.device, "| enabled devices:", used)
    if not used:
        raise RuntimeError("No OPTIX GPU device available")


# ---------------------------------------------------------------- geometry primitives
# Every primitive returns (verts, faces) in local space; part() places it.

def rrect_ring(hx, hy, r, cs, z):
    r = max(min(r, hx - 1e-4, hy - 1e-4), 0.002)
    pts = []
    for cx, cy, a0 in ((hx - r, hy - r, 0), (-(hx - r), hy - r, 90),
                       (-(hx - r), -(hy - r), 180), (hx - r, -(hy - r), 270)):
        for k in range(cs + 1):
            a = math.radians(a0 + 90.0 * k / cs)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
    return pts


def loft(rings, cap_first=True, cap_last=True):
    verts, faces, idx = [], [], []
    for ring in rings:
        idx.append(list(range(len(verts), len(verts) + len(ring))))
        verts.extend(ring)
    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = idx[i], idx[i + 1]
        for k in range(n):
            faces.append((a[k], b[k], b[(k + 1) % n], a[(k + 1) % n]))
    if cap_first:
        faces.append(tuple(idx[0]))
    if cap_last:
        faces.append(tuple(reversed(idx[-1])))
    return verts, faces


def rbox(sx, sy, sz, rc, bev, cs=3, bs=2):
    """Box with rounded corners in XY (radius rc) and a rounded bevel (bev) on the Z edges."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    rings = []
    for k in range(bs + 1):
        a = (math.pi / 2) * k / bs
        d, z = bev * (1 - math.sin(a)), hz - bev * (1 - math.cos(a))
        rings.append(rrect_ring(hx - d, hy - d, rc - d, cs, z))
    for k in range(bs + 1):
        a = (math.pi / 2) * k / bs
        d, z = bev * (1 - math.cos(a)), -hz + bev * (1 - math.sin(a))
        rings.append(rrect_ring(hx - d, hy - d, rc - d, cs, z))
    return loft(rings)


def box(sx, sy, sz, taper=0.0):
    """Plain box; taper shrinks the top face on each side (keycaps), so the top and the
    slanted sides unwrap as one island."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    tx, ty = hx - taper, hy - taper
    v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
         (-tx, -ty, hz), (tx, -ty, hz), (tx, ty, hz), (-tx, ty, hz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, f


def revolve(profile, n):
    """profile: list of (r, z) from bottom to top; r == 0 makes a pole."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r < 1e-6:
            verts.append((0.0, 0.0, z))
            rings.append([len(verts) - 1])
        else:
            ids = []
            for k in range(n):
                a = 2 * math.pi * k / n
                verts.append((r * math.cos(a), r * math.sin(a), z))
                ids.append(len(verts) - 1)
            rings.append(ids)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for k in range(n):
                faces.append((a[0], b[(k + 1) % n], b[k]))
        elif len(b) == 1:
            for k in range(n):
                faces.append((a[k], a[(k + 1) % n], b[0]))
        else:
            for k in range(n):
                faces.append((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    return verts, faces


def ellipsoid(rx, ry, rz, n=12, rings=8):
    prof = []
    for i in range(rings + 1):
        th = -math.pi / 2 + math.pi * i / rings
        prof.append((math.cos(th), math.sin(th)))
    prof = [(0.0 if i in (0, rings) else max(r, 0.0), z) for i, (r, z) in enumerate(prof)]
    v, f = revolve(prof, n)
    return [(x * rx, y * ry, z * rz) for x, y, z in v], f


def cylinder(r, h, n=8, z0=0.0):
    return revolve([(0, z0), (r, z0), (r, z0 + h), (0, z0 + h)], n)


def tube(points, radius, n=6, cap=True):
    pts = [Vector(p) for p in points]
    m = len(pts)
    tangents = []
    for i in range(m):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == m - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = (ref - tangents[0] * ref.dot(tangents[0])).normalized()
    rings = []
    for i in range(m):
        t = tangents[i]
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bi = t.cross(nrm)
        rr = radius[i] if isinstance(radius, (list, tuple)) else radius
        rings.append([tuple(pts[i] + rr * (math.cos(2 * math.pi * k / n) * nrm +
                                            math.sin(2 * math.pi * k / n) * bi)) for k in range(n)])
    return loft(rings, cap, cap)


# ---------------------------------------------------------------- part assembly
class Part:
    """A piece of geometry in world space. rest() removes the resting (lowest, horizontal)
    faces that can never be seen, so they cost neither triangles nor atlas space."""

    def __init__(self, verts, faces, mat, matrix=None):
        matrix = Matrix.Identity(4) if matrix is None else matrix
        self.verts = [matrix @ Vector(v) for v in verts]
        self.faces = faces
        self.mat = mat

    def rest(self):
        """Drops the resting bottom faces; returns self."""
        zmin = min(v.z for v in self.verts)
        keep = []
        for f in self.faces:
            pts = [self.verts[i] for i in f]
            n = Vector((0, 0, 0))
            for a, b in zip(pts, pts[1:] + pts[:1], strict=True):
                n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x),
                             (a.x - b.x) * (a.y + b.y)))
            flat = n.length > 0 and abs(n.normalized().z) > 0.95
            if flat and max(p.z for p in pts) < zmin + 1e-4:
                continue
            keep.append(f)
        self.faces = keep
        return self


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 4, axis)


def build_object(name, parts, smooth_angle=40.0, origin=None):
    origin = Vector((0, 0, 0)) if origin is None else origin
    mats = []
    verts, faces, fmat = [], [], []
    for p in parts:
        if p.mat not in mats:
            mats.append(p.mat)
        off = len(verts)
        verts.extend([tuple(v - origin) for v in p.verts])
        for f in p.faces:
            faces.append(tuple(i + off for i in f))
            fmat.append(mats.index(p.mat))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for i, poly in enumerate(me.polygons):
        poly.material_index = fmat[i] if i < len(fmat) else 0
    for m in mats:
        me.materials.append(m)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    ob = bpy.data.objects.new(name, me)
    ob.location = origin
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- bake materials
ATLAS = None  # float image, created in main()


def principled(name, base_rgba, rough=1.0, with_atlas=True):
    m = bpy.data.materials.new(name)
    nt = m.node_tree if m.node_tree else None
    if nt is None:
        m.use_nodes = True
        nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = base_rgba
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    if with_atlas:
        add_atlas_node(m)
    return m


def add_atlas_node(m):
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = ATLAS
    tex.location = (-600, 400)
    nt.nodes.active = tex
    for n in nt.nodes:
        n.select = n == tex


def gradient_material(name, top_hex, bottom_hex, z_bottom, z_top, floor_rgb=None):
    """Albedo that falls off with height (used for the slab sides and underside).

    floor_rgb: linear emission that fades in toward z_bottom, so the outer underside settles
    exactly on the page colour after the view transform instead of going pitch black."""
    m = principled(name, hex_lin(top_hex), with_atlas=False)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = z_bottom
    mr.inputs["From Max"].default_value = z_top
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].color = hex_lin(bottom_hex)
    ramp.color_ramp.elements[1].color = hex_lin(top_hex)
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if floor_rgb is not None:
        eramp = nt.nodes.new("ShaderNodeValToRGB")
        eramp.color_ramp.interpolation = "EASE"
        eramp.color_ramp.elements[0].color = (*floor_rgb, 1.0)
        eramp.color_ramp.elements[1].color = (0.0, 0.0, 0.0, 1.0)
        nt.links.new(mr.outputs["Result"], eramp.inputs["Fac"])
        nt.links.new(eramp.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    add_atlas_node(m)
    return m


def calibrate_page_level(scene, target=(6, 6, 5)):
    """Finds the linear value per channel that the current view transform turns into the
    page colour (#060605), by pushing a ramp through save_render and reading it back."""
    n = 1024
    vals = [0.04 * (i / (n - 1)) ** 2 for i in range(n)]
    img = bpy.data.images.new("calib", n, 1, alpha=False, float_buffer=True)
    px = []
    for v in vals:
        px += [v, v, v, 1.0]
    img.pixels = px
    path = WORK + "/calib.png"
    img.save_render(path, scene=scene)
    back = bpy.data.images.load(path)
    out = list(back.pixels)
    res = []
    for c in range(3):
        best = min(range(n), key=lambda i, c=c: abs(out[4 * i + c] * 255.0 - target[c]))
        res.append(vals[best])
    bpy.data.images.remove(back)
    bpy.data.images.remove(img)
    os.remove(path)
    log("page colour #060605 <- linear", fmt(res))
    return tuple(res)


def glass_material(name):
    """Warm emissive bulb; transparent to shadow rays so the point light inside escapes."""
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.62, 0.30, 1.0)
    em.inputs["Strength"].default_value = BULB_EMISSION
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Shadow Ray"], mix.inputs["Fac"])
    nt.links.new(em.outputs["Emission"], mix.inputs[1])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    add_atlas_node(m)
    return m


def emission_material(name, hex_color, strength):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Emission Color"].default_value = hex_lin(hex_color)
    bsdf.inputs["Emission Strength"].default_value = strength
    return m


# ---------------------------------------------------------------- the model
SLAB_HALF = 0.55
SLAB_CORNER = 0.20
SLAB_T = 0.16

HOUSING_W, HOUSING_H, HOUSING_D = 0.56, 0.43, 0.035
HOUSING_TILT = 8.0
HOUSING_CENTER_G = (-0.05, None, -0.12)  # glTF X, (Y computed), Z
HOUSING_BOTTOM_Y = 0.11

SCREEN_W, SCREEN_H = 0.50, 0.375

LANTERN_POST_B = (-0.45, 0.42)            # Blender XY of the post foot (back-left corner)
LANTERN_BULB_B = Vector((-0.41, 0.10, 0.385))

AGENT_POS_G = (0.28, 0.0, 0.18)
AGENT_FACING_B = Vector((0.087, -0.996, 0.0)).normalized()  # body to the viewer, eyes to the screen


def housing_frame():
    """Returns (matrix_world of the housing centre, centre, normal, up) in Blender space."""
    rot = R("X", 90.0 - HOUSING_TILT)  # local +Z (front) -> toward viewer, leaning back
    up = (rot.to_3x3() @ Vector((0, 1, 0))).normalized()
    nrm = (rot.to_3x3() @ Vector((0, 0, 1))).normalized()
    cy = -HOUSING_CENTER_G[2]
    # bottom edge of the centre plane rests at HOUSING_BOTTOM_Y
    center = Vector((HOUSING_CENTER_G[0], cy, HOUSING_BOTTOM_Y + up.z * HOUSING_H / 2))
    return T(*center) @ rot, center, nrm, up


def build_base(M):
    parts = []

    # --- floating slab --------------------------------------------------------------
    cs = 6
    rings = []
    bev, bs = 0.032, 4
    for k in range(bs + 1):
        a = (math.pi / 2) * k / bs
        d, z = bev * (1 - math.sin(a)), -bev * (1 - math.cos(a))
        rings.append(rrect_ring(SLAB_HALF - d, SLAB_HALF - d, SLAB_CORNER - d, cs, z))
    for d, z in ((0.0, -0.062), (0.004, -0.074), (0.016, -0.086), (0.05, -0.105),
                 (0.11, -0.128), (0.18, -0.146), (0.25, -0.157), (0.30, -SLAB_T)):
        rings.append(rrect_ring(SLAB_HALF - d, SLAB_HALF - d, SLAB_CORNER - d, cs, z))
    v, f = loft(rings)
    # split faces: top material for the flat top and the bevel, gradient for everything else
    top_faces = [face for face in f if min(v[i][2] for i in face) > -0.0335]
    side_faces = [face for face in f if face not in top_faces]
    parts.append(Part(v, top_faces, M["slab_top"]))
    parts.append(Part(v, side_faces, M["slab_side"]))

    # --- terminal: foot, stand, housing ------------------------------------------------
    hx = HOUSING_CENTER_G[0]
    parts.append(Part(*rbox(0.21, 0.12, 0.016, 0.045, 0.006), M["dark"],
                      T(hx, 0.15, 0.008)).rest())
    parts.append(Part(*rbox(0.05, 0.03, 0.25, 0.012, 0.005), M["dark"],
                      T(hx, 0.138, 0.012 + 0.125)).rest())
    Mh, hc, hn, hu = housing_frame()
    parts.append(Part(*rbox(HOUSING_W, HOUSING_H, HOUSING_D, 0.035, 0.009, cs=4, bs=3),
                      M["dark"], Mh))
    # thin brass status strip on the housing's bottom bezel
    parts.append(Part(*rbox(0.05, 0.007, 0.004, 0.003, 0.0015, cs=2, bs=1), M["brass"],
                      Mh @ T(0.20, -HOUSING_H / 2 + 0.014, HOUSING_D / 2)))

    # --- low table with keyboard ----------------------------------------------------------
    ty, ttop = -0.045, 0.088
    parts.append(Part(*rbox(0.38, 0.145, 0.018, 0.022, 0.006), M["dark2"], T(hx, ty, ttop - 0.009)))
    for sx in (-1, 1):
        parts.append(Part(*rbox(0.024, 0.115, ttop - 0.016, 0.008, 0.004, cs=2), M["dark2"],
                          T(hx + sx * 0.155, ty, (ttop - 0.016) / 2)).rest())
    kb_y, kb_z = ty - 0.004, ttop + 0.006
    parts.append(Part(*rbox(0.27, 0.088, 0.012, 0.012, 0.004, cs=3), M["dark"],
                      T(hx, kb_y, kb_z)).rest())
    # tapered keycaps: two rows of nine, then a row with a space bar
    kw, kd, kh, gap, taper = 0.022, 0.019, 0.006, 0.0045, 0.0032
    ktop = kb_z + 0.006 + kh / 2 - 0.001
    keys = [(kw, (i - 4) * (kw + gap), yoff) for yoff in (0.024, 0.0) for i in range(9)]
    keys += [(kw, i * (kw + gap), -0.024) for i in (-4, -3, 3, 4)]
    keys += [(0.12, 0.0, -0.024)]
    for w, x, yoff in keys:
        parts.append(Part(*box(w, kd, kh, taper=taper), M["keys"],
                          T(hx + x, kb_y + yoff, ktop)).rest())

    # --- lantern: foot, post with crook arm, hanger, cage ---------------------------------
    px, py = LANTERN_POST_B
    L = LANTERN_BULB_B
    parts.append(Part(*revolve([(0, 0), (0.042, 0), (0.044, 0.006), (0.036, 0.014), (0.012, 0.02),
                                (0, 0.02)], 16), M["metal"], T(px, py, 0)).rest())
    parts.append(Part(*revolve([(0.0125, 0.018), (0.0145, 0.022), (0.0145, 0.03),
                                (0.0115, 0.034)], 12), M["brass"], T(px, py, 0)))
    arm_top = 0.55
    path = [(px, py, 0.015), (px, py, 0.30), (px, py, arm_top - 0.06)]
    # quarter arc from vertical to horizontal, heading toward the lantern
    hdir = Vector((L.x - px, L.y - py, 0)).normalized()
    rad = 0.06
    c = Vector((px, py, arm_top - rad)) + hdir * rad
    for k in range(1, 8):
        a = (math.pi / 2) * k / 7
        p = c - hdir * rad * math.cos(a) + Vector((0, 0, rad * math.sin(a)))
        path.append(tuple(p))
    end = Vector((L.x, L.y, arm_top)) + hdir * 0.012
    path.append(tuple(end))
    parts.append(Part(*tube(path, 0.0085, n=8), M["metal"]))
    parts.append(Part(*ellipsoid(0.012, 0.012, 0.012, n=10, rings=6), M["brass"], T(*end)))
    # hanger rod from the arm to the lantern cap
    parts.append(Part(*cylinder(0.0035, arm_top - (L.z + 0.07), n=6, z0=0.0), M["metal"],
                      T(L.x, L.y, L.z + 0.07)))
    # cap (dark), brass band, glass bulb, bottom cap, four bars
    parts.append(Part(*revolve([(0, 0.036), (0.040, 0.036), (0.042, 0.042), (0.030, 0.060),
                                (0.010, 0.072), (0.0, 0.074)], 16), M["metal"], T(*L)))
    parts.append(Part(*revolve([(0.034, 0.030), (0.037, 0.032), (0.037, 0.037),
                                (0.034, 0.039)], 16), M["brass"], T(*L)))
    gl = []
    for i in range(9):
        th = -math.pi / 2 + math.pi * i / 8
        gl.append((0.0 if i in (0, 8) else 0.029 * math.cos(th), 0.036 * math.sin(th)))
    parts.append(Part(*revolve(gl, 14), M["glass"], T(*L)))
    parts.append(Part(*revolve([(0, -0.050), (0.022, -0.050), (0.034, -0.042), (0.036, -0.036),
                                (0.0, -0.036)], 16), M["metal"], T(*L)))
    parts.append(Part(*revolve([(0, -0.058), (0.008, -0.058), (0.008, -0.050), (0, -0.050)], 8),
                      M["brass"], T(*L)))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        bx, by = L.x + 0.034 * math.cos(a), L.y + 0.034 * math.sin(a)
        parts.append(Part(*tube([(bx, by, L.z - 0.04), (bx, by, L.z + 0.04)], 0.0028, n=4),
                          M["metal"]))

    # --- cable from the terminal foot to the lantern foot ---------------------------------
    p0, p1, p2, p3 = (Vector((hx - 0.10, 0.16, 0.0)), Vector((-0.28, 0.14, 0.0)),
                      Vector((-0.33, 0.30, 0.0)), Vector((px + 0.03, py - 0.02, 0.0)))
    cable = []
    for i in range(15):
        t = i / 14
        u = 1 - t
        p = u ** 3 * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t ** 3 * p3
        cable.append((p.x, p.y, 0.0065))
    parts.append(Part(*tube(cable, 0.0065, n=6), M["cable"]))

    # --- cushion (pouf) front-left -------------------------------------------------------
    parts.append(Part(*revolve([(0, 0.0), (0.058, 0.0), (0.070, 0.008), (0.077, 0.022),
                                (0.075, 0.036), (0.066, 0.047), (0.045, 0.054), (0.0, 0.056)], 18),
                      M["cushion"], T(-0.30, -0.31, 0.0)).rest())
    parts.append(Part(*ellipsoid(0.008, 0.008, 0.004, n=8, rings=4), M["dark"],
                      T(-0.30, -0.31, 0.056)))

    # --- little stack of papers on the right ----------------------------------------------
    sheets = ((0.0, 0.0, 4.0), (0.006, -0.004, -6.0), (-0.004, 0.003, 11.0))
    for i, (dx, dy, rot) in enumerate(sheets):
        parts.append(Part(*box(0.105, 0.078, 0.0045), M["paper"],
                          T(0.40 + dx, 0.05 + dy, 0.00225 + i * 0.0047) @ R("Z", rot + 15)).rest())
    return parts


def body_profile():
    prof = []
    zc, hh = 0.114, 0.100
    steps = 14
    for i in range(steps + 1):
        th = -math.pi / 2 + math.pi * i / steps
        s = math.sin(th)
        rr = 0.088 * (1.0 - 0.10 * s)
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


AGENT_TILT = -7.0   # roll of the body toward the screen side (local -X), degrees
AGENT_GAZE = -24.0  # eyes slide around the body toward the screen side, degrees


def build_agent(M):
    """Agent in local space facing -Y (Blender), base centre at the origin.

    Returns the body parts and, for each eye, (name, local matrix of the eye centre)."""
    tilt = T(0, 0, 0.02) @ R("Y", AGENT_TILT) @ T(0, 0, -0.02)
    parts = [Part(*revolve(body_profile(), 28), M["agent"], tilt)]
    for sx in (-1, 1):
        # stubby feet (not tilted, they stay planted)
        parts.append(Part(*ellipsoid(0.027, 0.036, 0.016, n=14, rings=7), M["agent"],
                          T(sx * 0.041, -0.032, 0.014)))
        # small arm nubs, low on the sides, pointing down and a bit forward
        parts.append(Part(*ellipsoid(0.0125, 0.016, 0.022, n=10, rings=6), M["agent"],
                          tilt @ T(sx * 0.078, -0.030, 0.056) @ R("Y", sx * 30.0) @ R("X", 20.0)))
    tip = Vector((0.012, 0.010, 0.254))
    parts.append(Part(*tube([(0.0, 0.0, 0.205), (0.005, 0.004, 0.232), tip], 0.0042, n=6),
                      M["agent"], tilt))
    parts.append(Part(*ellipsoid(0.0135, 0.0135, 0.0135, n=12, rings=8), M["agent"],
                      tilt @ T(*(tip + Vector((0.001, 0.001, 0.009))))))
    eyes = []
    ez, ex = 0.130, 0.033
    r = body_radius_at(ez)
    ey = -math.sqrt(max(r * r - ex * ex, 1e-6)) + 0.0028
    # facing -Y toward the viewer, the agent's own left is +X
    for sx, name in ((-1, "AgentEyeR"), (1, "AgentEyeL")):
        yaw = math.degrees(math.asin(sx * ex / r))
        m = tilt @ R("Z", AGENT_GAZE) @ T(sx * ex, ey, ez) @ R("Z", yaw) @ R("X", -8.0)
        eyes.append((name, m))
    return parts, eyes


# ---------------------------------------------------------------- UVs and bake
def select_only(objs, active):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def unwrap(objs, angles, agent_scale=1.7, under_scale=0.45):
    """Lightmap-style UVs: smart projection per object, uniform texel density, then texel
    priorities (agent up, dark underside down) and one shared pack with a safe margin."""
    scene = bpy.context.scene
    scene.tool_settings.use_uv_select_sync = True
    for ob, ang in zip(objs, angles, strict=True):
        select_only([ob], ob)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(ang), margin_method="FRACTION",
                                 island_margin=0.01, area_weight=0.0, correct_aspect=True,
                                 scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    select_only(objs, objs[0])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    for ob in objs:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        uv = bm.loops.layers.uv.active
        for island in bmesh_utils.bmesh_linked_uv_islands(bm, uv):
            area = max(sum(f.calc_area() for f in island), 1e-9)
            nz = sum(f.normal.z * f.calc_area() for f in island) / area
            cz = sum(f.calc_center_median().z * f.calc_area() for f in island) / area
            if ob.name == "Agent":
                s = agent_scale
            elif nz < -0.25 or cz < -0.09:
                s = under_scale
            else:
                continue
            loops = [lp for f in island for lp in f.loops]
            cu = sum(lp[uv].uv.x for lp in loops) / len(loops)
            cv = sum(lp[uv].uv.y for lp in loops) / len(loops)
            for lp in loops:
                lp[uv].uv.x = cu + (lp[uv].uv.x - cu) * s
                lp[uv].uv.y = cv + (lp[uv].uv.y - cv) * s
        bm.to_mesh(ob.data)
        bm.free()
    select_only(objs, objs[0])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method="FRACTION", margin=0.0065,
                            shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    report_texel_density(objs)


def report_texel_density(objs):
    """Logs atlas pixels per metre per bake material and the used fraction of the atlas."""
    used = 0.0
    for ob in objs:
        me = ob.data
        uv = me.uv_layers.active.data
        acc = {}
        for poly in me.polygons:
            pts = [uv[i].uv for i in poly.loop_indices]
            a_uv = 0.0
            for i in range(1, len(pts) - 1):
                a_uv += abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2
            name = me.materials[poly.material_index].name
            s = acc.setdefault(name, [0.0, 0.0])
            s[0] += a_uv
            s[1] += poly.area
            used += a_uv
        for name, (a_uv, a3) in sorted(acc.items()):
            log(f"texel {ob.name}/{name}: {math.sqrt(a_uv / max(a3, 1e-9)) * ATLAS_RES:.0f} px/m,"
                f" {a_uv * 100:.1f}% of atlas")
    log(f"atlas coverage (islands only, without margins): {used * 100:.1f}%")
    for ob in objs:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        uv = bm.loops.layers.uv.active
        islands = bmesh_utils.bmesh_linked_uv_islands(bm, uv)
        log(f"uv islands {ob.name}: {len(islands)}")
        bm.free()


def check_uv_layout(objs, path, res=ATLAS_RES):
    """Rasterises the UV islands at atlas resolution, writes a debug image (grey = island,
    red = overlap) and logs overlapping pixels and the smallest gap between two islands."""
    import numpy as np
    count = np.zeros((res, res), dtype=np.int32)
    label = np.full((res, res), -1, dtype=np.int32)
    next_id = 0
    for ob in objs:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        uvl = bm.loops.layers.uv.active
        for island in bmesh_utils.bmesh_linked_uv_islands(bm, uvl):
            for f in island:
                pts = [lp[uvl].uv for lp in f.loops]
                for k in range(1, len(pts) - 1):
                    p = np.array([pts[0][:], pts[k][:], pts[k + 1][:]]) * res
                    x0, y0 = np.floor(p.min(axis=0)).astype(int)
                    x1, y1 = np.ceil(p.max(axis=0)).astype(int)
                    xi = np.arange(max(x0, 0), min(x1 + 1, res))
                    yi = np.arange(max(y0, 0), min(y1 + 1, res))
                    if xi.size == 0 or yi.size == 0:
                        continue
                    xs, ys = np.meshgrid(xi + 0.5, yi + 0.5)
                    (ax, ay), (bx, by), (cx, cy) = p
                    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                    if abs(d) < 1e-12:
                        continue
                    w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / d
                    w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / d
                    inside = (w0 >= -1e-9) & (w1 >= -1e-9) & (w0 + w1 <= 1 + 1e-9)
                    yy, xx = np.meshgrid(yi, xi, indexing="ij")
                    yy, xx = yy[inside], xx[inside]
                    other = (label[yy, xx] >= 0) & (label[yy, xx] != next_id)
                    count[yy[other], xx[other]] += 1
                    label[yy, xx] = next_id
            next_id += 1
        bm.free()
    overlap = int((count > 0).sum())
    gap = None
    for k in range(1, 16):
        hit = False
        for dx in range(-k, k + 1):
            for dy in range(-k, k + 1):
                if max(abs(dx), abs(dy)) != k:
                    continue
                a = label[max(dy, 0):res + min(dy, 0), max(dx, 0):res + min(dx, 0)]
                b = label[max(-dy, 0):res + min(-dy, 0), max(-dx, 0):res + min(-dx, 0)]
                if np.any((a >= 0) & (b >= 0) & (a != b)):
                    hit = True
                    break
            if hit:
                break
        if hit:
            gap = k - 1
            break
    rgba = np.zeros((res, res, 4), dtype=np.float32)
    rgba[..., 3] = 1.0
    cov = label >= 0
    rgba[cov, 0:3] = 0.5
    rgba[count > 0] = (1.0, 0.0, 0.0, 1.0)
    im = bpy.data.images.new("uvcheck", res, res)
    im.pixels = rgba.ravel()
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    log(f"uv check: {next_id} islands, overlap pixels {overlap}, smallest gap between islands "
        f"{gap if gap is not None else '>= 15'} px (at {res}px) -> {path}")


def denoise_atlas(scene, img):
    """Cycles cannot denoise a bake, so the raw float bake goes through the compositor's
    Denoise node (OIDN, HDR) once; the bake margins keep island edges from bleeding."""
    t0 = time.time()
    hidden = [o for o in scene.objects if not o.hide_render]
    for o in hidden:
        o.hide_render = True
    cam = bpy.data.objects.new("denoise_cam", bpy.data.cameras.new("denoise_cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    ng = bpy.data.node_groups.new("bake_denoise", "CompositorNodeTree")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    n_img = ng.nodes.new("CompositorNodeImage")
    n_img.image = img
    dn = ng.nodes.new("CompositorNodeDenoise")
    dn.inputs["HDR"].default_value = True
    try:
        dn.inputs["Quality"].default_value = "High"
    except (TypeError, ValueError) as e:
        log("denoise quality left at default:", e)
    out = ng.nodes.new("NodeGroupOutput")
    ng.links.new(n_img.outputs["Image"], dn.inputs["Image"])
    ng.links.new(dn.outputs["Image"], out.inputs[0])
    scene.compositing_node_group = ng
    scene.render.use_compositing = True
    r = scene.render
    keep = (r.resolution_x, r.resolution_y, r.resolution_percentage, scene.cycles.samples)
    r.resolution_x = r.resolution_y = img.size[0]
    r.resolution_percentage = 100
    scene.cycles.samples = 1
    bpy.ops.render.render()
    tmp = WORK + "/atlas_denoised.exr"
    s = r.image_settings
    fmt_keep = (s.file_format, s.color_depth, s.color_mode)
    s.file_format, s.color_depth, s.color_mode = "OPEN_EXR", "32", "RGB"
    bpy.data.images["Render Result"].save_render(tmp, scene=scene)
    s.file_format, s.color_depth, s.color_mode = fmt_keep
    den = bpy.data.images.load(tmp)
    img.pixels = den.pixels[:]
    img.update()
    bpy.data.images.remove(den)
    r.resolution_x, r.resolution_y, r.resolution_percentage, scene.cycles.samples = keep
    scene.compositing_node_group = None
    scene.render.use_compositing = False
    bpy.data.objects.remove(cam)
    for o in hidden:
        o.hide_render = False
    log(f"atlas denoised (OIDN, compositor) in {time.time() - t0:.1f}s")


def apply_look(scene):
    vs = scene.view_settings
    vs.view_transform = VIEW_TRANSFORM
    vs.look = LOOK
    vs.exposure = EXPOSURE
    vs.gamma = GAMMA
    scene.display_settings.display_device = "sRGB"
    s = scene.render.image_settings
    s.file_format = "PNG"
    s.color_mode = "RGB"
    s.color_depth = "8"
    s.color_management = "FOLLOW_SCENE"  # PNG gets the scene's view transform and look


# ---------------------------------------------------------------- main build
def main():
    global ATLAS
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    setup_gpu(scene)

    apply_look(scene)
    page_lin = calibrate_page_level(scene)
    ATLAS = bpy.data.images.new("pod_atlas_bake", ATLAS_RES, ATLAS_RES, alpha=False,
                                float_buffer=True)
    M = {
        "slab_top": principled("bake_slab_top", hex_lin("#3a3833")),
        "slab_side": gradient_material("bake_slab_side", "#24231f", "#060605", -0.150, -0.062,
                                        floor_rgb=page_lin),
        "dark": principled("bake_dark", hex_lin("#1e1d1a")),
        "dark2": principled("bake_dark2", hex_lin("#2a2824")),
        "keys": principled("bake_keys", hex_lin("#2e2c28")),
        "metal": principled("bake_metal", hex_lin("#1c1b18")),
        "brass": principled("bake_brass", hex_lin("#c08532")),
        "glass": glass_material("bake_glass"),
        "cable": principled("bake_cable", hex_lin("#141412")),
        "cushion": principled("bake_cushion", hex_lin("#4a463f")),
        "paper": principled("bake_paper", hex_lin("#e9e7e0")),
        "agent": principled("bake_agent", hex_lin("#c8c6bf")),
    }
    eye_mat = principled("AgentEye", hex_lin("#101014"), rough=1.0, with_atlas=False)
    screen_mat = emission_material("Screen", "#f2f1ec", SCREEN_BAKE_STRENGTH)

    # --- Base
    base = build_object("Base", build_base(M), smooth_angle=40.0)

    # --- Screen (single quad, 1 mm in front of the housing)
    Mh, hc, hn, hu = housing_frame()
    sc = hc + hn * (HOUSING_D / 2 + 0.001)
    right = hu.cross(hn).normalized()
    hw, hh = SCREEN_W / 2, SCREEN_H / 2
    sme = bpy.data.meshes.new("Screen")
    # counter-clockwise seen from the front; UV (0,0) bottom-left .. (1,1) top-right
    corners = [-right * hw - hu * hh, right * hw - hu * hh, right * hw + hu * hh,
               -right * hw + hu * hh]
    sme.from_pydata([tuple(c) for c in corners], [], [(0, 1, 2, 3)])
    uvl = sme.uv_layers.new(name="UVMap")
    for li, uvc in enumerate(((0, 0), (1, 0), (1, 1), (0, 1))):
        uvl.data[li].uv = uvc
    sme.materials.append(screen_mat)
    screen = bpy.data.objects.new("Screen", sme)
    screen.location = sc
    scene.collection.objects.link(screen)

    # --- Agent
    agent_parts, eye_defs = build_agent(M)
    # rotate local -Y onto AGENT_FACING_B
    yaw = math.atan2(AGENT_FACING_B.x, -AGENT_FACING_B.y)
    Ra = R("Z", math.degrees(yaw))
    apos = g2b(*AGENT_POS_G)
    for p in agent_parts:
        p.verts = [Ra @ v + apos for v in p.verts]
    agent = build_object("Agent", agent_parts, smooth_angle=60.0, origin=apos)

    eyes = []
    for name, m_local in eye_defs:
        m = T(*apos) @ Ra @ m_local
        c = m.to_translation()
        v, f = ellipsoid(0.0125, 0.0075, 0.0205, n=12, rings=8)
        eyes.append(build_object(name, [Part(v, f, eye_mat, m)], smooth_angle=80.0, origin=c))

    # --- LanternGlow empty
    glow = bpy.data.objects.new("LanternGlow", None)
    glow.empty_display_type = "SPHERE"
    glow.empty_display_size = 0.03
    glow.location = LANTERN_BULB_B
    scene.collection.objects.link(glow)

    # --- lights for the bake
    ld = bpy.data.lights.new("LanternLight", "POINT")
    ld.energy = LANTERN_POWER_W
    ld.use_temperature = True
    ld.temperature = LANTERN_TEMP_K
    ld.color = (1, 1, 1)
    ld.shadow_soft_size = LANTERN_RADIUS
    lo = bpy.data.objects.new("LanternLight", ld)
    lo.location = LANTERN_BULB_B
    scene.collection.objects.link(lo)
    world = bpy.data.worlds.new("World")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (WORLD_AMBIENT, WORLD_AMBIENT, WORLD_AMBIENT, 1)
    bg.inputs["Strength"].default_value = 1.0

    # --- triangle count
    total = 0
    for ob in (base, screen, agent, *eyes):
        ob.data.calc_loop_triangles()
        n = len(ob.data.loop_triangles)
        total += n
        log(f"tris {ob.name}: {n}")
    log("tris total:", total)

    # --- UVs (lightmap-style atlas shared by Base and Agent)
    unwrap([base, agent], [66.0, 75.0])
    check_uv_layout([base, agent], WORK + "/uv_layout.png")
    if "--uvdebug" in ARGV:
        return

    # --- bake
    apply_look(scene)
    if SKIP_BAKE and os.path.exists(ATLAS_EXR):
        log("skip bake: loading", ATLAS_EXR)
        src = bpy.data.images.load(ATLAS_EXR)
        ATLAS.pixels = src.pixels[:]
        ATLAS.update()
    else:
        scene.cycles.samples = BAKE_SAMPLES
        scene.cycles.use_denoising = False
        scene.cycles.max_bounces = 6
        scene.cycles.diffuse_bounces = 4
        scene.cycles.glossy_bounces = 0
        scene.cycles.sample_clamp_indirect = 3.0
        b = scene.render.bake
        b.use_pass_direct = True
        b.use_pass_indirect = True
        b.use_pass_diffuse = True
        b.use_pass_glossy = False
        b.use_pass_transmission = False
        b.use_pass_emit = True
        b.margin = 16
        b.margin_type = "ADJACENT_FACES"
        b.use_clear = True
        b.target = "IMAGE_TEXTURES"
        select_only([base, agent], base)
        log(f"baking COMBINED {ATLAS_RES}px, {BAKE_SAMPLES} samples on", scene.cycles.device)
        tb = time.time()
        bpy.ops.object.bake(type="COMBINED")
        log(f"bake done in {time.time() - tb:.1f}s")
        ATLAS.filepath_raw = ATLAS_EXR
        ATLAS.file_format = "OPEN_EXR"
        ATLAS.save()
    if "--no-denoise" not in ARGV:
        denoise_atlas(scene, ATLAS)
    ATLAS.save_render(ATLAS_PNG, scene=scene)
    log("atlas written:", ATLAS_PNG, "| view:", scene.view_settings.view_transform,
        "| look:", scene.view_settings.look, "| exposure:", scene.view_settings.exposure)

    # --- export materials
    atlas_img = bpy.data.images.load(ATLAS_PNG)
    atlas_img.colorspace_settings.name = "sRGB"

    def atlas_material(name):
        m = bpy.data.materials.new(name)
        if m.node_tree is None:
            m.use_nodes = True
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = atlas_img
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0
        bsdf.inputs["Metallic"].default_value = 0.0
        return m

    for ob, mname in ((base, "Pod"), (agent, "Agent")):
        mat = atlas_material(mname)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
        for p in ob.data.polygons:
            p.material_index = 0
    # the screen was a strong light for the bake; the shipped material is plain #f2f1ec emission
    for n in screen_mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            n.inputs["Emission Strength"].default_value = 1.0
    # all shipped meshes are closed or only seen from the front: export single-sided
    for m in (ob.data.materials[0] for ob in (base, agent, screen, *eyes)):
        m.use_backface_culling = True

    # --- report transforms in glTF space
    sn = (sme.polygons[0].normal).normalized()
    log("Screen position (glTF):", fmt(b2g(screen.location)))
    log("Screen normal   (glTF):", fmt(b2g(sn)))
    log("Screen up       (glTF):", fmt(b2g(hu)))
    log("Screen right    (glTF):", fmt(b2g(right)))
    log(f"Screen size: {SCREEN_W:.3f} x {SCREEN_H:.3f}")
    log("Housing centre  (glTF):", fmt(b2g(hc)))
    log("Agent position  (glTF):", fmt(b2g(agent.location)),
        "body facing (glTF):", fmt(b2g(AGENT_FACING_B)))
    for e in eyes:
        log(f"{e.name} position (glTF):", fmt(b2g(e.location)))
    log("LanternGlow position (glTF):", fmt(b2g(glow.location)))

    # --- export
    bpy.data.objects.remove(lo)
    export_objs = [base, screen, agent, *eyes, glow]
    select_only(export_objs, base)
    bpy.ops.export_scene.gltf(
        filepath=GLB, export_format="GLB", use_selection=True, export_yup=True,
        export_apply=True, export_cameras=False, export_lights=False, export_animations=False,
        export_texcoords=True, export_normals=True, export_materials="EXPORT",
        export_image_format="AUTO", export_extras=False)
    log("exported", GLB, os.path.getsize(GLB), "bytes")

    # bounding box (glTF)
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for ob in (base, screen, agent, *eyes):
        for v in ob.data.vertices:
            g = b2g(ob.matrix_world @ v.co)
            mn = Vector(map(min, mn, g))
            mx = Vector(map(max, mx, g))
    log("bbox min (glTF):", fmt(mn), "max:", fmt(mx), "size:", fmt(mx - mn))
    log(f"build+bake+export {time.time() - t0:.1f}s")

    render_previews()


def fmt(v):
    return "(" + ", ".join(f"{c:.4f}" for c in v) + ")"


# ---------------------------------------------------------------- previews
def render_previews():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    setup_gpu(scene)
    bpy.ops.import_scene.gltf(filepath=GLB)
    names = sorted(o.name for o in scene.objects)
    log("imported nodes:", names)
    for m in bpy.data.materials:
        if m.name in ("Pod", "Agent"):
            nt = m.node_tree
            img = next(n.image for n in nt.nodes if n.type == "TEX_IMAGE")
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Strength"].default_value = 1.0
            nt.links.new(tex.outputs["Color"], em.inputs["Color"])
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    world = bpy.data.worlds.new("World")
    scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = hex_lin("#060605")
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.render.resolution_x, scene.render.resolution_y = 1200, 900
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 64
    scene.cycles.use_denoising = False
    s = scene.render.image_settings
    s.file_format, s.color_mode, s.color_depth = "PNG", "RGB", "8"
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = [("front", (1.2, 0.9, 1.9), (0, 0.3, 0)),
             ("left", (-1.6, 0.7, 1.4), (0, 0.3, 0)),
             ("top", (0.3, 2.4, 1.2), (0, 0.2, 0)),
             ("far", (3.5, 1.6, 5.0), (0, 0.3, 0))]
    if "--closeups" in ARGV:
        # inspection shots (work/ only): agent seams, the back side and the underside
        shots += [("x_agent", (0.55, 0.3, 0.75), (0.26, 0.12, 0.18)),
                  ("x_back", (-1.0, 1.0, -1.7), (0, 0.2, 0)),
                  ("x_below", (1.4, -0.9, 1.6), (0, 0.0, 0)),
                  ("x_deck", (0.05, 0.75, 0.40), (-0.05, 0.10, -0.03))]
    for name, pos, tgt in shots:
        p, t = g2b(*pos), g2b(*tgt)
        cam.location = p
        cam.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
        folder = WORK if name.startswith("x_") else OUT
        scene.render.filepath = f"{folder}/preview_{name}.png"
        bpy.ops.render.render(write_still=True)
        log("preview written:", scene.render.filepath)


main()
