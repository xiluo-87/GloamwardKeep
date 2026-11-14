"""Build original compact voxel bat and siege wagon models with simple named clips.

Run with Blender 4.5 LTS: blender -b --factory-startup --python build_misc.py.
All geometry and animation are authored here; no external assets or Python modules.
"""
import bpy
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PALETTE = {
    "fur": "#383b3a", "fur_light": "#56514a", "wing": "#59464a", "wing_dark": "#382e36",
    "wood": "#765239", "wood_light": "#987047", "iron": "#515856", "iron_light": "#78827c",
    "cargo": "#9a7548", "rope": "#c1a276", "eye": "#d57b45",
}


def srgb(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = srgb(color)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = srgb(color)
    shader.inputs["Roughness"].default_value = 1.0
    shader.inputs["Specular IOR Level"].default_value = .12
    return mat


def box(name, dims, location, mat, parent=None, bevel=.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Tiny voxel edge", "BEVEL")
        modifier.width = min(bevel, min(dims) * .18)
        modifier.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return obj


def empty(name, location=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    if parent:
        obj.parent = parent
    return obj


def action(obj, name, keys, *, rotation=True):
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 31
    for frame, value in keys:
        if rotation:
            obj.rotation_euler.z = value
            obj.keyframe_insert(data_path="rotation_euler", index=2, frame=frame, group=obj.name)
        else:
            obj.location.z = value
            obj.keyframe_insert(data_path="location", index=2, frame=frame, group=obj.name)
    act = obj.animation_data.action
    act.name = name
    for curve in act.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "AUTO_CLAMPED"
            point.handle_right_type = "AUTO_CLAMPED"
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, act)
    strip.action_frame_start = 1
    strip.action_frame_end = 31
    strip.frame_start = 1
    strip.blend_type = "REPLACE"
    obj.animation_data.action = None


def export_model(kind, root, moving_parts, report):
    dest = ROOT / "assets-src/models" / kind
    dest.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(dest / f"{kind}.blend"), check_existing=False)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(dest / f"{kind}.glb"), export_format="GLB",
        use_selection=True, export_texcoords=False, export_normals=True, export_materials="EXPORT",
        export_vertex_color="MATERIAL", export_animations=True, export_animation_mode="NLA_TRACKS",
        export_frame_range=False, export_force_sampling=True, export_skins=False,
        export_extras=True, export_optimize_animation_size=True, export_yup=True)
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in mesh_objects:
        obj.data.calc_loop_triangles()
    report.update({"blender": bpy.app.version_string, "kind": kind,
                   "vertices": sum(len(obj.data.vertices) for obj in mesh_objects),
                   "triangles": sum(len(obj.data.loop_triangles) for obj in mesh_objects),
                   "moving_parts": moving_parts,
                   "clips": ["Idle", "Walk", "Run", "Attack1", "Hit", "Death"],
                   "palette": PALETTE,
                   "art_status": "Original working voxel model for review; art acceptance remains open."})
    (dest / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("MISC_BUILD", json.dumps(report))


def animate_parts(parts, kind):
    clips = {
        "Idle": [(1, 0.0), (16, .025), (31, 0.0)],
        "Walk": [(1, 0.0), (8, .22), (16, 0.0), (24, -.22), (31, 0.0)],
        "Run": [(1, 0.0), (8, .34), (16, 0.0), (24, -.34), (31, 0.0)],
        "Attack1": [(1, 0.0), (9, .48), (17, -.1), (31, 0.0)],
        "Hit": [(1, 0.0), (5, -.25), (12, 0.0), (31, 0.0)],
        "Death": [(1, 0.0), (14, -1.15), (31, -1.15)],
    }
    for index, obj in enumerate(parts):
        for clip_name, values in clips.items():
            factor = 1 if index % 2 == 0 else -1
            # Wagons roll their wheel pivots; bats flap their broad square wings.
            if kind == "bat":
                keys = [(frame, value * factor) for frame, value in values]
            else:
                keys = [(frame, (frame - 1) / 30 * math.tau * factor if clip_name in ("Walk", "Run") else value * factor)
                        for frame, value in values]
            action(obj, clip_name, keys)


def build_bat():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {name: material(name, color) for name, color in PALETTE.items()}
    root = empty("Bat")
    box("Bat body", (.34, .42, .58), (0, 0, .55), mats["fur"], root)
    box("Bat muzzle", (.20, .18, .18), (0, .22, .48), mats["fur_light"], root)
    box("Bat nose", (.06, .04, .05), (0, .32, .48), mats["eye"], root, .002)
    for side in (-1, 1):
        box("Bat eye", (.055, .035, .07), (side * .095, .18, .63), mats["eye"], root, .002)
        box("Bat ear", (.10, .10, .25), (side * .12, .0, .91), mats["wing_dark"], root, .002)
        pivot = empty("Bat left wing" if side < 0 else "Bat right wing", (side * .15, -.04, .67), root)
        # Connected square panels give the silhouette a readable membrane-and-bone shape.
        box("Wing root", (.28, .09, .18), (side * .16, 0, .02), mats["wing_dark"], pivot, .003)
        box("Wing outer panel", (.40, .07, .12), (side * .46, 0, .02), mats["wing"], pivot, .003)
        box("Wing tip", (.24, .06, .09), (side * .72, 0, .04), mats["wing_dark"], pivot, .003)
        box("Wing lower edge", (.52, .05, .07), (side * .39, .01, -.08), mats["wing"], pivot, .002)
        bpy.context.view_layer.objects.active = pivot
        pivot.select_set(True)
        bpy.ops.object.select_all(action="DESELECT")
        pivot.select_set(True)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=False)
        # Local flap axis is X so the membrane rises and falls in the camera-facing plane.
        pivot.rotation_mode = "XYZ"
        pivot.rotation_euler.y = side * math.radians(12)
    left, right = [obj for obj in bpy.context.scene.objects if obj.name in ("Bat left wing", "Bat right wing")]
    # Animate the two pivots independently; the helper uses local Y rotation for flap spread.
    for obj, sign in ((left, -1), (right, 1)):
        for clip_name, amplitude in (("Idle", .06), ("Walk", .60), ("Run", .82),
                                     ("Attack1", .5), ("Hit", .2), ("Death", .02)):
            for frame, phase in ((1, 0), (8, 1), (16, 0), (24, -1), (31, 0)):
                obj.rotation_euler.y = sign * (math.radians(12) + amplitude * phase)
                obj.keyframe_insert(data_path="rotation_euler", index=1, frame=frame, group=obj.name)
            action_data = obj.animation_data.action
            action_data.name = clip_name
            for curve in action_data.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "BEZIER"
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            track = obj.animation_data.nla_tracks.new(); track.name = clip_name
            strip = track.strips.new(clip_name, 1, action_data); strip.frame_start = 1
            strip.action_frame_start = 1; strip.action_frame_end = 31
            obj.animation_data.action = None
    export_model("bat", root, ["paired square wings flap around shoulder pivots"],
                 {"design": "small night bat with charcoal square membrane wings", "source": "original Blender geometry"})


def build_wagon():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {name: material(name, color) for name, color in PALETTE.items()}
    root = empty("Siege wagon")
    box("Cart bed", (1.12, 1.54, .16), (0, -.04, .62), mats["wood"], root)
    for side in (-1, 1):
        box("Cart side rail", (1.20, .11, .55), (0, side * .69, .94), mats["wood_light"], root)
        box("Iron rail band", (1.22, .045, .10), (0, side * .75, 1.02), mats["iron"], root, .003)
    for x in (-.47, .47):
        box("Cart end board", (.11, 1.32, .54), (x, -.04, .92), mats["wood_light"], root)
    # Readable stacked cargo and a short square ram at the forward end.
    box("Cargo crate lower", (.48, .48, .42), (-.18, -.06, .92), mats["cargo"], root)
    box("Cargo crate lid", (.53, .53, .09), (-.18, -.06, 1.17), mats["wood_light"], root, .003)
    box("Cargo bundle", (.40, .38, .34), (.18, .10, .99), mats["rope"], root)
    box("Ram shaft", (.20, .78, .20), (.02, -.92, .66), mats["wood"], root)
    box("Ram head", (.44, .27, .40), (.02, -1.37, .66), mats["iron"], root)
    box("Ram face", (.30, .05, .28), (.02, -1.53, .66), mats["iron_light"], root, .004)
    wheels = []
    for side in (-1, 1):
        for fore in (-1, 1):
            pivot = empty("Wagon wheel pivot", (side * .63, fore * .43, .42), root)
            # Faceted square wheel rim built from connected rectangular spokes and hub.
            box("Wheel rim", (.16, .62, .62), (0, 0, 0), mats["wood"], pivot, .004)
            box("Wheel hub", (.22, .18, .18), (0, 0, 0), mats["iron"], pivot, .003)
            box("Wheel spoke", (.18, .48, .11), (0, 0, 0), mats["wood_light"], pivot, .003)
            box("Wheel cross spoke", (.18, .11, .48), (0, 0, 0), mats["wood_light"], pivot, .003)
            for corner in (-1, 1):
                box("Iron wheel pin", (.19, .05, .05), (0, corner * .23, corner * .23), mats["iron_light"], pivot, .002)
            wheels.append(pivot)
    # Each wheel rotates about its axle (local Y); the animation tracks remain independent.
    for index, wheel in enumerate(wheels):
        sign = -1 if index % 2 else 1
        for clip_name, turns in (("Idle", .015), ("Walk", .5), ("Run", 1.0),
                                 ("Attack1", .12), ("Hit", -.08), ("Death", .01)):
            for frame, portion in ((1, 0), (16, .5), (31, 1)):
                wheel.rotation_euler.y = sign * turns * math.tau * portion
                wheel.keyframe_insert(data_path="rotation_euler", index=1, frame=frame, group=wheel.name)
            act = wheel.animation_data.action; act.name = clip_name
            for curve in act.fcurves:
                for point in curve.keyframe_points: point.interpolation = "LINEAR"
            bpy.ops.object.select_all(action="DESELECT"); wheel.select_set(True)
            bpy.context.view_layer.objects.active = wheel
            track = wheel.animation_data.nla_tracks.new(); track.name = clip_name
            strip = track.strips.new(clip_name, 1, act); strip.frame_start = 1
            strip.action_frame_start = 1; strip.action_frame_end = 31
            wheel.animation_data.action = None
    export_model("wagon", root, ["four square voxel wheels rotate on axles"],
                 {"design": "compact timber siege cart with iron ram and cargo", "source": "original Blender geometry"})


if __name__ == "__main__":
    requested = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["all"]
    if requested == ["all"]:
        build_bat(); build_wagon()
    else:
        for kind in requested:
            if kind == "bat": build_bat()
            elif kind == "wagon": build_wagon()
            else: raise SystemExit(f"unknown model {kind!r}")
