#!/usr/bin/env python3
"""Create palette-only, editable adaptations of four licensed pack characters.

Run in the project Blender 4.5.16:
  Blender --background --python assets-src/rework/pipeline/adapt_pack.py

Existing .blend files are never overwritten unless --force is passed. The script
does not edit geometry, rig hierarchy, skin weights, object transforms, or clips.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import sys
import tempfile
from collections import Counter
from pathlib import Path

import bpy


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
PIPELINE = ROOT / "assets-src" / "pipeline"
OUT = ROOT / "assets-src" / "rework" / "proof" / "characters"
sys.path.insert(0, str(PIPELINE))
import gltf_tools  # noqa: E402


ASSETS = {
    "goblin": {
        "source": "assets-src/studies/goblin-shaman/editor-preview.glb",
        "palette": {
            "skin-shadow": "#4d6533", "skin": "#778f44", "skin-light": "#96a65c",
            "cloth-shadow": "#424b39", "cloth": "#65714d", "cloth-light": "#89936d",
            "leather-dark": "#4e3b2a", "leather": "#79573a", "leather-light": "#9a7650",
            "metal-dark": "#5d6565", "metal": "#929391", "stone-light": "#b9b9b3",
            "tooth": "#d8cba9", "eye": "#22251f",
        },
    },
    "orc": {
        "source": "blocky-pack/dcc/tiny-characters-blocky-orc.glb",
        "palette": {
            "skin-shadow": "#4b6331", "skin": "#718b3d", "skin-light": "#94a44f",
            "cloth-shadow": "#4b392d", "cloth": "#79503b", "cloth-light": "#9a7150",
            "leather-dark": "#4e3b2a", "leather": "#79573a", "leather-light": "#9a7650",
            "metal-dark": "#5d6565", "metal": "#929391", "stone-light": "#b9b9b3",
            "tooth": "#d8cba9", "eye": "#22251f",
        },
    },
    "troll": {
        "source": "blocky-pack/dcc/tiny-characters-blocky-hill-troll.glb",
        "palette": {
            "skin-shadow": "#596241", "skin": "#7c8350", "skin-light": "#9a9b68",
            "cloth-shadow": "#453e31", "cloth": "#6e5b40", "cloth-light": "#927b55",
            "leather-dark": "#4e3b2a", "leather": "#79573a", "leather-light": "#9a7650",
            "metal-dark": "#5d6565", "metal": "#929391", "stone-light": "#b9b9b3",
            "tooth": "#d8cba9", "eye": "#22251f",
        },
    },
    "archer-crew": {
        "source": "blocky-pack/dcc/tiny-characters-blocky-hood-archer.glb",
        "palette": {
            "skin-shadow": "#765b45", "skin": "#a18060", "skin-light": "#c3a584",
            "cloth-shadow": "#3e4d56", "clothcrew": "#576875", "cloth-light": "#78858a",
            "leather-dark": "#4e3b2a", "leather": "#79573a", "leather-light": "#987349",
            "metal-dark": "#5d6565", "metal": "#929391", "stone-light": "#b9b9b3",
            "tooth": "#ded1b3", "eye": "#211f1d",
        },
    },
}


def srgb_channel_to_linear(value: float) -> float:
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def hex_rgb(value: str) -> tuple[float, float, float]:
    raw = value.removeprefix("#")
    return tuple(int(raw[i:i + 2], 16) / 255 for i in (0, 2, 4))


def linear_to_srgb(value: float) -> float:
    return 12.92 * value if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055


def oklab(rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    r, g, b = (srgb_channel_to_linear(c) for c in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def remap_colors(mesh: bpy.types.Mesh, palette: dict[str, str]) -> dict:
    attributes = mesh.color_attributes
    attribute = attributes.active_color or next((item for item in attributes if item.domain in {"POINT", "CORNER"}), None)
    if attribute is None:
        raise RuntimeError(f"{mesh.name} has no source color attribute")
    source_colors = {tuple(round(float(channel), 5) for channel in element.color_srgb[:3]) for element in attribute.data}
    targets = [(name, value, hex_rgb(value), oklab(hex_rgb(value))) for name, value in palette.items()]
    used = Counter()
    mapping: dict[str, str] = {}
    for element in attribute.data:
        source = tuple(float(channel) for channel in element.color_srgb[:3])
        source_lab = oklab(source)
        name, _, rgb, _ = min(targets, key=lambda target: sum((source_lab[i] - target[3][i]) ** 2 for i in range(3)))
        key = ",".join(str(round(channel * 255)) for channel in source)
        mapping[key] = palette[name]
        used[name] += 1
        element.color_srgb = (*rgb, float(element.color_srgb[3]))
    mesh.color_attributes.active_color = attribute
    mesh["gloamwardPaletteMap"] = json.dumps(mapping, sort_keys=True, separators=(",", ":"))
    return {"attribute": attribute.name, "domain": attribute.domain, "dataType": attribute.data_type,
            "elements": len(attribute.data), "sourceColors": len(source_colors),
            "mappedColors": len(used), "paletteUse": dict(used), "mapping": mapping}


def scene_objects() -> tuple[bpy.types.Object, bpy.types.Object]:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.vertex_groups]
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if len(meshes) != 1 or len(armatures) != 1:
        raise RuntimeError(f"expected one skinned mesh and one armature, got {len(meshes)} / {len(armatures)}")
    return meshes[0], armatures[0]


def imported_metrics(mesh_obj: bpy.types.Object, armature: bpy.types.Object) -> dict:
    mesh_obj.data.calc_loop_triangles()
    weights = 0
    for vertex in mesh_obj.data.vertices:
        for assignment in vertex.groups:
            if not math.isfinite(assignment.weight) or assignment.weight < 0:
                raise RuntimeError("source mesh contains invalid weights")
            weights += 1
    clips = sorted(action.name for action in bpy.data.actions)
    return {"meshName": mesh_obj.name, "vertices": len(mesh_obj.data.vertices),
            "triangles": len(mesh_obj.data.loop_triangles), "joints": len(armature.data.bones),
            "weightedAssignments": weights, "clips": clips}


def geometry_signature(mesh: bpy.types.Mesh) -> str:
    digest = hashlib.sha256()
    digest.update(struct.pack("<III", len(mesh.vertices), len(mesh.loops), len(mesh.polygons)))
    for vertex in mesh.vertices:
        digest.update(struct.pack("<fff", *(float(component) for component in vertex.co)))
    for loop in mesh.loops:
        digest.update(struct.pack("<I", loop.vertex_index))
    for polygon in mesh.polygons:
        digest.update(struct.pack("<I", len(polygon.loop_indices)))
        for loop_index in polygon.loop_indices:
            digest.update(struct.pack("<I", loop_index))
    return digest.hexdigest()


def rig_signature(mesh_obj: bpy.types.Object, armature: bpy.types.Object) -> str:
    digest = hashlib.sha256()
    objects = {mesh_obj, armature}
    for obj in (mesh_obj, armature):
        parent = obj.parent
        while parent is not None:
            objects.add(parent)
            parent = parent.parent
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(obj.name.encode())
        digest.update(obj.type.encode())
        for row in obj.matrix_local:
            digest.update(struct.pack("<ffff", *(float(component) for component in row)))
        if obj.type == "MESH":
            for modifier in obj.modifiers:
                digest.update(f"{modifier.name}:{modifier.type}:{getattr(modifier.object, 'name', '')}".encode())
            for group in obj.vertex_groups:
                digest.update(f"{group.index}:{group.name}:{int(group.lock_weight)}".encode())
            for vertex in obj.data.vertices:
                digest.update(struct.pack("<I", vertex.index))
                for assignment in sorted(vertex.groups, key=lambda item: item.group):
                    digest.update(struct.pack("<If", assignment.group, float(assignment.weight)))
    for bone in armature.data.bones:
        digest.update(bone.name.encode())
        digest.update((bone.parent.name if bone.parent else "").encode())
        digest.update(bytes((int(bone.use_deform),)))
        for value in (*bone.head_local, *bone.tail_local):
            digest.update(struct.pack("<f", float(value)))
        for row in bone.matrix_local:
            digest.update(struct.pack("<ffff", *(float(component) for component in row)))
    for action in sorted(bpy.data.actions, key=lambda item: item.name):
        digest.update(action.name.encode())
        digest.update(struct.pack("<ff", *action.frame_range))
        for curve in action.fcurves:
            digest.update(f"{curve.data_path}:{curve.array_index}".encode())
            for modifier in curve.modifiers:
                digest.update(f"{modifier.type}:{int(modifier.mute)}".encode())
            for point in curve.keyframe_points:
                digest.update(struct.pack("<ffffff", float(point.co[0]), float(point.co[1]),
                                          float(point.handle_left[0]), float(point.handle_left[1]),
                                          float(point.handle_right[0]), float(point.handle_right[1])))
                digest.update(f"{point.interpolation}:{point.handle_left_type}:{point.handle_right_type}:{point.type}".encode())
    for obj in sorted(objects, key=lambda item: item.name):
        animation_data = obj.animation_data
        if animation_data is None:
            continue
        for track in animation_data.nla_tracks:
            digest.update(f"NLA:{obj.name}:{track.name}:{int(track.mute)}:{int(track.is_solo)}".encode())
            for strip in track.strips:
                digest.update(f"{strip.name}:{getattr(strip.action, 'name', '')}:{strip.blend_type}:{strip.extrapolation}:{int(strip.mute)}".encode())
                for attribute in ("frame_start", "frame_end", "action_frame_start", "action_frame_end", "scale", "repeat", "influence"):
                    digest.update(struct.pack("<f", float(getattr(strip, attribute))))
    return digest.hexdigest()


def source_vertex_color_keys(document: dict, binary: bytes) -> list[str]:
    accessors = []
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            color_index = primitive.get("attributes", {}).get("COLOR_0")
            if color_index is not None:
                accessors.append((color_index, primitive["attributes"]["POSITION"]))
    if len(accessors) != 1:
        raise RuntimeError(f"expected one source COLOR_0 accessor, found {len(accessors)}")
    color_index, position_index = accessors[0]
    colors = gltf_tools.read_accessor(document, binary, color_index)
    positions = gltf_tools.read_accessor(document, binary, position_index)
    if len(colors) != len(positions):
        raise RuntimeError("source COLOR_0 and POSITION vertex counts differ")
    result = []
    for color in colors:
        rgb = [max(0.0, min(1.0, linear_to_srgb(float(channel)))) for channel in color[:3]]
        result.append(",".join(str(round(channel * 255)) for channel in rgb))
    return result


def current_vertex_colors(mesh_obj: bpy.types.Object) -> list[str]:
    mesh = mesh_obj.data
    if mesh.get("gloamwardGeometrySignature") != geometry_signature(mesh):
        raise RuntimeError("palette export refused: mesh positions/topology changed from the initialized source")
    attributes = mesh.color_attributes
    attribute = attributes.active_color
    if attribute is None or attribute.domain not in {"POINT", "CORNER"}:
        raise RuntimeError("palette export requires the initialized POINT or CORNER color attribute")
    if attribute.domain == "POINT":
        if len(attribute.data) != len(mesh.vertices):
            raise RuntimeError("palette export refused: POINT color count no longer matches vertices")
        return ["#" + "".join(f"{round(float(channel) * 255):02x}" for channel in item.color_srgb[:3])
                for item in attribute.data]

    expected_loops = json.loads(mesh.get("gloamwardLoopVertexIndices", "[]"))
    current_loops = [loop.vertex_index for loop in mesh.loops]
    if current_loops != expected_loops or len(attribute.data) != len(mesh.loops):
        raise RuntimeError("palette export refused: CORNER loop topology differs from initialization")
    colors: list[tuple[int, int, int] | None] = [None] * len(mesh.vertices)
    for loop_index, loop in enumerate(mesh.loops):
        color = tuple(round(max(0.0, min(1.0, float(channel))) * 255) for channel in attribute.data[loop_index].color_srgb[:3])
        previous = colors[loop.vertex_index]
        if previous is not None and previous != color:
            raise RuntimeError(f"palette export refused: vertex {loop.vertex_index} has conflicting corner colors; split vertices first")
        colors[loop.vertex_index] = color
    if any(color is None for color in colors):
        raise RuntimeError("palette export refused: found a mesh vertex with no color loop")
    return ["#" + "".join(f"{channel:02x}" for channel in color) for color in colors if color is not None]


def save_blend(mesh_obj: bpy.types.Object, armature: bpy.types.Object, metadata: dict,
               source_color_keys: list[str], path: Path) -> None:
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    export_set = {obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "ARMATURE"}}
    export_set = {obj for obj in export_set if not obj.name.startswith("Icosphere")}
    for obj in list(export_set):
        parent = obj.parent
        while parent is not None:
            export_set.add(parent)
            parent = parent.parent
    marker = next((obj for obj in bpy.context.scene.objects if obj.type == "EMPTY" and obj.parent is None), armature)
    marker["gloamwardRework"] = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    mesh_obj["gloamwardRework"] = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    armature["gloamwardRework"] = json.dumps(metadata, sort_keys=True, separators=(",", ":"))
    mesh_obj["gloamwardPaletteOnly"] = True
    mesh_obj["gloamwardSource"] = metadata["source"]
    mesh_obj.data["gloamwardSourceVertexColorKeys"] = json.dumps(source_color_keys, separators=(",", ":"))
    mesh_obj.data["gloamwardLoopVertexIndices"] = json.dumps([loop.vertex_index for loop in mesh_obj.data.loops], separators=(",", ":"))
    mesh_obj.data["gloamwardGeometrySignature"] = geometry_signature(mesh_obj.data)
    mesh_obj.data["gloamwardRigSignature"] = rig_signature(mesh_obj, armature)
    for obj in export_set:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True)


def clip_metrics(document: dict, binary: bytes) -> dict:
    return gltf_tools._metrics(document, binary)


def primitive_triangles(document: dict, binary: bytes) -> int:
    triangles = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            if primitive.get("mode", 4) != 4:
                raise RuntimeError("expected triangle-list geometry")
            attributes = primitive.get("attributes", {})
            positions = gltf_tools.read_accessor(document, binary, attributes["POSITION"])
            if "indices" in primitive:
                index_values = gltf_tools.read_accessor(document, binary, primitive["indices"], normalized=False)
                triangles += len(index_values) // 3
            else:
                triangles += len(positions) // 3
    return triangles


def patch_runtime_glb(source_bytes: bytes, vertex_colors: list[str], metadata: dict) -> tuple[bytes, dict]:
    document, binary, extras = gltf_tools.parse_glb(source_bytes)
    patched_binary = bytearray(binary)
    patched_colors = 0
    mapped_keys: set[str] = set()
    seen_accessors: set[int] = set()
    color_byte_offsets: set[int] = set()
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor_index = primitive.get("attributes", {}).get("COLOR_0")
            if accessor_index is None or accessor_index in seen_accessors:
                continue
            seen_accessors.add(accessor_index)
            accessor = document["accessors"][accessor_index]
            component_type, components, fmt, component_size = gltf_tools._accessor_shape(accessor, accessor_index)
            if components not in (3, 4) or "bufferView" not in accessor or accessor.get("sparse"):
                raise RuntimeError(f"unsupported COLOR_0 accessor {accessor_index}")
            if accessor["count"] != len(vertex_colors):
                raise RuntimeError(f"COLOR_0 count {accessor['count']} differs from saved Blender vertex count {len(vertex_colors)}")
            view = document["bufferViews"][accessor["bufferView"]]
            stride = view.get("byteStride", components * component_size)
            offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            component_scale = 1.0
            if component_type == 5126:
                pack_format = "f"
            elif accessor.get("normalized") and component_type == 5121:
                pack_format, component_scale = "B", 255.0
            elif accessor.get("normalized") and component_type == 5123:
                pack_format, component_scale = "H", 65535.0
            else:
                raise RuntimeError(f"unsupported COLOR_0 component type {component_type}")
            output_values = []
            for item in range(accessor["count"]):
                item_offset = offset + item * stride
                source_values = struct.unpack_from("<" + fmt * components, patched_binary, item_offset)
                target_hex = vertex_colors[item]
                mapped_keys.add(target_hex)
                target_linear = [srgb_channel_to_linear(value) for value in hex_rgb(target_hex)]
                output_values.extend(target_linear)
                if components == 4:
                    output_values.append(float(source_values[3]))
                encoded = [int(round(value * component_scale)) if component_type != 5126 else value for value in output_values[-components:]]
                struct.pack_into("<" + pack_format * components, patched_binary, item_offset, *encoded)
                color_byte_offsets.update(range(item_offset, item_offset + components * component_size))
                patched_colors += 1
            if output_values:
                values = [output_values[i:i + components] for i in range(0, len(output_values), components)]
                accessor["min"] = [min(row[i] for row in values) for i in range(components)]
                accessor["max"] = [max(row[i] for row in values) for i in range(components)]
    if not seen_accessors:
        raise RuntimeError("source GLB has no COLOR_0 accessor")

    marker = dict(metadata)
    marker["sourceColorCount"] = len(mapped_keys)
    marker["currentColors"] = sorted(mapped_keys)
    for node in document.get("nodes", []):
        if "mesh" in node or node in document.get("scenes", [{}])[document.get("scene", 0)].get("nodes", []):
            node.setdefault("extras", {})["gloamwardRework"] = marker
    changed_offsets = {index for index, (before, after) in enumerate(zip(binary, patched_binary)) if before != after}
    if not changed_offsets.issubset(color_byte_offsets):
        raise RuntimeError("runtime patch changed bytes outside COLOR_0 accessor storage")
    return gltf_tools.serialize_glb(document, bytes(patched_binary), extras), {
        "patchedColorValues": patched_colors,
        "sourceColorsMapped": len(mapped_keys),
        "binaryChangedBytes": len(changed_offsets),
        "nonColorBinaryUnchanged": True,
    }


def validate_skin(document: dict, binary: bytes) -> dict:
    joint_counts = [len(skin.get("joints", [])) for skin in document.get("skins", [])]
    weight_vertices = 0
    min_sum, max_sum = float("inf"), 0.0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            attrs = primitive.get("attributes", {})
            if "JOINTS_0" not in attrs or "WEIGHTS_0" not in attrs:
                continue
            joints = gltf_tools.read_accessor(document, binary, attrs["JOINTS_0"], normalized=False)
            weights = gltf_tools.read_accessor(document, binary, attrs["WEIGHTS_0"])
            if len(joints) != len(weights):
                raise RuntimeError("joint/weight accessor counts differ")
            for joint_row, weight_row in zip(joints, weights):
                if any(not math.isfinite(float(weight)) or weight < 0 for weight in weight_row):
                    raise RuntimeError("non-finite or negative skin weight")
                if any(int(joint) >= max(joint_counts, default=0) for joint in joint_row):
                    raise RuntimeError("skin joint index is outside the source skeleton")
                total = sum(weight_row)
                if not 0.98 <= total <= 1.02:
                    raise RuntimeError(f"skin weights sum to {total:g}, expected 1")
                min_sum, max_sum = min(min_sum, total), max(max_sum, total)
                weight_vertices += 1
    return {"jointCounts": joint_counts, "weightVertices": weight_vertices,
            "weightSumRange": [min_sum if math.isfinite(min_sum) else None, max_sum]}


def pose_bounds(mesh_obj: bpy.types.Object, armature: bpy.types.Object, clip: str, seconds: float) -> list[float]:
    action = bpy.data.actions.get(clip)
    if action is None:
        raise RuntimeError(f"missing animation action {clip!r}")
    armature.animation_data_create()
    armature.animation_data.action = action
    slots = getattr(action, "slots", None)
    if slots and hasattr(armature.animation_data, "action_slot"):
        armature.animation_data.action_slot = slots[0]
    fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    start = action.frame_range[0]
    frame = round(start + seconds * fps)
    bpy.context.scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    evaluated = mesh_obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    points = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    evaluated.to_mesh_clear()
    return [min(point[axis] for point in points) for axis in range(3)] + [max(point[axis] for point in points) for axis in range(3)]


def pose_samples(mesh_obj: bpy.types.Object, armature: bpy.types.Object) -> dict:
    return {f"{clip}@{seconds:.1f}": pose_bounds(mesh_obj, armature, clip, seconds)
            for clip in ("Walk", "Attack1") for seconds in (0.0, 0.2, 0.5)}


def export_existing(name: str, blend_path: Path | None = None,
                    runtime_path: Path | None = None, report_path: Path | None = None,
                    write_report: bool = True) -> dict:
    spec = ASSETS[name]
    source_path = ROOT / spec["source"]
    blend_path = blend_path or OUT / f"{name}.blend"
    runtime_path = runtime_path or OUT / f"{name}.glb"
    if report_path is None and write_report:
        report_path = OUT / f"{name}.json"
    if not blend_path.exists():
        raise RuntimeError(f"editable source does not exist: {blend_path}")
    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    mesh_obj, armature = scene_objects()
    metadata = json.loads(mesh_obj.get("gloamwardRework", "{}"))
    source_bytes = source_path.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    if metadata.get("sourceSha256") != source_hash or metadata.get("source") != spec["source"]:
        raise RuntimeError("palette export refused: saved Blender source does not match the configured original GLB")
    if mesh_obj.data.get("gloamwardRigSignature") != rig_signature(mesh_obj, armature):
        raise RuntimeError("palette export refused: rig, object transforms, or animation clips changed")
    source_document, source_binary, _ = gltf_tools.parse_glb(source_bytes)
    source_keys = json.loads(mesh_obj.data.get("gloamwardSourceVertexColorKeys", "[]"))
    expected_loops = json.loads(mesh_obj.data.get("gloamwardLoopVertexIndices", "[]"))
    source_colors = source_vertex_color_keys(source_document, source_binary)
    if source_keys != source_colors or len(source_keys) != len(mesh_obj.data.vertices):
        raise RuntimeError("palette export refused: original per-vertex color/mesh mapping is invalid")
    if expected_loops != [loop.vertex_index for loop in mesh_obj.data.loops]:
        raise RuntimeError("palette export refused: source loop-to-vertex mapping changed")
    vertex_colors = current_vertex_colors(mesh_obj)
    if len(vertex_colors) != len(source_keys):
        raise RuntimeError("palette export refused: vertex color count differs from source")
    blend_metrics = imported_metrics(mesh_obj, armature)
    initial_color_stats = json.loads(mesh_obj.get("gloamwardColorStats", "{}"))
    if not initial_color_stats:
        initial_color_stats = {"sourceColors": len(set(source_keys)), "mappedColors": len(set(vertex_colors)),
                               "elements": len(mesh_obj.data.color_attributes.active_color.data),
                               "note": "current unique colors derived from the editable Blender color attribute"}
    source_pose = pose_samples(mesh_obj, armature)
    metadata["currentColors"] = sorted(set(vertex_colors))
    metadata["sourceMeshName"] = mesh_obj.name
    runtime_bytes, patch_metrics = patch_runtime_glb(source_bytes, vertex_colors, metadata)
    runtime_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_path.write_bytes(runtime_bytes)
    output_document, output_binary, _ = gltf_tools.parse_glb(runtime_bytes)
    output_metrics = clip_metrics(output_document, output_binary)
    source_metrics = clip_metrics(source_document, source_binary)
    source_triangles = primitive_triangles(source_document, source_binary)
    output_triangles = primitive_triangles(output_document, output_binary)
    if source_triangles != output_triangles:
        raise RuntimeError(f"{name}: runtime triangle count differs from source")
    if source_document.get("animations") != output_document.get("animations"):
        raise RuntimeError(f"{name}: animation data differs from source GLB")
    if source_document.get("skins") != output_document.get("skins"):
        raise RuntimeError(f"{name}: skin data differs from source GLB")
    source_skin = validate_skin(source_document, source_binary)
    output_skin = validate_skin(output_document, output_binary)
    if source_skin["jointCounts"] != output_skin["jointCounts"]:
        raise RuntimeError(f"{name}: joint counts differ from source")
    if not patch_metrics["nonColorBinaryUnchanged"]:
        raise RuntimeError(f"{name}: runtime patch changed non-color binary bytes")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(runtime_path))
    output_mesh, output_armature = scene_objects()
    output_pose = pose_samples(output_mesh, output_armature)
    pose_error = {key: max(abs(a - b) for a, b in zip(source_pose[key], output_pose[key])) for key in source_pose}
    if max(pose_error.values(), default=0) > 1e-3:
        raise RuntimeError(f"{name}: animated world bounds differ from source: {pose_error}")

    actual_root_extras = any("gloamwardRework" in obj for obj in output_mesh.users_scene[0].objects) if output_mesh.users_scene else False
    report = {
        "asset": name,
        "sourcePath": spec["source"],
        "sourceSha256": source_hash,
        "pipeline": str(SCRIPT.relative_to(ROOT)),
        "pipelineSha256": hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
        "adaptation": "vertex-color-remap-only; original mesh topology, skin weights, rig hierarchy, transforms, and clips retained",
        "palette": metadata.get("palette", {}),
        "colorAttribute": {**initial_color_stats, "currentColors": metadata["currentColors"]},
        "sourceMetrics": {"mesh": blend_metrics, "gltf": source_metrics,
                          "skin": source_skin, "triangles": source_triangles},
        "output": {"gltf": output_metrics, "skin": output_skin, "triangles": output_triangles,
                   "triangleCountMatchesSource": True, "markerPresent": actual_root_extras,
                   "nonColorBinaryUnchanged": patch_metrics["nonColorBinaryUnchanged"], "patch": patch_metrics},
        "poseBoundsSeconds": {"samples": source_pose, "maxCoordinateError": pose_error},
        "runtimeMethod": "source GLB COLOR_0 patch derived from current saved Blender vertex colors; gltf_tools parse/serialize validation only",
        "limitation": "Blender 4.5.16 GLB re-export altered source mesh/root bind transforms. Runtime therefore patches the original source GLB; geometry edits/export remain unverified.",
        "files": {"blend": blend_path.name, "glb": runtime_path.name},
        "editableBlend": "Current color attributes are read on each --export-existing run. Geometry, topology, rig, transforms, and clips must remain unchanged.",
    }
    if write_report and report_path is not None:
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"asset": name, "triangles": output_triangles, "joints": output_skin["jointCounts"],
                      "clips": len(output_metrics["clip_names"]), "maxPoseError": max(pose_error.values(), default=0),
                      "currentColors": len(set(vertex_colors)), "glbBytes": runtime_path.stat().st_size}, sort_keys=True))
    return report


def adapt(name: str, force: bool) -> dict:
    spec = ASSETS[name]
    source_path = ROOT / spec["source"]
    blend_path = OUT / f"{name}.blend"
    if not force and (blend_path.exists() or (OUT / f"{name}.glb").exists() or (OUT / f"{name}.json").exists()):
        raise RuntimeError(f"refusing to replace existing proof output for {name}; pass --force explicitly")
    source_bytes = source_path.read_bytes()
    source_document, source_binary, _ = gltf_tools.parse_glb(source_bytes)
    source_metrics = clip_metrics(source_document, source_binary)
    source_keys = source_vertex_color_keys(source_document, source_binary)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    mesh_obj, armature = scene_objects()
    pre = imported_metrics(mesh_obj, armature)
    if len(source_keys) != len(mesh_obj.data.vertices):
        raise RuntimeError(f"{name}: Blender source mesh vertex count does not match GLB COLOR_0")
    mesh_color = remap_colors(mesh_obj.data, spec["palette"])
    metadata = {
        "source": spec["source"],
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "adaptation": "vertex-color-remap-only",
        "palette": spec["palette"],
        "sourceMeshName": mesh_obj.name,
        "vertices": pre["vertices"],
        "triangles": pre["triangles"],
        "joints": pre["joints"],
        "clips": source_metrics["clip_names"],
    }
    color_record = {"attribute": mesh_color["attribute"], "domain": mesh_color["domain"],
                    "dataType": mesh_color["dataType"], "elements": mesh_color["elements"],
                    "sourceColors": mesh_color["sourceColors"], "mappedColors": mesh_color["mappedColors"],
                    "paletteUse": mesh_color["paletteUse"]}
    mesh_obj["gloamwardColorStats"] = json.dumps(color_record, sort_keys=True, separators=(",", ":"))
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    save_blend(mesh_obj, armature, metadata, source_keys, blend_path)
    return export_existing(name, blend_path=blend_path)


def test_paint_roundtrip(name: str) -> dict:
    source_blend = OUT / f"{name}.blend"
    if not source_blend.exists():
        raise RuntimeError(f"editable source does not exist: {source_blend}")
    with tempfile.TemporaryDirectory(prefix=f"gloamward-{name}-paint-") as temp_dir:
        temp_dir = Path(temp_dir)
        temp_blend, temp_glb = temp_dir / f"{name}-paint.blend", temp_dir / f"{name}-paint.glb"
        shutil.copyfile(source_blend, temp_blend)
        bpy.ops.wm.open_mainfile(filepath=str(temp_blend))
        mesh_obj, _ = scene_objects()
        source_keys = json.loads(mesh_obj.data["gloamwardSourceVertexColorKeys"])
        target_key, _ = Counter(source_keys).most_common(1)[0]
        vertex_ids = {index for index, key in enumerate(source_keys) if key == target_key}
        attribute = mesh_obj.data.color_attributes.active_color
        if attribute.domain == "POINT":
            for vertex_id in vertex_ids:
                attribute.data[vertex_id].color_srgb = (0.91, 0.27, 0.46, 1.0)
        elif attribute.domain == "CORNER":
            for loop_index, loop in enumerate(mesh_obj.data.loops):
                if loop.vertex_index in vertex_ids:
                    attribute.data[loop_index].color_srgb = (0.91, 0.27, 0.46, 1.0)
        else:
            raise RuntimeError(f"unsupported color domain for test: {attribute.domain}")
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(temp_blend), compress=True)
        report = export_existing(name, blend_path=temp_blend, runtime_path=temp_glb, write_report=False)

        baseline_document, baseline_binary, _ = gltf_tools.parse_glb((OUT / f"{name}.glb").read_bytes())
        output_document, output_binary, _ = gltf_tools.parse_glb(temp_glb.read_bytes())
        source_accessor = baseline_document["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"]
        output_accessor = output_document["meshes"][0]["primitives"][0]["attributes"]["COLOR_0"]
        before = gltf_tools.read_accessor(baseline_document, baseline_binary, source_accessor)
        after = gltf_tools.read_accessor(output_document, output_binary, output_accessor)
        changed = [index for index, (left, right) in enumerate(zip(before, after)) if left != right]
        if changed != sorted(vertex_ids):
            raise RuntimeError(f"paint roundtrip changed vertices {changed[:8]}, expected {sorted(vertex_ids)[:8]}")
        if not report["output"]["nonColorBinaryUnchanged"]:
            raise RuntimeError("paint roundtrip changed source bytes outside the color accessor")
        result = {"asset": name, "paintedSourceColorGroup": target_key, "changedVertices": len(changed),
                  "changedVertexIndices": changed[:16], "nonColorBinaryUnchanged": True,
                  "poseBoundsError": report["poseBoundsSeconds"]["maxCoordinateError"]}
        print("PAINT_ROUNDTRIP", json.dumps(result, sort_keys=True))
        return result


def upgrade_integrity(name: str) -> dict:
    """Add v2 geometry/rig baselines to an existing initial proof blend, preserving colors."""
    blend_path = OUT / f"{name}.blend"
    source_path = ROOT / ASSETS[name]["source"]
    if not blend_path.exists():
        raise RuntimeError(f"editable source does not exist: {blend_path}")
    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    mesh_obj, armature = scene_objects()
    expected_geometry = geometry_signature(mesh_obj.data)
    expected_rig = rig_signature(mesh_obj, armature)
    source_bytes = source_path.read_bytes()
    source_document, source_binary, _ = gltf_tools.parse_glb(source_bytes)
    source_keys = source_vertex_color_keys(source_document, source_binary)
    if len(source_keys) != len(mesh_obj.data.vertices):
        raise RuntimeError("cannot upgrade integrity baseline: source vertex count differs")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(source_path))
    original_mesh, original_armature = scene_objects()
    if geometry_signature(original_mesh.data) != expected_geometry or rig_signature(original_mesh, original_armature) != expected_rig:
        raise RuntimeError("cannot upgrade integrity baseline: existing blend geometry/rig differs from original source")

    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    mesh_obj, armature = scene_objects()
    mesh_obj.data["gloamwardSourceVertexColorKeys"] = json.dumps(source_keys, separators=(",", ":"))
    mesh_obj.data["gloamwardLoopVertexIndices"] = json.dumps([loop.vertex_index for loop in mesh_obj.data.loops], separators=(",", ":"))
    mesh_obj.data["gloamwardGeometrySignature"] = geometry_signature(mesh_obj.data)
    mesh_obj.data["gloamwardRigSignature"] = rig_signature(mesh_obj, armature)
    attribute = mesh_obj.data.color_attributes.active_color
    current = {"sourceColors": len(set(source_keys)),
               "mappedColors": len({tuple(round(float(c) * 255) for c in item.color_srgb[:3]) for item in attribute.data}),
               "elements": len(attribute.data),
               "note": "color-paint output is read live; this baseline upgrade preserved the existing attribute"}
    mesh_obj["gloamwardColorStats"] = json.dumps(current, sort_keys=True, separators=(",", ":"))
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
    result = {"asset": name, "blend": blend_path.name, "geometrySignature": mesh_obj.data["gloamwardGeometrySignature"],
              "rigSignature": mesh_obj.data["gloamwardRigSignature"], "colorsPreserved": True}
    print("INTEGRITY_BASELINE_UPGRADE", json.dumps(result, sort_keys=True))
    return result


def test_integrity_rejections(name: str) -> dict:
    source_blend = OUT / f"{name}.blend"
    if not source_blend.exists():
        raise RuntimeError(f"editable source does not exist: {source_blend}")
    failures = {}
    with tempfile.TemporaryDirectory(prefix=f"gloamward-{name}-integrity-") as temp_dir:
        temp_dir = Path(temp_dir)
        for kind in ("geometry", "weight"):
            temp_blend = temp_dir / f"{name}-{kind}.blend"
            shutil.copyfile(source_blend, temp_blend)
            bpy.ops.wm.open_mainfile(filepath=str(temp_blend))
            mesh_obj, _ = scene_objects()
            if kind == "geometry":
                mesh_obj.data.vertices[0].co.x += 0.01
                expected = "mesh positions/topology changed"
            else:
                assignment = mesh_obj.data.vertices[0].groups[0]
                group = mesh_obj.vertex_groups[assignment.group]
                group.add([0], max(0.0, assignment.weight - 0.25), "REPLACE")
                expected = "rig, object transforms, or animation clips changed"
            bpy.context.preferences.filepaths.save_version = 0
            bpy.ops.wm.save_as_mainfile(filepath=str(temp_blend), compress=True)
            try:
                export_existing(name, blend_path=temp_blend,
                                runtime_path=temp_dir / f"{name}-{kind}.glb", write_report=False)
            except RuntimeError as error:
                if expected not in str(error):
                    raise
                failures[kind] = str(error)
            else:
                raise RuntimeError(f"integrity test failed to reject edited {kind}")
    result = {"asset": name, "geometryEditRejected": "geometry" in failures,
              "weightEditRejected": "weight" in failures, "reasons": failures}
    print("INTEGRITY_REJECTION_TEST", json.dumps(result, sort_keys=True))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="replace existing proof outputs explicitly")
    parser.add_argument("--asset", choices=[*ASSETS, "all"], default="all")
    parser.add_argument("--export-existing", action="store_true", help="patch runtime colors from the current saved .blend without rebuilding it")
    parser.add_argument("--test-paint-roundtrip", action="store_true", help="edit a temporary .blend copy and verify its colors export")
    parser.add_argument("--upgrade-integrity", action="store_true", help="add geometry/rig guard metadata to existing initial proof blends without changing colors")
    parser.add_argument("--test-integrity-rejections", action="store_true", help="verify geometry and weight edits are refused using temporary blend copies")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    names = list(ASSETS) if args.asset == "all" else [args.asset]
    for name in names:
        if args.upgrade_integrity:
            upgrade_integrity(name)
        elif args.test_integrity_rejections:
            test_integrity_rejections(name)
        elif args.export_existing:
            report = export_existing(name)
            print(f"ADAPTATION_REPORT {json.dumps(report, sort_keys=True)}")
        elif args.test_paint_roundtrip:
            test_paint_roundtrip(name)
        else:
            report = adapt(name, args.force)
            print(f"ADAPTATION_REPORT {json.dumps(report, sort_keys=True)}")


if __name__ == "__main__":
    main()
