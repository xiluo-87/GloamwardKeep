"""Build the editable custom static nature kit and its standard GLB library.

Initialize a new source once:
  Blender -b --python build_custom_nature.py -- --init

Export changes from the saved native source:
  Blender -b --python build_custom_nature.py -- --export-existing

Initialization refuses to overwrite any existing output. The GLB contains one joined,
vertex-colored mesh under each named prefab root; the .blend keeps named vertex groups
for the separately editable voxel components.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "assets-src" / "rework" / "custom" / "nature"
BLEND = OUT / "nature.blend"
GLB = OUT / "nature.glb"
MANIFEST = OUT / "nature.json"

GREENS = ("#263f32", "#31533a", "#426642", "#557542", "#6a8240", "#819044", "#9a9d4b")
BARK = ("#674832", "#795437", "#8b6441")
ROCKS = ("#626d74", "#737f84", "#879194", "#9da5a4", "#b2b5ae")
SNOW = "#efeee5"
STONES = ("#68757b", "#7d898d", "#929b9d", "#a6acad", "#bec0b9")

# All dimensions are simple grid occupancies so foliage and rock layers keep a clean block silhouette.
VARIANTS: list[dict[str, Any]] = [
    {"family": "forest", "variant": "pine-broad", "treeCount": 1},
    {"family": "forest", "variant": "pine-slender", "treeCount": 1},
    {"family": "forest", "variant": "pine-tiered", "treeCount": 1},
    {"family": "forest", "variant": "twin-pines", "treeCount": 2},
    {"family": "forest", "variant": "twin-saplings", "treeCount": 2},
    {"family": "rocks", "variant": "boulders", "treeCount": 0},
    {"family": "rocks", "variant": "low-slab", "treeCount": 0},
    {"family": "rocks", "variant": "stepped-pile", "treeCount": 0},
    {"family": "rocks", "variant": "split-boulder", "treeCount": 0},
    {"family": "rocks", "variant": "scattered-rocks", "treeCount": 0},
    {"family": "bush", "variant": "low-clump", "treeCount": 0},
    {"family": "bush", "variant": "round-clump", "treeCount": 0},
    {"family": "bush", "variant": "wide-clump", "treeCount": 0},
    {"family": "bush", "variant": "tall-clump", "treeCount": 0},
    {"family": "stones", "variant": "pebbles", "treeCount": 0},
    {"family": "stones", "variant": "flat-stones", "treeCount": 0},
    {"family": "stones", "variant": "twin-stones", "treeCount": 0},
]


def stable_hash(x: int, y: int, z: int, salt: int = 0) -> int:
    value = (x * 0x9E3779B1 ^ y * 0x85EBCA77 ^ z * 0xC2B2AE3D ^ salt) & 0xFFFFFFFF
    value ^= value >> 16
    value = (value * 0x7FEB352D) & 0xFFFFFFFF
    value ^= value >> 15
    value = (value * 0x846CA68B) & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFFFFFFFF


class VoxelShape:
    def __init__(self, cell: float):
        self.cell = cell
        self.cells: dict[tuple[int, int, int], tuple[str, str, bool]] = {}

    def add(self, x: int, y: int, z: int, palette: tuple[str, ...], part: str,
            salt: int = 0, snowable: bool = False, color: str | None = None) -> None:
        key = (x, y, z)
        # Hold color patches across neighboring cells so the low-poly surface stays calm,
        # while separate canopy levels and prefabs still use distinct olive/fir tones.
        self.cells[key] = (color or palette[stable_hash(x // 2, y, z // 2, salt) % len(palette)], part, snowable)

    def fill_layer(self, y: int, rx: int, rz: int, palette: tuple[str, ...], part: str,
                   *, cx: int = 0, cz: int = 0, salt: int = 0,
                   chamfer: bool = True, snowable: bool = False) -> None:
        for x in range(cx - rx, cx + rx + 1):
            for z in range(cz - rz, cz + rz + 1):
                if chamfer and rx > 1 and rz > 1 and abs(x - cx) == rx and abs(z - cz) == rz:
                    continue
                self.add(x, y, z, palette, part, salt, snowable)


def make_tree(shape: VoxelShape, variant: str, cx: int = 0, cz: int = 0,
              height: int | None = None, label: str = "tree") -> None:
    cell = shape.cell
    if variant == "pine-broad":
        height = height or 14
        bands = [(4, 5, 3), (6, 8, 2), (9, 11, 1), (12, 13, 0)]
    elif variant == "pine-slender":
        height = height or 15
        bands = [(4, 7, 2), (8, 10, 1), (11, 15, 0)]
    elif variant == "pine-tiered":
        height = height or 14
        bands = [(3, 5, 3), (6, 8, 1), (9, 10, 2), (11, 13, 0)]
    else:
        height = height or (12 if variant == "twin-pines" else 10)
        bands = [(3, 4, 2), (5, 7, 1), (8, height - 1, 0)]

    trunk_top = max(3, min(5, height // 3))
    trunk_name = f"{label} trunk"
    for y in range(trunk_top):
        for dx in (0, -1):
            for dz in (0, -1):
                shape.add(cx + dx, y, cz + dz, BARK, trunk_name, salt=70 + y)

    tier_index = 0
    for first_y, last_y, radius in bands:
        if first_y >= height:
            continue
        last_y = min(last_y, height - 1)
        part = f"{label} canopy tier {tier_index + 1}"
        for y in range(first_y, last_y + 1):
            # Upper tier caps taper naturally; lower tiers retain a broad stepped skirt.
            row_radius = radius
            if last_y - first_y >= 3 and y == last_y:
                row_radius = max(0, radius - 1)
            shape.fill_layer(y, row_radius, row_radius, GREENS, part,
                             cx=cx, cz=cz, salt=15 + tier_index * 29,
                             chamfer=True, snowable=y >= height - 3)
        tier_index += 1


def make_forest(variant: str, tree_count: int) -> VoxelShape:
    paired = tree_count == 2
    shape = VoxelShape(0.08 if paired else 0.1)
    if not paired:
        make_tree(shape, variant)
    elif variant == "twin-pines":
        make_tree(shape, "twin-pines", cx=-4, cz=0, height=12, label="west pine")
        make_tree(shape, "twin-pines", cx=4, cz=0, height=10, label="east pine")
    else:
        make_tree(shape, "twin-saplings", cx=-3, cz=0, height=10, label="west sapling")
        make_tree(shape, "twin-saplings", cx=3, cz=0, height=11, label="east sapling")
    return shape


def add_rock_blob(shape: VoxelShape, cx: int, cz: int, layers: list[tuple[int, int, int]],
                  part: str, salt: int = 0) -> None:
    for y, rx, rz in layers:
        shape.fill_layer(y, rx, rz, ROCKS, part, cx=cx, cz=cz, salt=salt + y * 11,
                         chamfer=True, snowable=True)


def make_rocks(variant: str) -> VoxelShape:
    shape = VoxelShape(0.1)
    if variant == "boulders":
        add_rock_blob(shape, 0, 0, [(0, 3, 3), (1, 3, 3), (2, 3, 2), (3, 2, 2), (4, 1, 1)], "main boulder", 3)
        add_rock_blob(shape, -6, 1, [(0, 2, 2), (1, 1, 1), (2, 1, 1)], "side boulder", 9)
    elif variant == "low-slab":
        for y, rx, rz in [(0, 5, 4), (1, 5, 4), (2, 4, 3)]:
            shape.fill_layer(y, rx, rz, ROCKS, "wide low slab", salt=21 + y, snowable=True)
        add_rock_blob(shape, 2, -1, [(3, 2, 2)], "raised slab corner", 41)
    elif variant == "stepped-pile":
        add_rock_blob(shape, -2, 1, [(0, 3, 3), (1, 3, 3), (2, 2, 2), (3, 1, 1)], "left stack", 31)
        add_rock_blob(shape, 2, -1, [(0, 3, 2), (1, 3, 2), (2, 2, 2), (3, 2, 1), (4, 1, 1)], "right stack", 43)
        add_rock_blob(shape, 0, 3, [(1, 2, 2), (2, 2, 1)], "rear stack", 59)
    elif variant == "split-boulder":
        add_rock_blob(shape, -4, 0, [(0, 2, 3), (1, 2, 3), (2, 2, 2), (3, 1, 1)], "west boulder", 71)
        add_rock_blob(shape, 4, 0, [(0, 2, 3), (1, 2, 3), (2, 2, 2), (3, 2, 2), (4, 1, 1)], "east boulder", 83)
    else:
        stones = [(-4, -3, 2, 1), (-1, 3, 3, 1), (3, -3, 2, 1),
                  (4, 2, 2, 1), (-4, 3, 2, 1), (1, -1, 3, 1)]
        for index, (cx, cz, height, radius) in enumerate(stones):
            add_rock_blob(shape, cx, cz,
                          [(y, max(1, radius - y // 2), max(1, radius - y // 3)) for y in range(height)],
                          f"scatter stone {index + 1}", 97 + index * 13)
    return shape


def make_bush(variant: str) -> VoxelShape:
    shape = VoxelShape(0.065)
    if variant == "low-clump":
        bands = [(0, 3, 2, 2), (1, 2, 1, 1), (2, 1, 1, 1), (3, 1, 1, 1)]
    elif variant == "round-clump":
        bands = [(0, 3, 3, 3), (1, 3, 3, 3), (2, 2, 2, 2), (3, 1, 1, 1)]
    elif variant == "wide-clump":
        bands = [(0, 3, 2, 2), (1, 3, 2, 2), (2, 2, 2, 2), (3, 1, 1, 1)]
    else:
        bands = [(0, 3, 3, 3), (1, 3, 3, 3), (2, 2, 2, 2), (3, 1, 1, 1), (4, 1, 1, 1)]
    for y, rx, rz, _ in bands:
        shape.fill_layer(y, rx, rz, GREENS, "leaf clump", salt=133 + y * 7,
                         chamfer=True, snowable=y >= max(row[0] for row in bands) - 1)
    return shape


def make_stones(variant: str) -> VoxelShape:
    shape = VoxelShape(0.04 if variant == "flat-stones" else 0.05)
    if variant == "pebbles":
        blobs = [(-3, -2, 1, 2), (0, 2, 1, 3), (3, -2, 1, 2), (0, -4, 1, 2)]
    elif variant == "flat-stones":
        blobs = [(-4, -1, 1, 3), (0, 1, 1, 3), (4, 0, 1, 3)]
    else:
        blobs = [(-3, 0, 1, 3), (3, 0, 2, 4)]
    for index, (cx, cz, rx, height) in enumerate(blobs):
        rz = max(1, rx - (index % 2))
        for y in range(height):
            layer_rx = max(1, rx - (1 if y == height - 1 else 0))
            layer_rz = max(1, rz - (1 if y == height - 1 else 0))
            shape.fill_layer(y, layer_rx, layer_rz, STONES, f"stone {index + 1}",
                             cx=cx, cz=cz, salt=151 + index * 17 + y,
                             chamfer=True, snowable=True)
    return shape


def add_snow_caps(shape: VoxelShape) -> None:
    """Add top blocks above the foliage/stone surface; their bottoms touch existing solids."""
    tops_by_component: dict[str, int] = {}
    for (_, y, _), (_, part, _) in shape.cells.items():
        if "canopy tier" in part:
            component = part.rsplit(" canopy tier", 1)[0]
        elif part == "leaf clump":
            component = part
        else:
            component = part
        tops_by_component[component] = max(tops_by_component.get(component, -1), y)

    caps: list[tuple[int, int, int, str]] = []
    for (x, y, z), (_, part, _) in list(shape.cells.items()):
        if "canopy tier" in part:
            component = part.rsplit(" canopy tier", 1)[0]
        elif part == "leaf clump":
            component = part
        else:
            component = part
        top = tops_by_component.get(component, y)
        # Woodland gets snowy caps on the exposed top of its upper foliage; rock/bush/stone
        # accents cap the tallest exposed blocks of each separate authored component.
        if y != top or (x, y + 1, z) in shape.cells:
            continue
        caps.append((x, y + 1, z, part))
    for x, y, z, part in caps:
        shape.add(x, y, z, (SNOW,), f"{part} snow cap", color=SNOW)


def add_forest_snow_ring(shape: VoxelShape) -> None:
    """Add one supported cap ring at the next exposed canopy tier below each tip."""
    exposed: dict[str, dict[int, list[tuple[int, int, int, str]]]] = defaultdict(lambda: defaultdict(list))
    for (x, y, z), (_, part, _) in shape.cells.items():
        if " canopy tier" not in part or " snow cap" in part or " snow ring" in part:
            continue
        tree = part.rsplit(" canopy tier", 1)[0]
        above = shape.cells.get((x, y + 1, z))
        if above is not None and " snow cap" not in above[1]:
            continue
        exposed[tree][y].append((x, y + 1, z, part))

    for tree, ledges in exposed.items():
        levels = sorted(ledges)
        if len(levels) < 2:
            continue
        ring_level = levels[-2]
        for x, y, z, _source_part in ledges[ring_level]:
            position = (x, y, z)
            if position in shape.cells:
                continue
            shape.cells[position] = (SNOW, f"{tree} snow ring {ring_level}", False)


def create_color_material() -> bpy.types.Material:
    material = bpy.data.materials.new("Custom Nature Vertex Palette")
    material.diffuse_color = (0.32, 0.42, 0.25, 1)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "Color"
    material.node_tree.links.new(color.outputs["Color"], principled.inputs["Base Color"])
    return material


def build_mesh(name: str, shape: VoxelShape) -> tuple[bpy.types.Mesh, list[str], int]:
    vertex_lookup: dict[tuple[float, float, float], int] = {}
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    face_colors: list[tuple[float, float, float, float]] = []
    face_parts: list[str] = []
    cell = shape.cell

    def vertex(point: tuple[float, float, float]) -> int:
        key = tuple(round(value, 7) for value in point)
        if key not in vertex_lookup:
            vertex_lookup[key] = len(vertices)
            # Author the Blender mesh in its native +Z-up basis. The standard GLTF exporter
            # then converts it to +Y-up, preserving these logical (x, up, depth) coordinates.
            vertices.append((point[0], -point[2], point[1]))
        return vertex_lookup[key]

    face_specs = [
        ((1, 0, 0), lambda x0, x1, y0, y1, z0, z1: [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
        ((-1, 0, 0), lambda x0, x1, y0, y1, z0, z1: [(x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)]),
        ((0, 1, 0), lambda x0, x1, y0, y1, z0, z1: [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]),
        ((0, -1, 0), lambda x0, x1, y0, y1, z0, z1: [(x0, y0, z1), (x0, y0, z0), (x1, y0, z0), (x1, y0, z1)]),
        ((0, 0, 1), lambda x0, x1, y0, y1, z0, z1: [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
        ((0, 0, -1), lambda x0, x1, y0, y1, z0, z1: [(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)]),
    ]
    occupied = shape.cells
    for (ix, iy, iz), (color, part, snowable) in occupied.items():
        x0, x1 = (ix - 0.5) * cell, (ix + 0.5) * cell
        y0, y1 = iy * cell, (iy + 1) * cell
        z0, z1 = (iz - 0.5) * cell, (iz + 0.5) * cell
        for (dx, dy, dz), corners in face_specs:
            neighbor = (ix + dx, iy + dy, iz + dz)
            if neighbor in occupied:
                continue
            points = corners(x0, x1, y0, y1, z0, z1)
            faces.append(tuple(vertex(point) for point in points))
            # Blender's color constructor is convenient but not needed; convert HTML hex explicitly.
            chosen = color
            def linear(channel: int) -> float:
                value = channel / 255
                return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4
            rgb = tuple(linear(int(chosen[index:index + 2], 16)) for index in (1, 3, 5))
            face_colors.append((rgb[0], rgb[1], rgb[2], 1.0))
            face_parts.append(part)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    color_attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            color_attr.data[loop_index].color = face_colors[polygon.index]
        polygon.use_smooth = False
    mesh.calc_loop_triangles()
    triangles = len(mesh.loop_triangles)

    # A restrained single segment bevel keeps the voxel planes but softens their hard edges slightly.
    obj_temp = bpy.data.objects.new(f"{name} bevel temporary", mesh)
    bpy.context.scene.collection.objects.link(obj_temp)
    bevel = obj_temp.modifiers.new("Single segment soft block edge", "BEVEL")
    bevel.width = min(cell * 0.035, 0.004)
    bevel.segments = 1
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(25)
    bpy.context.view_layer.objects.active = obj_temp
    obj_temp.select_set(True)
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    obj_temp.select_set(False)
    mesh = obj_temp.data
    mesh.name = name
    # The bevel modifier may interpolate negative weights. Rebuild non-deforming named
    # component selections from the nearest authored voxel center after it has finished.
    for group in list(obj_temp.vertex_groups):
        obj_temp.vertex_groups.remove(group)
    cells = list(shape.cells.items())
    tree = KDTree(len(cells))
    cell_parts: list[str] = []
    for index, ((ix, iy, iz), (_, part, _)) in enumerate(cells):
        tree.insert(Vector((ix * cell, -iz * cell, (iy + 0.5) * cell)), index)
        cell_parts.append(part)
    tree.balance()
    grouped_indices: dict[str, list[int]] = defaultdict(list)
    for vertex_item in mesh.vertices:
        _, nearest, _ = tree.find(vertex_item.co)
        grouped_indices[cell_parts[nearest]].append(vertex_item.index)
    for part, indices in grouped_indices.items():
        group = obj_temp.vertex_groups.new(name=part)
        group.add(indices, 1.0, "REPLACE")
    bpy.data.objects.remove(obj_temp, do_unlink=True)
    return mesh, sorted(set(face_parts)), triangles


def bounds_of(obj: bpy.types.Object) -> dict[str, list[float]]:
    mesh = obj.data
    mesh.calc_loop_triangles()
    coords = [vertex.co for vertex in mesh.vertices]
    blender_min = [min(vertex[axis] for vertex in coords) for axis in range(3)]
    blender_max = [max(vertex[axis] for vertex in coords) for axis in range(3)]
    # Blender authored +Z-up; these manifest bounds describe the exported GLB +Y-up frame.
    return {"min": [blender_min[0], blender_min[2], -blender_max[1]],
            "max": [blender_max[0], blender_max[2], -blender_min[1]]}


def base_shape(asset: dict[str, Any]) -> VoxelShape:
    family, variant = asset["family"], asset["variant"]
    if family == "forest":
        return make_forest(variant, asset["treeCount"])
    if family == "rocks":
        return make_rocks(variant)
    if family == "bush":
        return make_bush(variant)
    return make_stones(variant)


def create_library() -> list[dict[str, Any]]:
    material = create_color_material()
    roots = []
    root_collection = bpy.data.collections.new("Custom Nature Prefabs")
    bpy.context.scene.collection.children.link(root_collection)
    for definition in VARIANTS:
        family, variant = definition["family"], definition["variant"]
        ids = [f"nature/{family}/{variant}", f"nature/{family}/{variant}-snow"]
        base = base_shape(definition)
        for snow, asset_id in ((False, ids[0]), (True, ids[1])):
            shape = VoxelShape(base.cell)
            shape.cells = dict(base.cells)
            if snow:
                if family == "forest":
                    add_snow_caps(shape)
                    add_forest_snow_ring(shape)
                else:
                    add_snow_caps(shape)
            root = bpy.data.objects.new(asset_id, None)
            root.empty_display_type = "PLAIN_AXES"
            root["asset_id"] = asset_id
            root["family"] = family
            root["base_variant"] = variant
            root["snow"] = snow
            root["tree_count"] = definition["treeCount"]
            root_collection.objects.link(root)
            mesh_data, parts, triangles = build_mesh(asset_id + " mesh", shape)
            mesh_obj = bpy.data.objects.new(asset_id + " joined mesh", mesh_data)
            mesh_obj.parent = root
            mesh_obj["component_id"] = "joined-voxel-mesh"
            mesh_obj.data.materials.append(material)
            root_collection.objects.link(mesh_obj)
            # The joined source mesh retains named vertex groups for major authored components.
            root["parts"] = json.dumps(parts)
            roots.append({"root": root, "mesh": mesh_obj, "definition": definition,
                          "variant": variant, "snow": snow, "asset_id": asset_id,
                          "parts": parts, "triangles": triangles})
    return roots


def export_existing() -> None:
    if not BLEND.exists():
        raise SystemExit(f"Saved custom nature source is missing: {BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    roots = []
    for obj in bpy.context.scene.objects:
        if obj.parent is None and isinstance(obj.data, type(None)) and obj.get("asset_id"):
            roots.append(obj)
    if len(roots) != 34:
        raise SystemExit(f"Expected 34 named custom nature roots, found {len(roots)}")
    assets = []
    for root in sorted(roots, key=lambda item: item.name):
        children = [child for child in root.children if child.type == "MESH"]
        if len(children) != 1:
            raise SystemExit(f"{root.name} must have exactly one joined mesh child")
        mesh_obj = children[0]
        root.update_tag(refresh={'OBJECT', 'DATA'})
        bpy.context.view_layer.update()
        bounds = bounds_of(mesh_obj)
        mesh_obj.data.calc_loop_triangles()
        triangles = len(mesh_obj.data.loop_triangles)
        if mesh_obj.data.color_attributes.get("Color") is None:
            raise SystemExit(f"{root.name} has no vertex color attribute")
        assets.append({
            "id": root["asset_id"],
            "family": root["family"],
            "variant": root["base_variant"],
            "snow": bool(root["snow"]),
            "treeCount": int(root["tree_count"]),
            "triangles": triangles,
            "bounds": bounds,
            "parts": json.loads(root["parts"]),
        })

    bpy.ops.object.select_all(action="DESELECT")
    for root in roots:
        root.select_set(True)
        for child in root.children:
            child.select_set(True)
    bpy.context.view_layer.objects.active = roots[0]
    bpy.ops.export_scene.gltf(
        filepath=str(GLB), export_format="GLB", use_selection=True,
        export_extras=True, export_yup=True,
    )
    manifest = {"name": "custom-nature", "assets": assets}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(assets)} nature prefabs to {GLB}")


def refresh_forest_snow() -> None:
    """Update only forest snow prefab meshes in an existing editable source."""
    if not BLEND.exists():
        raise SystemExit(f"Saved custom nature source is missing: {BLEND}")
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    for definition in (item for item in VARIANTS if item["family"] == "forest"):
        asset_id = f"nature/forest/{definition['variant']}-snow"
        root = next((obj for obj in bpy.context.scene.objects if obj.get("asset_id") == asset_id), None)
        if root is None:
            raise SystemExit(f"Missing frozen forest snow prefab {asset_id}")
        old_mesh = next((child for child in root.children if child.type == "MESH"), None)
        if old_mesh is None or len([child for child in root.children if child.type == "MESH"]) != 1:
            raise SystemExit(f"{asset_id} must have one editable joined mesh")
        original_mesh_name = old_mesh.name

        shape = make_forest(definition["variant"], definition["treeCount"])
        add_snow_caps(shape)
        add_forest_snow_ring(shape)
        mesh_data, parts, _ = build_mesh(asset_id + " mesh", shape)
        mesh_obj = bpy.data.objects.new(old_mesh.name, mesh_data)
        mesh_obj["component_id"] = old_mesh.get("component_id", "joined-voxel-mesh")
        if old_mesh.data.materials:
            mesh_data.materials.append(old_mesh.data.materials[0])
        mesh_obj.parent = root
        for collection in old_mesh.users_collection:
            collection.objects.link(mesh_obj)
        root["parts"] = json.dumps(parts)
        old_data = old_mesh.data
        bpy.data.objects.remove(old_mesh, do_unlink=True)
        if old_data.users == 0:
            bpy.data.meshes.remove(old_data)
        mesh_obj.name = original_mesh_name
        mesh_data.name = asset_id + " mesh"

    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    export_existing()


def initialize() -> None:
    existing = [path for path in (BLEND, GLB, MANIFEST) if path.exists()]
    if existing:
        raise SystemExit("Refusing to overwrite existing custom nature source/output: "
                         + ", ".join(str(path) for path in existing))
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots = create_library()
    for item in roots:
        item["root"].select_set(True)
    bpy.context.view_layer.objects.active = roots[0]["root"]
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    export_existing()


def main() -> None:
    parser = argparse.ArgumentParser()
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--init", action="store_true", help="create the new editable source and first export")
    actions.add_argument("--export-existing", action="store_true", help="export from the saved editable source")
    actions.add_argument("--refresh-forest-snow", action="store_true",
                         help="update only forest snow meshes in the saved source")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.init:
        initialize()
    elif args.refresh_forest_snow:
        refresh_forest_snow()
    else:
        export_existing()


if __name__ == "__main__":
    main()
