# The room

The Blender sources of the site's 3D scene: one complete room, a developer's
setup at night. The camera lives inside it, starts seated at the desk with the
working app on the monitor, and flies from station to station as the page
scrolls. Every piece of text in the room is an object in the room: a light bar,
a lightbox, lettering on a wall, a whiteboard, cards on a corkboard.

How the site uses the room is in [`docs/world.md`](../../docs/world.md). This
file is about building it.

## The files

| File | What |
|---|---|
| `spec.py` | Every number two files must agree on: the room, the palette, the zones, the quads the site draws on, the anchors, the lights, the cameras the previews are taken from. `src/world/script.ts` uses the same coordinates. |
| `common.py` | What every zone shares: materials from the palette, quads and anchors from the spec, the shell, the one light rig, the lightmap, the bake, the export, the previews. |
| `zone_desk.py` | The desk at the back wall and the wordmark above it. |
| `zone_right.py` | The agents wall on the right wall and the shelf in the back-right corner. |
| `zone_lounge.py` | The holo table, the armchair, the lightbox on the front wall, the door. |
| `zone_window.py` | The window in the left wall, the star counter on its sill, the globe's floor stand, the corkboard. |
| `zone_corner.py` | The whiteboard on the back wall, the display for the repository on the left wall. |
| `bake_shell.py` | Walls, floor and ceiling, baked with every zone standing in them. |
| `fonts/` | Inter at two weights (SIL Open Font License 1.1), instanced from the variable font with overlapping contours removed, for lettering that is geometry (the wordmark). |

Each zone is baked into its own 2048 atlas in two states, night and dawn, and
exported as its own GLB.

## Building

Headless Blender 5, on the GPU:

```
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup --python zone_desk.py -- [flags]
"C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" --background --factory-startup --python bake_shell.py -- [flags]
node ../../scripts/build-world-assets.mjs
```

Flags after `--`:

| Flag | Effect |
|---|---|
| `--skip-bake` | Build, then fast lit renders from the zone's cameras (`out/lit_<zone>_<state>_<camera>.png`). The loop for modelling and for tuning the lights; a frame takes seconds. |
| `--samples N` | Bake samples (default 512, denoised). |
| `--regrade` | Reuse the cached float bakes in `cache/` when geometry and UVs did not change; redo grading, export and previews. |
| `--previews-only` | Only render the previews from what is in `out/`. |
| `--no-previews` | Skip the previews. |
| `--cameras a,b` | Override the preview cameras (names from `spec.CAMERAS`). |
| `--states night` | Only these states (default `night,dawn`). |

A zone's bake takes about three minutes. A zone is baked with the shell and
grey stand-ins for its neighbours, so that walls and neighbours cast and bounce
light. After a change to `common.py`, to the lights in `spec.py`, or to
anything large, bake every zone and the shell again: two bakes made with
different rigs do not meet at the seams.

`out/` and `cache/` are not committed; `cache/` grows to several gigabytes.

## What a zone's GLB contains

- One mesh named `Zone_<name>`, everything of the zone joined, with the
  material `Bake_<name>`. That material name is how the site finds the atlas.
- The zone's quads, each its own node with the spec's name. The model provides
  the object around a quad (the monitor's shell, the lightbox's frame); the
  site draws on the quad at run time.
- The zone's anchors, as empties.
- Nothing else: no cameras, lights, stand-ins or shell.

## Writing a zone

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # Blender does not add the script's folder
import common

def build():
    """Create this zone's objects in the current scene."""
    top = ...                          # modelling
    top.data.materials.append(common.mat("furniture_top"))
    common.make_quad("Wall_1")         # every quad of this zone, from the spec
    common.make_anchor("HoloCenter")   # every anchor of this zone, from the spec

if __name__ == "__main__":
    common.run_zone("right", build)
```

- `common.mat(key)` is the material for a palette key: matte, no textures.
  `common.emissive(key, strength)` is for an LED line or a status light.
- `common.make_quad(name)` and `common.make_anchor(name)` put the object
  exactly where the spec says. Never move, resize or re-UV a quad.
- `obj["texel"] = w` weights an object's share of the lightmap: 0.3 for what
  the camera never sees close, 2 or more for a close-up.
- Do not add lights in a zone: the rig is `spec.LIGHTS` plus the tuning in
  `common.py` (`RIG_SCALE`, `RIG_EXTRA`), and it is the same for every zone.

## Art direction

**A real room somebody works in at night.** Lived in, considered, calm, a
little obsessive about gear. Dark and quiet at night with a few strong sources
of light; at dawn the sun comes through the window.

- **Brand.** A neutral black room. Every surface is a neutral grey from the
  palette. One accent, blue, and only as light: a thin LED line, a status
  light. The only warm things are the gold wordmark, the lamps' light and the
  morning sun.
- **Form.** Matte and clean. Every edge is bevelled, nothing is a bare
  primitive, thicknesses and proportions are real: measure against a 0.74 m
  desk and a 2.0 m door.
- **Density.** Full of things, each there for a reason: cables that go
  somewhere, books that were read, a mug, a plant that is still alive. Detail
  belongs where the camera goes close.
- **Light does the work.** Albedos are dark to mid grey so that the baked light
  is the picture. The darkest surface the camera looks at still reads as a
  surface, and the brightest stays below clipping.
- **Nothing blocks a quad** from the cameras that look at it, and **the middle
  of the room is the camera's** (`CLEAR` in `spec.py`).
- Everything is modelled by these scripts from scratch: no downloaded assets,
  no asset libraries.
