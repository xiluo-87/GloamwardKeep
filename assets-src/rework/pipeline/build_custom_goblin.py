"""Build an original block-form Goblin on the existing Goblin animation rig.

Initialize once:
  Blender --background --python-exit-code 1 --python assets-src/rework/pipeline/build_custom_goblin.py -- --build
Export edits from the saved native scene:
  Blender --background --python-exit-code 1 --python assets-src/rework/pipeline/build_custom_goblin.py -- --export-existing

The pack mesh is never used. The proof Goblin Blender file supplies only its rig,
skin groups, object transforms and ten actions. GLB output splices the authored
mesh accessors into the original source GLB so its rig and animation data remain
semantically exact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "assets-src" / "pipeline"))
import gltf_tools

ASSET_ID = "custom-goblin-v1"
SOURCE_GLB = ROOT / "assets-src/studies/goblin-shaman/editor-preview.glb"
DONOR_BLEND = ROOT / "assets-src/rework/proof/characters/goblin.blend"
OUT = ROOT / "assets-src/rework/custom/goblin"
NATIVE = OUT / "goblin.blend"
GLB = OUT / "goblin.glb"
REPORT = OUT / "goblin.json"

# Coordinates are the donor's mesh-local Blender space: X is width, +Y is the
# character's face, and Z is up. The existing source root applies its own scale.
# These are authored mesh parts, not converted or simplified pack-mesh regions.
PARTS = [
    # Sturdy, restrained lower body.
    {"id":"left-boot","bone":"mixamorig:LeftFoot","center":(-8,2,3.0),"size":(12,17,6),"color":"#503a29","bevel":0.55},
    {"id":"right-boot","bone":"mixamorig:RightFoot","center":(8,2,3.0),"size":(12,17,6),"color":"#503a29","bevel":0.55},
    {"id":"left-shin","bone":"mixamorig:LeftLeg","center":(-8,0,10.0),"size":(9,12,13),"color":"#556e34","bevel":0.45},
    {"id":"right-shin","bone":"mixamorig:RightLeg","center":(8,0,10.0),"size":(9,12,13),"color":"#556e34","bevel":0.45},
    {"id":"left-trouser","bone":"mixamorig:LeftUpLeg","center":(-8,0,20.0),"size":(11,14,13),"color":"#66462e","bevel":0.5},
    {"id":"right-trouser","bone":"mixamorig:RightUpLeg","center":(8,0,20.0),"size":(11,14,13),"color":"#66462e","bevel":0.5},
    # Plain two-piece tunic, leather waist and one simple buckle.
    {"id":"tunic-lower","bone":"mixamorig:Spine1","center":(0,0,32.2),"size":(25,18,14),"color":"#765237","bevel":0.65},
    {"id":"tunic-upper","bone":"mixamorig:Spine2","center":(0,0,44.3),"size":(26,18,14),"color":"#805a3b","bevel":0.65},
    {"id":"leather-belt","bone":"mixamorig:Hips","center":(0,0,26.5),"size":(28,19,4),"color":"#493426","bevel":0.35},
    {"id":"belt-buckle","bone":"mixamorig:Hips","center":(0,10.2,27),"size":(4.5,1.5,3.2),"color":"#9a7542","bevel":0.18},
    # A simple green head, low ears, nose and dark eye slots.
    {"id":"head","bone":"mixamorig:Head","center":(0,0,68.1),"size":(27,21,22),"color":"#718b3e","bevel":0.7},
    {"id":"jaw","bone":"mixamorig:Head","center":(0,3.0,58.3),"size":(20,17,7),"color":"#698237","bevel":0.42},
    {"id":"left-ear","bone":"mixamorig:Head","center":(-15.5,0,68.0),"size":(7,10,7.5),"color":"#617b34","bevel":0.32},
    {"id":"right-ear","bone":"mixamorig:Head","center":(15.5,0,68.0),"size":(7,10,7.5),"color":"#617b34","bevel":0.32},
    {"id":"nose","bone":"mixamorig:Head","center":(0,11.9,66.1),"size":(5.2,4.3,6.1),"color":"#829947","bevel":0.28},
    {"id":"left-eye-slot","bone":"LeftEye","center":(-5.7,10.72,70.3),"size":(6.1,1.7,2.5),"color":"#1c2118","bevel":0.10},
    {"id":"right-eye-slot","bone":"RightEye","center":(5.7,10.72,70.3),"size":(6.1,1.7,2.5),"color":"#1c2118","bevel":0.10},
    {"id":"left-tusk","bone":"mixamorig:Head","center":(-6.3,10.1,59.3),"size":(2.3,2.3,3.0),"color":"#d0c39e","bevel":0.12},
    {"id":"right-tusk","bone":"mixamorig:Head","center":(6.3,10.1,59.3),"size":(2.3,2.3,3.0),"color":"#d0c39e","bevel":0.12},
    # Blocky green arms and hands overlap at their joints.
    {"id":"left-upper-arm","bone":"mixamorig:LeftArm","center":(-21.2,0,46.3),"size":(11,12,12),"color":"#718b3e","bevel":0.48},
    {"id":"left-forearm","bone":"mixamorig:LeftForeArm","center":(-30.0,0.7,44.7),"size":(10,11,12),"color":"#7c9342","bevel":0.46},
    {"id":"left-hand","bone":"mixamorig:LeftHand","center":(-39.2,2.0,43.6),"size":(9,10,8),"color":"#718b3e","bevel":0.38},
    {"id":"right-upper-arm","bone":"mixamorig:RightArm","center":(21.2,0,46.3),"size":(11,12,12),"color":"#718b3e","bevel":0.48},
    {"id":"right-forearm","bone":"mixamorig:RightForeArm","center":(30.0,0.7,44.7),"size":(10,11,12),"color":"#7c9342","bevel":0.46},
    {"id":"right-hand","bone":"mixamorig:RightHand","center":(39.7,2.1,44.0),"size":(9,10,8),"color":"#718b3e","bevel":0.38},
    # One short, readable sword, rigidly attached to the donor's right hand.
    {"id":"sword-grip","bone":"mixamorig:RightHand","center":(41.2,5.2,47.4),"size":(3.2,3.2,7.2),"color":"#493426","bevel":0.16},
    {"id":"sword-guard","bone":"mixamorig:RightHand","center":(41.2,6.0,51.6),"size":(8.4,2.5,2.0),"color":"#667273","bevel":0.15},
    {"id":"sword-blade","bone":"mixamorig:RightHand","center":(41.2,6.1,57.5),"size":(4.6,2.0,10.0),"color":"#9da9a7","bevel":0.18},
    {"id":"sword-tip","bone":"mixamorig:RightHand","center":(41.2,6.1,64.0),"size":(2.8,1.8,3.2),"color":"#b6bfba","bevel":0.10},
]

PALETTE = {
    "skin": ["#50692f", "#718b3e", "#829947", "#93a64d"],
    "tunic/leather": ["#493426", "#66462e", "#765237", "#805a3b", "#9a7542"],
    "blade/iron": ["#667273", "#9da9a7", "#b6bfba"],
    "eye/tusk": ["#1c2118", "#d0c39e"],
}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def action_curves(action):
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return list(legacy)
    return [curve for layer in action.layers for strip in layer.strips
            for bag in getattr(strip, "channelbags", []) for curve in bag.fcurves]


def native_rig_signature(mesh, armature) -> str:
    objects = set()
    for obj in (mesh, armature):
        while obj:
            objects.add(obj)
            obj = obj.parent
    state = {
        "objects": [(o.name, o.parent.name if o.parent else None,
                     [[float(c) for c in row] for row in o.matrix_local])
                    for o in sorted(objects, key=lambda item: item.name)],
        "bones": [(b.name, b.parent.name if b.parent else None,
                   [[float(c) for c in row] for row in b.matrix_local]) for b in armature.data.bones],
        "actions": [(a.name, [(f.data_path, f.array_index,
                    [(list(p.co), list(p.handle_left), list(p.handle_right), p.interpolation)
                     for p in f.keyframe_points]) for f in action_curves(a)])
                    for a in sorted(bpy.data.actions, key=lambda item: item.name)],
        "groups": [group.name for group in mesh.vertex_groups],
        "modifiers": [(m.name, m.type, getattr(getattr(m, "object", None), "name", None))
                      for m in mesh.modifiers],
    }
    return digest(state)


def source_point(point):
    return (float(point[0]) / 100.0, float(point[2]) / 100.0, -float(point[1]) / 100.0)


def source_normal(normal):
    return (float(normal[0]), float(normal[2]), -float(normal[1]))


def parse_hex(value: str):
    value = value.removeprefix("#")
    return tuple(int(value[i:i+2], 16) / 255.0 for i in (0, 2, 4))


def shade(hex_color: str, factor: float):
    return tuple(max(0.0, min(1.0, c * factor)) for c in parse_hex(hex_color))


def part_face_color(part, normal):
    if normal.z > 0.55:
        factor = 1.12
    elif normal.y > 0.55:
        factor = 1.04
    elif normal.y < -0.55:
        factor = 0.76
    elif normal.z < -0.55:
        factor = 0.72
    else:
        factor = 0.86
    return (*shade(part["color"], factor), 1.0)


def make_custom_mesh(mesh_obj):
    donor_group_names = [group.name for group in mesh_obj.vertex_groups]
    if not donor_group_names:
        raise RuntimeError("Donor mesh has no original skin vertex groups.")
    coordinates = []
    faces = []
    face_colors = []
    vertex_ranges = []
    for part in PARTS:
        bm = bmesh.new()
        made = bmesh.ops.create_cube(bm, size=1.0)
        block_verts = list(made["verts"])
        cx, cy, cz = part["center"]
        sx, sy, sz = part["size"]
        for vertex in block_verts:
            vertex.co.x = vertex.co.x * sx + cx
            vertex.co.y = vertex.co.y * sy + cy
            vertex.co.z = vertex.co.z * sz + cz
        if part["bevel"] > 0:
            geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
            bmesh.ops.bevel(bm, geom=geom, offset=part["bevel"], segments=1,
                            profile=0.5, affect="EDGES", clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.verts.ensure_lookup_table()
        start = len(coordinates)
        indices = {vertex: start + i for i, vertex in enumerate(bm.verts)}
        coordinates.extend(tuple(float(c) for c in vertex.co) for vertex in bm.verts)
        for face in bm.faces:
            faces.append(tuple(indices[v] for v in face.verts))
            face_colors.append(part_face_color(part, face.normal))
        vertex_ranges.append((start, len(coordinates), part["bone"]))
        bm.free()

    data = bpy.data.meshes.new("Custom Goblin | authored block forms")
    data.from_pydata(coordinates, [], faces)
    data.update(calc_edges=True)
    for polygon in data.polygons:
        polygon.use_smooth = False
    colors = data.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for polygon, rgba in zip(data.polygons, face_colors):
        for loop_index in polygon.loop_indices:
            colors.data[loop_index].color_srgb = rgba

    old = mesh_obj.data
    mesh_obj.data = data
    # Blender clears object vertex groups when mesh data is replaced. Rebuild
    # the exact donor names/order before assigning the authored rigid weights.
    if not mesh_obj.vertex_groups:
        for group_name in donor_group_names:
            mesh_obj.vertex_groups.new(name=group_name)
    elif [group.name for group in mesh_obj.vertex_groups] != donor_group_names:
        raise RuntimeError("Replacing the donor mesh changed its skin group table unexpectedly.")
    for start, stop, bone in vertex_ranges:
        group = mesh_obj.vertex_groups.get(bone)
        if group is None:
            raise RuntimeError(f"Donor rig is missing required bone group: {bone}")
        group.add(list(range(start, stop)), 1.0, "REPLACE")

    mat = bpy.data.materials.new("Goblin | matte vertex palette")
    mat.diffuse_color = (0.31, 0.40, 0.20, 1.0)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.9
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = "Color"
    mat.node_tree.links.new(vertex_color.outputs["Color"], shader.inputs["Base Color"])
    mat.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    data.materials.append(mat)
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return data


def get_source_template():
    raw = SOURCE_GLB.read_bytes()
    document, binary, extra = gltf_tools.parse_glb(raw)
    gltf_tools.validate_container(document, binary)
    primitives = [(m, p) for m in document["meshes"] for p in m["primitives"]]
    if len(primitives) != 1:
        raise RuntimeError("Expected the original Goblin source to have one skinned primitive.")
    mesh, primitive = primitives[0]
    return raw, document, binary, extra, mesh, primitive


def add_accessor(document, binary, rows, component, kind, target=None, bounds=False):
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    formats = {5126: "f", 5123: "H", 5125: "I"}
    count = {"SCALAR":1, "VEC3":3, "VEC4":4}[kind]
    fmt = "<" + formats[component] * count
    for row in rows:
        binary.extend(struct.pack(fmt, *row))
    view = {"buffer":0, "byteOffset":offset, "byteLength":len(binary)-offset}
    if target is not None:
        view["target"] = target
    view_id = len(document["bufferViews"])
    document["bufferViews"].append(view)
    accessor = {"bufferView":view_id, "componentType":component, "count":len(rows), "type":kind}
    if bounds:
        accessor["min"] = [min(row[i] for row in rows) for i in range(count)]
        accessor["max"] = [max(row[i] for row in rows) for i in range(count)]
    accessor_id = len(document["accessors"])
    document["accessors"].append(accessor)
    return accessor_id


def semantic_motion_signature(document, binary):
    return digest({"rig":semantic_rig_signature(document,binary),
                   "animations":semantic_animation_signature(document,binary)})


def semantic_rig_signature(document, binary):
    return digest({"nodes":[{k:v for k,v in node.items() if k!="extras"} for node in document["nodes"]],
        "skins":[{k:v for k,v in skin.items() if k!="inverseBindMatrices"} for skin in document["skins"]],
        "inverseBindMatrices":[gltf_tools.read_accessor(document,binary,skin["inverseBindMatrices"])
                                for skin in document["skins"]]})


def semantic_animation_signature(document, binary):
    animations = []
    for clip in document.get("animations", []):
        animations.append({"name":clip["name"], "channels":clip["channels"], "samplers":[
            {"interpolation":sampler.get("interpolation", "LINEAR"),
             "input":gltf_tools.read_accessor(document,binary,sampler["input"]),
             "output":gltf_tools.read_accessor(document,binary,sampler["output"])}
            for sampler in clip["samplers"]]})
    return digest(animations)


def initialize():
    if any(path.exists() for path in (NATIVE, GLB, REPORT)):
        raise RuntimeError("Custom Goblin output exists. Initialization refuses to overwrite; edit and use --export-existing.")
    bpy.ops.wm.open_mainfile(filepath=str(DONOR_BLEND))
    mesh_obj = next((obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.vertex_groups), None)
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if mesh_obj is None or armature is None:
        raise RuntimeError("The proof Goblin file is missing its skinned mesh or armature.")
    # Remove the unskinned Blender helper object from the donor proof scene.
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj is not mesh_obj:
            bpy.data.objects.remove(obj, do_unlink=True)
    raw, _, _, _, _, _ = get_source_template()
    native_sig = native_rig_signature(mesh_obj, armature)
    mesh = make_custom_mesh(mesh_obj)
    mesh_obj["gloamwardCustomGoblin"] = json.dumps({
        "asset":ASSET_ID, "sourceRig":"assets-src/studies/goblin-shaman/editor-preview.glb",
        "donor":"assets-src/rework/proof/characters/goblin.blend", "nativeGeometry":"authored-block-forms",
        "sourceSha256":hashlib.sha256(raw).hexdigest(), "parts":[part["id"] for part in PARTS],
        "palette":PALETTE, "status":"provisional custom sample for review"}, sort_keys=True)
    mesh_obj["customGoblinNativeRigSignature"] = native_sig
    mesh_obj["customGoblinSourceSha256"] = hashlib.sha256(raw).hexdigest()
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.wm.save_as_mainfile(filepath=str(NATIVE), compress=True)
    return export_existing()


def export_existing():
    if not NATIVE.exists():
        raise RuntimeError("Native Goblin file does not exist; initialize once with --build.")
    bpy.ops.wm.open_mainfile(filepath=str(NATIVE))
    mesh_obj = next((obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.vertex_groups), None)
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    if mesh_obj is None or armature is None:
        raise RuntimeError("Saved custom Goblin is missing its skinned mesh or armature.")
    if mesh_obj.get("customGoblinNativeRigSignature") != native_rig_signature(mesh_obj, armature):
        raise RuntimeError("Rig, transforms, animation curves, groups, or modifiers changed; refusing unsafe export.")
    raw, document, source_binary, extra, _, primitive = get_source_template()
    source_hash = hashlib.sha256(raw).hexdigest()
    if source_hash != mesh_obj.get("customGoblinSourceSha256"):
        raise RuntimeError("Original Goblin source changed; refusing to splice into a different rig.")
    source_motion = semantic_motion_signature(document, source_binary)
    source_rig = semantic_rig_signature(document, source_binary)
    source_animations = semantic_animation_signature(document, source_binary)
    source_joint_names = [document["nodes"][joint].get("name", "") for joint in document["skins"][0]["joints"]]
    joint_index = {name:i for i,name in enumerate(source_joint_names)}
    for group in mesh_obj.vertex_groups:
        if group.name not in joint_index:
            raise RuntimeError(f"Mesh vertex group {group.name!r} is not a source skin joint.")

    mesh = mesh_obj.data
    mesh.calc_loop_triangles()
    color = mesh.color_attributes.get("Color") or mesh.color_attributes.active_color
    if color is None or color.domain != "CORNER":
        raise RuntimeError("Custom mesh needs its authored CORNER Color attribute.")
    rows = {"POSITION":[],"NORMAL":[],"COLOR_0":[],"JOINTS_0":[],"WEIGHTS_0":[]}
    indices = []
    dedupe = {}
    for triangle in mesh.loop_triangles:
        normal = Vector(source_normal(triangle.normal)).normalized()
        for loop_index in triangle.loops:
            vertex_index = mesh.loops[loop_index].vertex_index
            vertex = mesh.vertices[vertex_index]
            rgba = tuple(float(c) for c in color.data[loop_index].color)
            assignments = [(mesh_obj.vertex_groups[item.group].name, float(item.weight))
                           for item in vertex.groups if item.weight > 1e-7]
            if len(assignments) != 1 or abs(assignments[0][1] - 1.0) > 1e-6:
                raise RuntimeError(f"Custom rigid block vertex {vertex_index} must have exactly one unit bone weight.")
            bone_name = assignments[0][0]
            if bone_name not in joint_index:
                raise RuntimeError(f"Unknown source skin joint {bone_name}.")
            joints = (joint_index[bone_name],0,0,0)
            weights = (1.0,0.0,0.0,0.0)
            normal_tuple = tuple(float(c) for c in normal)
            key = (vertex_index, tuple(round(c,6) for c in normal_tuple),
                   tuple(round(c,6) for c in rgba), joints)
            row = dedupe.get(key)
            if row is None:
                row = len(rows["POSITION"])
                dedupe[key] = row
                rows["POSITION"].append(source_point(vertex.co))
                rows["NORMAL"].append(normal_tuple)
                rows["COLOR_0"].append(rgba)
                rows["JOINTS_0"].append(joints)
                rows["WEIGHTS_0"].append(weights)
            indices.append((row,))

    binary = bytearray(source_binary[:document["buffers"][0]["byteLength"]])
    primitive["attributes"] = {
        "POSITION":add_accessor(document,binary,rows["POSITION"],5126,"VEC3",34962,True),
        "NORMAL":add_accessor(document,binary,rows["NORMAL"],5126,"VEC3",34962),
        "COLOR_0":add_accessor(document,binary,rows["COLOR_0"],5126,"VEC4",34962),
        "JOINTS_0":add_accessor(document,binary,rows["JOINTS_0"],5123,"VEC4",34962),
        "WEIGHTS_0":add_accessor(document,binary,rows["WEIGHTS_0"],5126,"VEC4",34962),
    }
    primitive["indices"] = add_accessor(document,binary,indices,
        5123 if len(rows["POSITION"]) < 65536 else 5125,"SCALAR",34963)
    primitive.pop("targets", None)
    bounds = {"min":[min(row[a] for row in rows["POSITION"]) for a in range(3)],
              "max":[max(row[a] for row in rows["POSITION"]) for a in range(3)]}
    metadata = {"asset":ASSET_ID,"geometry":"original authored cuboid forms with one-segment edge bevels",
        "sourceRig":"assets-src/studies/goblin-shaman/editor-preview.glb",
        "rigDonor":"assets-src/rework/proof/characters/goblin.blend",
        "sourceSha256":source_hash,"palette":PALETTE,"parts":[part["id"] for part in PARTS],
        "status":"provisional custom sample for review; not a final art approval"}
    for node in document["nodes"]:
        if "mesh" in node:
            node.setdefault("extras", {})["gloamwardCustomGoblin"] = metadata
    gltf_tools._compact_accessors(document)
    binary, _ = gltf_tools._repack_views(document, bytes(binary))
    gltf_tools.validate_container(document,binary)
    gltf_tools._validate_skin_weights(document,binary)
    output_motion = semantic_motion_signature(document,binary)
    output_rig = semantic_rig_signature(document,binary)
    output_animations = semantic_animation_signature(document,binary)
    if output_motion != source_motion or output_rig != source_rig or output_animations != source_animations:
        raise RuntimeError("Custom geometry splice changed source rig or animation semantics.")
    output = gltf_tools.serialize_glb(document,binary,extra)
    final_doc, final_bin, _ = gltf_tools.parse_glb(output)
    gltf_tools.validate_container(final_doc,final_bin)
    triangle_count = len(indices)//3
    native_hash = hashlib.sha256(NATIVE.read_bytes()).hexdigest()
    report = {"asset":ASSET_ID,"status":"provisional custom sample for review",
        "geometryOrigin":"Original authored mesh forms; no pack mesh geometry reused.",
        "rigDonor":"assets-src/rework/proof/characters/goblin.blend",
        "animationSource":"assets-src/studies/goblin-shaman/editor-preview.glb",
        "sourceSha256":source_hash,"nativePath":str(NATIVE.relative_to(ROOT)),
        "nativeSha256":native_hash,"outputPath":str(GLB.relative_to(ROOT)),
        "parts":PARTS,"partCount":len(PARTS),"palette":PALETTE,"triangleCount":triangle_count,
        "vertexCount":len(rows["POSITION"]),"boundsGltfLocal":bounds,
        "jointCount":len(document["skins"][0]["joints"]),
        "clips":gltf_tools._metrics(document,binary)["clip_durations"],
        "sourceRigSha256":source_rig,"outputRigSha256":output_rig,
        "sourceAnimationSha256":source_animations,"outputAnimationSha256":output_animations,
        "sourceRigMotionSha256":source_motion,"outputRigMotionSha256":output_motion,
        "rigAndAnimationsPreserved":source_motion==output_motion and source_rig==output_rig and source_animations==output_animations,
        "method":"Custom block forms weighted to existing Goblin bones; original GLB rig/nodes/skin/animation data retained while replacing only the mesh accessors."}
    GLB.write_bytes(output)
    REPORT.write_text(json.dumps(report,indent=2)+"\n")
    print("CUSTOM_GOBLIN",json.dumps({k:report[k] for k in ("triangleCount","vertexCount","boundsGltfLocal","jointCount","rigAndAnimationsPreserved","nativeSha256")}))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--build",action="store_true")
    mode.add_argument("--export-existing",action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    initialize() if args.build else export_existing()
