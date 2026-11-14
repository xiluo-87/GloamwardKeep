"""Rebuild the reviewed goblin as a coarse voxel mesh on the purchased animated rig.

Run with Blender 4.5 LTS: blender -b --factory-startup --python build_characters.py.
The publisher files and editor export remain untouched. No downloaded Python modules are used.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets-src/studies/goblin-shaman/editor-preview.glb"
PALETTE = {
    "skin": "#7e9e42", "shade": "#52742f", "cloth": "#795332",
    "leather": "#503b29", "steel": "#9fa9a5", "dark": "#222d24",
    "tooth": "#e1d6ae", "trim": "#aa7b46",
}

def linear(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)

THEMES = {
    "goblin": {},
    "hexer": {"skin":"#9da885","shade":"#5d6b55","cloth":"#766291","leather":"#433c55","trim":"#b6a166"},
    "orc": {"skin":"#769049","shade":"#4e6a36","cloth":"#7b4b38","leather":"#493d32","steel":"#89928b"},
    "stalker": {"skin":"#668577","shade":"#3c5d51","cloth":"#354846","leather":"#263735","trim":"#728d78"},
    "troll": {"skin":"#879067","shade":"#626d4d","cloth":"#785e42","leather":"#4e4435","steel":"#88918a"},
    "shaman": {"skin":"#83a26e","shade":"#4a7550","cloth":"#477d84","leather":"#35575b","trim":"#c6ac6b"},
    "ogreking": {"skin":"#b49a68","shade":"#8a714c","cloth":"#914e36","leather":"#634331","trim":"#d6ad4c"},
    "lich": {"skin":"#c2c1a6","shade":"#8b9582","cloth":"#4c5263","leather":"#343c4c","trim":"#79b6ae","dark":"#537e91"},
}

def build_character(kind="goblin"):
    dest = ROOT / "assets-src/models" / kind
    palette = PALETTE | THEMES[kind]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(SOURCE), merge_vertices=True)
    armature = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    source_mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o.vertex_groups)
    mesh_world = source_mesh.matrix_world.copy()
    original_triangles = sum(len(p.vertices) - 2 for p in source_mesh.data.polygons)
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj.vertex_groups:
            bpy.data.objects.remove(obj, do_unlink=True)

    verts, faces, colors, weights, blocks = [], [], [], [], []
    def box(name, bone, pos, size, shade):
        start = len(verts)
        x,y,z = pos; w,d,h = size
        verts.extend([(x+sx*w/2,y+sy*d/2,z+sz*h/2) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]])
        faces.extend([tuple(start+i for i in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
        colors.extend([linear(palette[shade])] * 6)
        weights.append((bone, list(range(start,start+8))))
        blocks.append({"name":name,"bone":bone,"position":pos,"size":size,"palette":shade})
    B = "mixamorig:"
    box("Hip leather", B+"Hips", (0,1,23), (25,18,15), "leather")
    box("Tunic", B+"Spine", (0,1,34), (25,19,14), "cloth")
    box("Chest", B+"Spine2", (0,0,45), (29,19,17), "cloth")
    box("Belt", B+"Hips", (0,1,28), (27,20,4), "trim")
    box("Belt buckle", B+"Hips", (0,11.4,28), (5,2.5,5), "steel")
    head_width = 39 if kind in ("troll","ogreking") else 36 if kind=="orc" else 33
    box("Head", B+"Head", (0,1.5,65.5), (head_width,27,26), "skin")
    box("Jaw", B+"Head", (0,9,56.5), (26,16,10), "shade")
    for side, label in [(-1,"Left"),(1,"Right")]:
        box(label+" ear", B+"Head", (side*21,0,66), (13,8,9), "skin")
        box(label+" brow", B+"Head", (side*7,15.6,68.5), (12,3,4), "shade")
        box(label+" eye", label+"Eye", (side*6,15.6,64.8), (5,2.2,4.5), "dark")
        box(label+" tooth", B+"Head", (side*7,17.4,57.5), (3,2.5,5), "tooth")
        box(label+" shoulder", B+label+"Shoulder", (side*17,0,47), (13,16,11), "leather")
        box(label+" upper arm", B+label+"Arm", (side*21,0,46.2), (10,10,10), "skin")
        box(label+" forearm", B+label+"ForeArm", (side*29.3,0,46.2), (12,11,11), "skin")
        box(label+" cuff", B+label+"ForeArm", (side*32.8,0,46.2), (5.5,12.2,12.2), "leather")
        box(label+" hand", B+label+"Hand", (side*40.8,1.3,43.7), (10,10.5,11), "skin")
        box(label+" thigh", B+label+"UpLeg", (side*8.6,0,20.2), (10,10,12), "cloth")
        box(label+" shin", B+label+"Leg", (side*8.6,0,10.8), (11,12.5,13), "shade")
        box(label+" boot", B+label+"Foot", (side*9,2.5,2.1), (13,18,4.2), "leather")
    if kind in ("hexer","shaman","lich"):
        box("Simple staff",B+"LeftHand",(-41,23,43.8),(4,39,4),"leather")
        box("Staff cap",B+"LeftHand",(-41,44,43.8),(9,9,9),"trim")
    elif kind in ("troll","ogreking"):
        box("Club handle",B+"LeftHand",(-41,18,43.8),(5,24,5),"leather")
        box("Club head",B+"LeftHand",(-41,36,43.8),(13,17,12),"steel")
    else:
        box("Sword grip", B+"LeftHand", (-41,9.5,43.8), (3.8,9,3.8), "leather")
        box("Sword guard", B+"LeftHand", (-41,15,43.8), (11,3.2,4.5), "trim")
        box("Sword blade", B+"LeftHand", (-41,27 if kind!="stalker" else 22,43.8), (5,22 if kind!="stalker" else 13,3), "steel")
        box("Sword tip", B+"LeftHand", (-41,39 if kind!="stalker" else 29,43.8), (3,3,3), "steel")
    if kind in ("hexer","stalker","lich"):
        box("Hood top",B+"Head",(0,0,79),(38,32,7),"cloth")
        for sign in (-1,1): box("Hood side",B+"Head",(sign*18,-1,66),(6,32,27),"cloth")
        box("Hood back",B+"Head",(0,-14,66),(36,5,26),"cloth")
    if kind in ("hexer","lich"):
        box("Long robe",B+"Hips",(0,-1,16),(31,23,27),"cloth")
        box("Robe front trim",B+"Hips",(0,11,17),(5,2,28),"trim")
    if kind in ("orc","troll","ogreking"):
        for sign in (-1,1):
            box("Heavy shoulder",B+("LeftShoulder" if sign<0 else "RightShoulder"),(sign*18,0,52),(17,20,8),"steel")
        box("Broad breastplate",B+"Spine2",(0,11,44),(29,4,18),"steel")
    if kind=="ogreking":
        box("Crown band",B+"Head",(0,1,80),(43,31,5),"trim")
        for x in (-17,-8,0,8,17): box("Crown tooth",B+"Head",(x,15,85),(5,5,9),"trim")
    if kind=="shaman":
        box("Headdress band",B+"Head",(0,1,79),(37,28,4),"leather")
        for x,h in ((-11,10),(0,15),(11,10)): box("Leaf crest",B+"Head",(x,-6,82+h/2),(7,5,h),"shade")
    mesh = bpy.data.meshes.new(kind.title()+" clean voxel topology")
    mesh.from_pydata(verts, [], faces); mesh.update()
    obj = bpy.data.objects.new("Gloamward "+kind.title(), mesh)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = mesh_world
    for bone, indices in weights:
        group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
        group.add(indices,1,"REPLACE")
    attr = mesh.color_attributes.new(name="Palette",type="FLOAT_COLOR",domain="CORNER")
    for polygon, color in zip(mesh.polygons,colors):
        for loop in polygon.loop_indices: attr.data[loop].color = color
    mesh.color_attributes.active_color = attr
    material = bpy.data.materials.new("Gloamward shared matte palette")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 1
    shader.inputs["Specular IOR Level"].default_value = .15
    color = material.node_tree.nodes.new("ShaderNodeVertexColor"); color.layer_name = "Palette"
    material.node_tree.links.new(color.outputs["Color"],shader.inputs["Base Color"])
    mesh.materials.append(material)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bevel = obj.modifiers.new("Subtle voxel edge", "BEVEL")
    bevel.width = .32; bevel.segments = 1
    bevel.affect = "EDGES"
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    modifier = obj.modifiers.new("Preserved publisher animation rig", "ARMATURE"); modifier.object = armature
    obj.parent = armature
    obj.matrix_world = mesh_world
    for polygon in obj.data.polygons: polygon.use_smooth = False
    dest.mkdir(parents=True, exist_ok=True)
    obj["source"] = "Blocky Characters 1.0.1 rig; original Gloamward voxel replacement mesh"
    obj["palette"] = json.dumps(palette)
    obj["authoring_blocks"] = json.dumps(blocks)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(dest/(kind+".blend")), check_existing=False)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); armature.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(dest/(kind+".glb")),export_format="GLB",use_selection=True,
        export_texcoords=False,export_normals=True,export_materials="EXPORT",export_vertex_color="ACTIVE",
        export_animations=True,export_animation_mode="NLA_TRACKS",export_frame_range=False,
        export_force_sampling=True,export_skins=True,export_def_bones=False,export_yup=True,export_anim_slide_to_zero=True,
        export_extras=True,export_optimize_animation_size=True)
    obj.data.calc_loop_triangles()
    report={"blender":bpy.app.version_string,"source":str(SOURCE.relative_to(ROOT)),"source_triangles":original_triangles,
            "triangles":len(obj.data.loop_triangles),"vertices":len(obj.data.vertices),"blocks":len(blocks),
            "kind":kind,"palette":palette,"changes":["coarse original body/face/hand voxel geometry", "simple role-specific gear", "subtle chamfered edges", "purchased rig and ten clips preserved"],
            "art_status":"Working adaptation for review; UI and final art acceptance remain open."}
    sys.path.insert(0, str(Path(__file__).parent))
    from gltf_tools import optimize_glb_bytes
    import hashlib
    exported = dest/(kind+".glb")
    optimized, metrics = optimize_glb_bytes(exported.read_bytes(), SOURCE.read_bytes())
    exported.write_bytes(optimized)
    report["optimization"] = metrics
    report["pipeline"] = str(Path(__file__).relative_to(ROOT))
    report["pipeline_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report["source_sha256"] = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    report["sha256"] = hashlib.sha256(optimized).hexdigest()
    (dest/"build.json").write_text(json.dumps(report,indent=2)+"\n")
    print("CHARACTER_BUILD",json.dumps(report))

if __name__ == "__main__":
    requested = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["goblin"]
    for kind in (list(THEMES) if requested==["all"] else requested): build_character(kind)
