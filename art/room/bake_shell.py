# ruff: noqa: E501
"""Bake the shell with every zone standing in it, export out/shell.glb, render the room previews.

blender --background --factory-startup --python bake_shell.py -- [--standins] [--samples N] [--skip-bake] [--previews-only] [--regrade]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

if __name__ == "__main__":
    common.run_shell()
