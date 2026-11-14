#!/usr/bin/env python3
"""Build the authored voxel source library as an editable .blend and runtime GLB.

Run with Blender 4.5.16:
  Blender --background --python assets-src/pipeline/build_content.py
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path

import bpy
import bmesh


SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[2]
SOURCE = ROOT / "assets-src" / "content-manifest.json"
OUT = ROOT / "assets-src" / "models" / "library"
EPS = 1e-6
BEVEL = 0.006


def linear_channel(channel: int) -> float:
    value = channel / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color_value(hex_color: str) -> tuple[float, float, float, float]:
    raw = hex_color.lstrip("#")
    return (linear_channel(int(raw[0:2], 16)), linear_channel(int(raw[2:4], 16)),
            linear_channel(int(raw[4:6], 16)), 1.0)


def bounds(part: dict) -> tuple[list[float], list[float]]:
    return ([part[axis] - part[dim] / 2 for axis, dim in (("x", "w"), ("y", "h"), ("z", "d"))],
            [part[axis] + part[dim] / 2 for axis, dim in (("x", "w"), ("y", "h"), ("z", "d"))])


def subtract_rect(rect: tuple[float, float, float, float], cover: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    u0, u1, v0, v1 = rect
    a0, a1, b0, b1 = cover
    x0, x1, y0, y1 = max(u0, a0), min(u1, a1), max(v0, b0), min(v1, b1)
    if x1 - x0 <= EPS or y1 - y0 <= EPS:
        return [rect]
    pieces = []
    if y0 - v0 > EPS:
        pieces.append((u0, u1, v0, y0))
    if v1 - y1 > EPS:
        pieces.append((u0, u1, y1, v1))
    if x0 - u0 > EPS:
        pieces.append((u0, x0, y0, y1))
    if u1 - x1 > EPS:
        pieces.append((x1, u1, y0, y1))
    return pieces


def face_patches(parts: list[dict], index: int, axis: int, sign: int, lows: list[list[float]], highs: list[list[float]]) -> list[tuple[float, float, float, float]]:
    u_axis, v_axis = ((1, 2), (0, 2), (0, 1))[axis]
    plane = highs[index][axis] if sign > 0 else lows[index][axis]
    patches = [(lows[index][u_axis], highs[index][u_axis], lows[index][v_axis], highs[index][v_axis])]
    for other in range(len(parts)):
        if other == index or not patches:
            continue
        if sign > 0:
            crosses = lows[other][axis] < plane + EPS and highs[other][axis] > plane + EPS
            duplicate = other < index and abs(highs[other][axis] - plane) <= EPS
        else:
            crosses = highs[other][axis] > plane - EPS and lows[other][axis] < plane - EPS
            duplicate = other < index and abs(lows[other][axis] - plane) <= EPS
        if not crosses and not duplicate:
            continue
        cover = (lows[other][u_axis], highs[other][u_axis], lows[other][v_axis], highs[other][v_axis])
        next_patches = []
        for patch in patches:
            next_patches.extend(subtract_rect(patch, cover))
        patches = next_patches
    return patches


def ordered_face_vertices(axis: int, sign: int, plane: float, patch: tuple[float, float, float, float]) -> list[tuple[float, float, float]]:
    u_axis, v_axis = ((1, 2), (0, 2), (0, 1))[axis]
    u0, u1, v0, v1 = patch
    values = []
    for u, v in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
        point = [0.0, 0.0, 0.0]
        point[axis], point[u_axis], point[v_axis] = plane, u, v
        values.append(tuple(point))
    # The projected rectangle's winding has +normal for X and Z, -normal for Y.
    base_sign = -1 if axis == 1 else 1
    return values if sign == base_sign else list(reversed(values))


def mesh_from_parts(name: str, parts: list[dict], material: bpy.types.Material) -> tuple[bpy.types.Mesh, dict]:
    lows, highs = zip(*(bounds(part) for part in parts)) if parts else ([], [])
    lows, highs = list(lows), list(highs)
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    face_colors: list[tuple[float, float, float, float]] = []
    vertex_ids: dict[tuple[int, int, int], int] = {}
    internal_removed = 0
    for i, part in enumerate(parts):
        color = color_value(part["color"])
        for axis in range(3):
            for sign in (-1, 1):
                patches = face_patches(parts, i, axis, sign, lows, highs)
                full_area = (highs[i][(axis + 1) % 3] - lows[i][(axis + 1) % 3]) * (highs[i][(axis + 2) % 3] - lows[i][(axis + 2) % 3])
                kept_area = 0.0
                for patch in patches:
                    kept_area += (patch[1] - patch[0]) * (patch[3] - patch[2])
                    indices = []
                    for point in ordered_face_vertices(axis, sign, highs[i][axis] if sign > 0 else lows[i][axis], patch):
                        key = tuple(round(value / EPS) for value in point)
                        if key not in vertex_ids:
                            vertex_ids[key] = len(vertices)
                            # Source parts use Three.js Y-up coordinates. Blender's
                            # native scene is Z-up; this basis change is inverted by
                            # the glTF exporter so runtime prefabs stay Y-up.
                            x, y, z = point
                            vertices.append((x, -z, y))
                        indices.append(vertex_ids[key])
                    faces.append(tuple(indices))
                    face_colors.append(color)
                internal_removed += max(0.0, full_area - kept_area)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update(calc_edges=True)
    color_attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")
    for poly, color in zip(mesh.polygons, face_colors):
        for loop_index in poly.loop_indices:
            color_attr.data[loop_index].color = color
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh, {"vertices": len(vertices), "faces": len(faces), "sourceBlocks": len(parts), "removedInternalArea": round(internal_removed, 6)}


def extra_assets() -> list[dict]:
    green = ["#355727", "#486b27", "#62822d", "#7d9635", "#8fa43c"]
    gray = ["#626d74", "#7d888b", "#929da0", "#a7b0b1"]
    assets = []
    for variant in range(3):
        size = 0.14 + variant * 0.012
        parts = [
            {"x": 0, "y": size / 2, "z": 0, "w": size, "h": size, "d": size, "color": green[variant]},
            {"x": -size * 0.7, "y": size / 2, "z": size * 0.12, "w": size, "h": size, "d": size, "color": green[(variant + 2) % 5]},
            {"x": size * 0.67, "y": size / 2, "z": -size * 0.15, "w": size, "h": size, "d": size, "color": green[(variant + 1) % 5]},
            {"x": 0, "y": size + 0.045 + variant * 0.012, "z": 0, "w": size * 0.72, "h": 0.09 + variant * 0.024, "d": size * 0.72, "color": green[(variant + 3) % 5]},
        ]
        assets.append({"id": f"nature/bush/small-{variant + 1}", "category": "nature", "origin": {"x": 0, "y": 0, "z": 0}, "parts": parts})
        base_w, base_h, base_d = 0.23 + variant * 0.025, 0.19 + variant * 0.015, 0.21 + variant * 0.018
        rocks = [
            {"x": 0, "y": base_h / 2, "z": 0, "w": base_w, "h": base_h, "d": base_d, "color": gray[variant]},
            {"x": 0.17, "y": 0.13, "z": 0.03, "w": 0.20, "h": 0.22, "d": 0.19, "color": gray[(variant + 1) % 4]},
            {"x": -0.14, "y": 0.12, "z": 0.12, "w": 0.17, "h": 0.2, "d": 0.18, "color": gray[(variant + 2) % 4]},
        ]
        if variant != 1:
            rocks.append({"x": 0.02, "y": 0.27, "z": 0.01, "w": 0.14, "h": 0.15, "d": 0.14, "color": gray[(variant + 3) % 4]})
        assets.append({"id": f"nature/stone/cluster-{variant + 1}", "category": "nature", "origin": {"x": 0, "y": 0, "z": 0}, "parts": rocks})

    tile = 0.98
    assets.extend([
        {"id": "terrain/kit-grass", "category": "terrain", "origin": {"x": 0, "y": 0, "z": 0}, "parts": [
            {"x": 0, "y": -0.07, "z": 0, "w": tile, "h": 0.14, "d": tile, "color": "#6b8729"},
            {"x": 0, "y": -0.21, "z": 0, "w": tile, "h": 0.14, "d": tile, "color": "#815a3d"},
        ]},
        {"id": "terrain/kit-cliff", "category": "terrain", "origin": {"x": 0, "y": 0, "z": 0}, "parts": [
            {"x": 0, "y": -0.07, "z": 0, "w": tile, "h": 0.14, "d": tile, "color": "#737c82"},
            {"x": 0, "y": -0.28, "z": 0, "w": tile, "h": 0.28, "d": tile, "color": "#737c82"},
            {"x": 0, "y": -0.14, "z": 0.48, "w": 1.1, "h": 0.06, "d": 0.08, "color": "#815a3d"},
        ]},
        {"id": "terrain/kit-snow", "category": "terrain", "origin": {"x": 0, "y": 0, "z": 0}, "parts": [
            {"x": 0, "y": -0.07, "z": 0, "w": tile, "h": 0.14, "d": tile, "color": "#dce5e8"},
            {"x": 0, "y": -0.21, "z": 0, "w": tile, "h": 0.14, "d": tile, "color": "#737c82"},
        ]},
        {"id": "terrain/kit-path", "category": "terrain", "origin": {"x": 0, "y": 0, "z": 0}, "parts": [
            {"x": 0, "y": -0.055, "z": 0, "w": tile, "h": 0.11, "d": tile, "color": "#bf9b59"},
            {"x": 0, "y": -0.18, "z": 0, "w": tile, "h": 0.14, "d": tile, "color": "#815a3d"},
        ]},
    ])
    return assets


def make_material() -> bpy.types.Material:
    material = bpy.data.materials.new("Gloamward | matte voxel colors")
    material.diffuse_color = (1, 1, 1, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 1.0
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Col"
    links.new(color.outputs["Color"], shader.inputs["Base Color"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def make_asset(entry: dict, collection: bpy.types.Collection, material: bpy.types.Material) -> dict:
    asset_id = entry["id"]
    root = bpy.data.objects.new(asset_id, None)
    collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 0.12
    root.location = (0, 0, 0)
    root["asset_id"] = asset_id
    root["category"] = entry["category"]
    root["local_origin"] = json.dumps(entry.get("origin", {"x": 0, "y": 0, "z": 0}), separators=(",", ":"))
    root["source_blocks"] = json.dumps(entry["parts"], separators=(",", ":"))

    stats = {"nodes": 0, "vertices": 0, "faces": 0, "sourceBlocks": 0, "removedInternalArea": 0.0}

    def add_mesh(node_name: str, parts: list[dict]) -> None:
        mesh, mesh_stats = mesh_from_parts(f"{asset_id}:{node_name}", parts, material)
        obj = bpy.data.objects.new(node_name, mesh)
        collection.objects.link(obj)
        obj.parent = root
        obj["asset_id"] = asset_id
        obj["component_id"] = node_name
        obj["source_blocks"] = json.dumps(parts, separators=(",", ":"))
        obj["voxel_block_count"] = len(parts)
        bevel = obj.modifiers.new("Tiny voxel edge bevel", "BEVEL")
        bevel.width = BEVEL
        bevel.segments = 1
        bevel.limit_method = "ANGLE"
        stats["nodes"] += 1
        stats["sourceBlocks"] += len(parts)
        stats["vertices"] += mesh_stats["vertices"]
        stats["faces"] += mesh_stats["faces"]
        stats["removedInternalArea"] += mesh_stats["removedInternalArea"]

    add_mesh("base", entry["parts"])
    for attachment in entry.get("attachments", []):
        add_mesh(attachment["id"], attachment["parts"])
        root["attachment_ids"] = ",".join(x["id"] for x in entry["attachments"])
    try:
        root.asset_mark()
        root.asset_data.description = f"Original project-authored editable voxel source: {asset_id}"
        root.asset_data.tags.new(entry["category"])
    except Exception:
        pass
    return {"id": asset_id, "category": entry["category"], **stats}


def normalize_and_validate_glb(path: Path, entries: list[dict]) -> dict:
    data = path.read_bytes()
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise RuntimeError("GLB header/version validation failed")
    declared = struct.unpack_from("<I", data, 8)[0]
    json_size, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A or declared != len(data):
        raise RuntimeError("GLB JSON chunk/length validation failed")
    document = json.loads(data[20:20 + json_size].decode("utf-8"))
    nodes = document.get("nodes", [])
    by_name = {node.get("name"): node for node in nodes}
    expected = {entry["id"] for entry in entries}
    for entry in entries:
        root = by_name.get(entry["id"])
        if root is None:
            raise RuntimeError(f"GLB lost model node {entry['id']}")
        child_names = []
        for child_index in root.get("children", []):
            child = nodes[child_index]
            component = child.get("extras", {}).get("component_id")
            if component:
                child["name"] = component
            child_names.append(child.get("name"))
        if child_names.count("base") != 1:
            raise RuntimeError(f"{entry['id']} needs exactly one base child, found {child_names}")
        expected_attachments = [attachment["id"] for attachment in entry.get("attachments", [])]
        if any(name not in child_names for name in expected_attachments):
            raise RuntimeError(f"{entry['id']} lost attachment nodes {expected_attachments}")

    bin_offset = 20 + json_size
    rest = data[bin_offset:]
    encoded = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    total = 12 + 8 + len(encoded) + len(rest)
    rewritten = b"glTF" + struct.pack("<II", 2, total) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + rest
    path.write_bytes(rewritten)

    bin_start = 20 + len(encoded)
    bin_size, bin_type = struct.unpack_from("<II", rewritten, bin_start)
    if bin_type != 0x004E4942:
        raise RuntimeError("GLB binary chunk is missing")
    binary = rewritten[bin_start + 8:bin_start + 8 + bin_size]
    position_count = 0
    for accessor in document.get("accessors", []):
        if accessor.get("type") != "VEC3" or accessor.get("componentType") != 5126:
            continue
        buffer_view = document["bufferViews"][accessor["bufferView"]]
        stride = buffer_view.get("byteStride", 12)
        offset = buffer_view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        for index in range(accessor["count"]):
            xyz = struct.unpack_from("<fff", binary, offset + index * stride)
            if not all(math.isfinite(value) for value in xyz):
                raise RuntimeError("GLB contains non-finite positions")
            position_count += 1
    root_names = {node.get("name") for node in nodes if node.get("name") in expected}
    if root_names != expected:
        raise RuntimeError("GLB root node set does not match source manifest")

    old_scene = bpy.context.window.scene
    validation_scene = bpy.data.scenes.new("Temporary GLB validation")
    bpy.context.window.scene = validation_scene
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = list(validation_scene.objects)
    imported_roots = {}
    for obj in imported:
        if obj.type != "EMPTY":
            continue
        asset_id = next((candidate for candidate in expected if obj.name == candidate or obj.name.startswith(candidate + ".")), None)
        if asset_id:
            imported_roots[asset_id] = obj
    if set(imported_roots) != expected:
        sample = [obj.name for obj in imported if obj.type == "EMPTY"][:5]
        raise RuntimeError(f"GLB round-trip root mismatch ({len(imported_roots)}/{len(expected)}): {sample}")
    for entry in entries:
        root = imported_roots[entry["id"]]
        child_names = {child.name.split(".")[0] for child in root.children}
        if "base" not in child_names or any(attachment["id"] not in child_names for attachment in entry.get("attachments", [])):
            raise RuntimeError(f"GLB round-trip child mismatch for {entry['id']}: {child_names}")
    imported_meshes = 0
    for obj in imported:
        if obj.type != "MESH":
            continue
        imported_meshes += 1
        for vertex in obj.data.vertices:
            if not all(math.isfinite(value) for value in vertex.co):
                raise RuntimeError(f"GLB round-trip has non-finite mesh {obj.name}")
    bpy.context.window.scene = old_scene
    bpy.data.scenes.remove(validation_scene)
    return {"rootNodes": len(root_names), "positionVertices": position_count, "importedMeshes": imported_meshes}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    source_data = json.loads(SOURCE.read_text())
    source_assets = source_data["assets"]
    extras = extra_assets()
    assets = source_assets + extras
    clear_scene()
    scene = bpy.context.scene
    library = bpy.data.collections.new("Gloamward authored content")
    scene.collection.children.link(library)
    material = make_material()
    metrics = []
    for entry in assets:
        collection = bpy.data.collections.new(entry["id"])
        library.children.link(collection)
        metrics.append(make_asset(entry, collection, material))

    bpy.context.preferences.filepaths.save_version = 0
    (OUT / "library.blend1").unlink(missing_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "library.blend"), compress=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.context.scene.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = None
    glb_path = OUT / "library.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path), export_format="GLB", use_selection=True,
        export_apply=True, export_materials="EXPORT", export_vertex_color="MATERIAL",
        export_extras=True, export_cameras=False, export_lights=False,
        export_animations=False, export_nla_strips=False, export_force_sampling=False,
    )
    roundtrip = normalize_and_validate_glb(glb_path, assets)

    provenance = {
        "blender": bpy.app.version_string,
        "command": "Blender --background --python assets-src/pipeline/build_content.py",
        "source": str(SOURCE.relative_to(ROOT)),
        "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "scriptSha256": hashlib.sha256(SCRIPT.read_bytes()).hexdigest(),
        "license": source_data.get("source", {}).get("license"),
        "provisional": True,
        "models": metrics,
        "totals": {
            "assets": len(metrics),
            "nodes": sum(x["nodes"] for x in metrics),
            "sourceBlocks": sum(x["sourceBlocks"] for x in metrics),
            "verticesBeforeBevel": sum(x["vertices"] for x in metrics),
            "facesBeforeBevel": sum(x["faces"] for x in metrics),
            "removedInternalArea": round(sum(x["removedInternalArea"] for x in metrics), 6),
            "glbBytes": glb_path.stat().st_size,
            "bevelWidth": BEVEL,
        },
        "extras": [x["id"] for x in extras],
        "roundtripValidation": roundtrip,
        "files": ["library.blend", "library.glb"],
    }
    (OUT / "build.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps(provenance["totals"], sort_keys=True))


if __name__ == "__main__":
    build()
