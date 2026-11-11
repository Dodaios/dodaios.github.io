# ruff: noqa: E501
"""The room: one data file every model script reads.

The site's 3D scene is one complete room, a vibe coder's setup at night. Five
zones are modelled by five scripts and baked separately; this file is what keeps
them one room. Nothing in here imports Blender, so it can be read anywhere.

ALL COORDINATES ARE glTF / three.js: X right, Y up, Z toward the viewer, metres.
In Blender (Z up) that is: Blender X = X, Blender Y = -Z, Blender Z = Y.
`to_blender` below does the conversion; use it, never convert by hand.

A yaw is a turn about the vertical axis in degrees. Yaw 0 faces +Z (toward the
viewer who stands in the room looking at the back wall). Yaw 90 faces +X, yaw
-90 faces -X, yaw 180 faces -Z.
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# The room itself (inner faces of the walls)
# --------------------------------------------------------------------------- #

ROOM = {
    "x": (-3.6, 3.6),  # left wall, right wall
    "y": (0.0, 3.0),  # floor, ceiling
    "z": (-2.7, 2.7),  # back wall (behind the desk), front wall
    "wall_thickness": 0.15,
}

# The one opening: a wide window in the LEFT wall (x = -3.6). No glass pane is
# modelled: the site draws the night sky and the stars behind the opening.
WINDOW = {"wall": "left", "z": (-0.9, 1.3), "y": (0.9, 2.5)}

# A door stands in the front wall. It never opens; it is dressing.
DOOR = {"wall": "front", "x": (0.7, 1.6), "y": (0.0, 2.1)}


def to_blender(p):
    """glTF (x, y, z) -> Blender (x, y, z)."""
    x, y, z = p
    return (x, -z, y)


# --------------------------------------------------------------------------- #
# Palette. The brand is a neutral, cool-black room: every surface is r = g = b,
# one step lighter than the one under it. One accent, blue. The only warm things
# are the gold wordmark and real light (the desk lamp, the morning sun).
# sRGB hex. Albedos are kept in the dark-to-mid range so that light does the work.
# --------------------------------------------------------------------------- #

PALETTE = {
    "wall": "#2b2b2b",
    "wall_trim": "#1f1f1f",  # skirting, window reveal, door frame
    "ceiling": "#232323",
    "floor": "#242424",  # dark matte boards or polished concrete, your call
    "rug": "#343434",
    "furniture": "#1c1c1c",  # desk frame, shelves, racks
    "furniture_top": "#3a3a3a",  # desk top, table tops, shelf boards
    "device": "#151515",  # monitor shells, keyboards, speakers, PC case
    "device_key": "#2e2e2e",  # key caps, knobs
    "metal": "#4a4a4a",  # stands, arms, legs
    "fabric": "#303030",  # chair, armchair, curtains
    "paper": "#ededed",  # paper, mugs, whiteboard, cards, lightbox faces
    "paper_dim": "#bdbdbd",
    "book_a": "#5a5a5a",
    "book_b": "#8a8a8a",
    "book_c": "#3d3d3d",
    "plant": "#3f4a3f",  # the one muted green, for leaves only
    "pot": "#e0e0e0",
    "cork": "#6b6259",  # corkboard only
    "gold": "#c9a24a",  # the wordmark, and nothing else
    "accent": "#3D8BFF",  # emissive only: LED lines, status lights
    "success": "#22C35E",  # emissive only: tiny status LEDs
    "screen_glow": "#f2f2f2",  # emissive faces of screens and lightboxes
    # Agent creatures (one per screen on the agents wall).
    "agent_violet": "#8b5cf6",
    "agent_orange": "#f2a65a",
    "agent_sky": "#7ab6ef",
    "agent_lime": "#b7cb78",
    "agent_rose": "#ed91aa",
    "agent_teal": "#79c7c4",
}

# --------------------------------------------------------------------------- #
# Zones. Each is modelled and baked by its own script, `zone_<name>.py`, into
# its own atlas and its own GLB. `box` is the floor area and height the zone may
# fill: (x0, x1, z0, z1, y1). Stay inside it. The middle of the room stays empty:
# the camera flies there.
# --------------------------------------------------------------------------- #

ZONES = {
    # Back wall, centre: the desk. The first thing a visitor sees, from 1.3 m.
    "desk": {"box": (-1.35, 1.45, -2.7, -0.85, 3.0), "triangles": 40000},
    # Right wall: six screens with an agent at each, and the back-right corner.
    "right": {"box": (1.7, 3.6, -2.7, 2.7, 3.0), "triangles": 28000},
    # Front-left: the holo table, a seat, the lightbox on the front wall, the door.
    "lounge": {"box": (-3.15, 1.7, 0.75, 2.7, 3.0), "triangles": 22000},
    # Left wall, front and middle: the window, the star counter, the corkboard.
    "window": {"box": (-3.6, -3.15, -0.95, 2.7, 3.0), "triangles": 16000},
    # Back-left corner: the whiteboard on the back wall, the blueprint on the left wall.
    "corner": {"box": (-3.6, -1.5, -2.7, -1.0, 3.0), "triangles": 16000},
}

# The camera's flying space: nothing taller than 0.5 m may stand in here.
CLEAR = {"x": (-1.4, 1.6), "z": (-0.8, 0.7)}

# --------------------------------------------------------------------------- #
# Quads. Flat rectangles the site draws on at run time: the app, terminals, and
# every piece of text in the room. Each is exported as its OWN object, a single
# quad of exactly this size, centre, yaw and lean, with UVs filling 0..1 (U left
# to right, V bottom to top as seen from its front). Model the housing around
# it; never change the quad. `common.make_quad(name)` builds one from this table.
#
# kind:
#   "screen"    a display: emits `screen_glow` in the bake (it lights the room)
#   "lightbox"  a lit panel with dark letters: emits, strongly
#   "ledbar"    dark glass with glowing letters: emits weakly
#   "surface"   ink or print on a surface that is itself baked (whiteboard,
#               poster, card, wall lettering): does not emit; the surface under
#               it is modelled and baked by the zone, the quad floats 1.5 mm
#               above it and is exported with a fully transparent material
# --------------------------------------------------------------------------- #

APP_RATIO = 1360 / 758

QUADS = {
    # --- desk -------------------------------------------------------------
    # The main monitor: the working app lands on it, to the pixel. Exactly
    # vertical, exactly facing +Z. Nothing may stand between it and the point
    # (0, 1.16, -0.2), with 6 cm to spare on every side of that pyramid.
    "Screen": {"zone": "desk", "kind": "screen", "at": (0.0, 1.16, -2.38), "size": (0.42 * APP_RATIO, 0.42), "yaw": 0, "lean": 0},
    # A light bar hung just above the monitor: the page's headline, in light.
    "Text_hero": {"zone": "desk", "kind": "ledbar", "at": (0.0, 1.425, -2.37), "size": (0.42 * APP_RATIO, 0.07), "yaw": 0, "lean": 0},
    # A second monitor, upright, right of the main one, turned toward the seat.
    "Screen2": {"zone": "desk", "kind": "screen", "at": (0.74, 1.13, -2.30), "size": (0.34, 0.604), "yaw": -20, "lean": 0},
    # A small lit sign on the desk, left front: the voice chapter's line.
    "Text_voice": {"zone": "desk", "kind": "lightbox", "at": (-0.95, 0.85, -2.02), "size": (0.36, 0.16), "yaw": 24, "lean": 6},
    # --- right wall ----------------------------------------------------------
    # Six screens, two rows of three. As seen from the room: 1 2 3 on top, 4 5 6 below.
    "Wall_1": {"zone": "right", "kind": "screen", "at": (3.50, 1.93, -1.0), "size": (0.80, 0.50), "yaw": -90, "lean": 0},
    "Wall_2": {"zone": "right", "kind": "screen", "at": (3.50, 1.93, 0.0), "size": (0.80, 0.50), "yaw": -90, "lean": 0},
    "Wall_3": {"zone": "right", "kind": "screen", "at": (3.50, 1.93, 1.0), "size": (0.80, 0.50), "yaw": -90, "lean": 0},
    "Wall_4": {"zone": "right", "kind": "screen", "at": (3.50, 1.30, -1.0), "size": (0.80, 0.50), "yaw": -90, "lean": 0},
    "Wall_5": {"zone": "right", "kind": "screen", "at": (3.50, 1.30, 0.0), "size": (0.80, 0.50), "yaw": -90, "lean": 0},
    "Wall_6": {"zone": "right", "kind": "screen", "at": (3.50, 1.30, 1.0), "size": (0.80, 0.50), "yaw": -90, "lean": 0},
    # Lettering on the wall above the screens.
    "Text_agents": {"zone": "right", "kind": "surface", "at": (3.5985, 2.55, 0.0), "size": (3.0, 0.34), "yaw": -90, "lean": 0},
    # --- lounge -----------------------------------------------------------
    # A cinema-style lightbox on the front wall, behind the holo table.
    "Text_reach": {"zone": "lounge", "kind": "lightbox", "at": (-1.45, 2.2, 2.62), "size": (1.8, 0.5), "yaw": 180, "lean": 0},
    # --- window -----------------------------------------------------------
    # A counter standing on the window sill: the number of GitHub stars.
    "Text_stars": {"zone": "window", "kind": "ledbar", "at": (-3.36, 1.05, 0.2), "size": (0.8, 0.2), "yaw": 90, "lean": 4},
    # Three cards pinned to the corkboard: what people said.
    "Text_quote1": {"zone": "window", "kind": "surface", "at": (-3.5635, 1.62, 1.72), "size": (0.29, 0.36), "yaw": 90, "lean": 0},
    "Text_quote2": {"zone": "window", "kind": "surface", "at": (-3.5635, 1.62, 2.05), "size": (0.29, 0.36), "yaw": 90, "lean": 0},
    "Text_quote3": {"zone": "window", "kind": "surface", "at": (-3.5635, 1.62, 2.38), "size": (0.29, 0.36), "yaw": 90, "lean": 0},
    # --- corner -----------------------------------------------------------
    # The whiteboard on the back wall: the install command, in marker.
    "Text_install": {"zone": "corner", "kind": "surface", "at": (-2.5, 1.5, -2.6585), "size": (1.6, 1.0), "yaw": 0, "lean": 0},
    # A framed blueprint on the left wall: the open-source chapter.
    "Text_open": {"zone": "corner", "kind": "surface", "at": (-3.5735, 1.65, -1.85), "size": (1.0, 0.7), "yaw": 90, "lean": 0},
}

# --------------------------------------------------------------------------- #
# Anchors. Empties the site reads positions from. `common.make_anchor(name)`.
# --------------------------------------------------------------------------- #

ANCHORS = {
    # Where the mascot sits: on the desk top, left of the monitor. The mascot is
    # 0.36 m tall and 0.26 m wide and is NOT part of any zone; for the bake put
    # a dark blob of that size there (common.mascot_proxy()) and do not export it.
    "MascotAnchor": {"zone": "desk", "at": (-0.62, 0.74, -2.12), "yaw": 14},
    # The desk lamp's bulb, and the middle of its pool of light on the desk.
    # The desk zone moves these two to where its lamp really is.
    "LampBulb": {"zone": "desk", "at": (-1.0, 1.25, -2.45), "yaw": 0},
    "LampPool": {"zone": "desk", "at": (-0.7, 0.74, -2.2), "yaw": 0},
    # The tip of the microphone on its boom arm.
    "MicTip": {"zone": "desk", "at": (-0.46, 1.02, -2.0), "yaw": 0},
    # The gold wordmark's centre on the back wall (for a glow the site adds).
    "Wordmark": {"zone": "desk", "at": (0.0, 2.22, -2.66), "yaw": 0},
    # The middle of the hologram above the holo table. The site draws three
    # rings of small tiles around it, radius up to 1.2 m, 0.6 m high in all:
    # keep that cylinder free of everything.
    "HoloCenter": {"zone": "lounge", "at": (-1.45, 1.2, 1.25), "yaw": 0},
}

# --------------------------------------------------------------------------- #
# Light. ONE rig for every zone, so the zones agree. `common.setup_lights(state)`
# builds it. Emissive quads of OTHER zones are stood in for by area lights made
# from QUADS, so a zone baked alone still gets their light.
#
# night: the room is dark and neutral. Practical lights only.
# dawn:  a low, warm sun comes through the window in the left wall and rakes
#        across the floor toward the desk and the right wall. Lamps are off,
#        screens and lightboxes stay on.
# Strengths are Blender watts for point/spot lights; the lead tunes them once
# in common.py and nobody else changes them.
# --------------------------------------------------------------------------- #

LIGHTS = {
    "night": [
        {"name": "DeskLamp", "type": "SPOT", "at": "LampBulb", "aim": "LampPool", "kelvin": 3000, "watts": 55, "spot_deg": 95},
        {"name": "DeskLedStrip", "type": "AREA", "at": (0.0, 0.95, -2.66), "size": (2.1, 0.03), "yaw": 0, "color": "accent", "watts": 9},
        {"name": "WordmarkLight", "type": "SPOT", "at": (0.0, 2.75, -2.3), "aim": (0.0, 2.22, -2.68), "kelvin": 2900, "watts": 26, "spot_deg": 70},
        {"name": "LoungeLamp", "type": "POINT", "at": (-2.75, 1.45, 2.25), "kelvin": 3000, "watts": 48},
        {"name": "HoloGlow", "type": "POINT", "at": (-1.45, 1.05, 1.25), "color": "#cfe0ff", "watts": 22},
        # Three small spots on a ceiling track wash the agents wall (zone right models the track).
        {"name": "TrackSpotA", "type": "SPOT", "at": (2.55, 2.9, -1.0), "aim": (3.55, 1.75, -1.0), "kelvin": 3300, "watts": 26, "spot_deg": 78},
        {"name": "TrackSpotB", "type": "SPOT", "at": (2.55, 2.9, 0.0), "aim": (3.55, 1.75, 0.0), "kelvin": 3300, "watts": 26, "spot_deg": 78},
        {"name": "TrackSpotC", "type": "SPOT", "at": (2.55, 2.9, 1.0), "aim": (3.55, 1.75, 1.0), "kelvin": 3300, "watts": 26, "spot_deg": 78},
        {"name": "BlueprintLight", "type": "SPOT", "at": (-3.0, 2.85, -1.85), "aim": (-3.57, 1.65, -1.85), "kelvin": 3000, "watts": 14, "spot_deg": 62},
        {"name": "Moon", "type": "SUN", "direction": (0.82, -0.5, -0.28), "color": "#9db4d6", "strength": 0.8},
        {"name": "Ambient", "type": "WORLD", "color": "#0c0d10", "strength": 1.0},
    ],
    "dawn": [
        {"name": "Sun", "type": "SUN", "direction": (0.86, -0.4, -0.32), "kelvin": 3600, "strength": 3.4, "angle_deg": 2.5},
        {"name": "Sky", "type": "WORLD", "color": "#8fa3bd", "strength": 0.55},
        {"name": "DeskLedStrip", "type": "AREA", "at": (0.0, 0.95, -2.66), "size": (2.1, 0.03), "yaw": 0, "color": "accent", "watts": 4},
        {"name": "WordmarkLight", "type": "SPOT", "at": (0.0, 2.75, -2.3), "aim": (0.0, 2.22, -2.68), "kelvin": 2900, "watts": 12, "spot_deg": 70},
    ],
}

# Emission of the quads in the bake, by kind (Blender emission strength).
EMISSION = {
    "night": {"screen": 2.2, "lightbox": 3.0, "ledbar": 0.6},
    "dawn": {"screen": 2.2, "lightbox": 3.0, "ledbar": 0.6},
}

# --------------------------------------------------------------------------- #
# Where the site's camera stands. Use these for the previews, so a zone is
# judged as it will be seen. (position, look-at, vertical field of view)
# --------------------------------------------------------------------------- #

CAMERAS = {
    "hero": ((0.0, 1.16, -1.08), (0.0, 1.16, -2.38), 30),  # seated at the monitor
    "desk_medium": ((-0.15, 1.25, -0.35), (0.05, 1.05, -2.3), 34),  # mascot, monitor, second monitor
    "mascot": ((-0.25, 1.0, -1.35), (-0.62, 0.93, -2.12), 30),
    "desk_wide": ((0.6, 1.7, 0.9), (0.0, 1.4, -2.6), 42),  # the whole back wall with the wordmark
    "agents": ((0.2, 1.6, 0.05), (3.5, 1.62, 0.0), 40),
    "agents_close": ((2.0, 1.45, 0.75), (3.5, 1.5, 0.2), 34),
    "holo": ((-0.15, 1.5, -0.55), (-1.45, 1.3, 1.25), 40),
    "window": ((0.3, 1.6, 0.75), (-3.6, 1.6, 0.9), 42),
    "corkboard": ((-1.9, 1.6, 1.6), (-3.56, 1.62, 2.05), 32),
    "blueprint": ((-1.6, 1.55, -1.5), (-3.57, 1.6, -1.85), 34),
    "whiteboard": ((-2.3, 1.5, -0.6), (-2.5, 1.5, -2.66), 36),
    "finale": ((2.9, 1.9, 2.2), (-0.6, 1.25, -1.0), 50),  # the whole room from the front-right corner
}
