"""Export edited native archer sources, preserving crew and effect sockets.
blender -b assets-src/rework/proof/archers/archers.blend --python assets-src/rework/pipeline/export_archer_proof.py
The .blend is canonical; this exporter never regenerates its block designs.
"""
import hashlib
import json
from pathlib import Path
import bpy

source = Path(bpy.data.filepath)
output = source.with_suffix('.glb')
if source.name != 'archers.blend': raise RuntimeError('Open the authored archers.blend first.')
deps = bpy.context.evaluated_depsgraph_get()
roots = [obj for obj in bpy.context.scene.objects if 'asset_id' in obj]
report = []
for root in roots:
    pieces = [obj for obj in root.children_recursive if obj.type == 'MESH']
    copies = []
    for obj in pieces:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps), depsgraph=deps)
        color = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        for poly in mesh.polygons:
            mat = mesh.materials[poly.material_index]
            rgba = tuple(mat.diffuse_color)
            for i in poly.loop_indices: color.data[i].color = rgba
        mesh.color_attributes.active_color = color
        copy = bpy.data.objects.new(obj.name+' export', mesh)
        bpy.context.collection.objects.link(copy)
        copy.matrix_world = obj.matrix_world.copy()
        copies.append(copy)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in copies: obj.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    joined = bpy.context.object
    joined.name = 'structure'
    joined.parent = root
    joined.matrix_parent_inverse = root.matrix_world.inverted()
    joined['component_id'] = 'structure'
    mat = bpy.data.materials.get('Runtime vertex palette') or bpy.data.materials.new('Runtime vertex palette')
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .92
    vertex = mat.node_tree.nodes.get('Voxel colors') or mat.node_tree.nodes.new('ShaderNodeVertexColor')
    vertex.name = 'Voxel colors'
    vertex.layer_name = 'Color'
    mat.node_tree.links.new(vertex.outputs['Color'], shader.inputs['Base Color'])
    joined.data.materials.clear()
    joined.data.materials.append(mat)
    for poly in joined.data.polygons: poly.material_index = 0
    for obj in pieces: bpy.data.objects.remove(obj, do_unlink=True)
    joined.data.calc_loop_triangles()
    report.append({'id': root['asset_id'], 'blocks': len(pieces), 'triangles': len(joined.data.loop_triangles),
                   'crew': [obj.name for obj in root.children if 'character_id' in obj],
                   'design': root['design']})
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_yup=True,
    export_apply=True, export_texcoords=False, export_normals=True,
    export_vertex_color='ACTIVE', export_animations=False, export_extras=True)
output.with_suffix('.build.json').write_text(json.dumps({'status': 'pending visual review',
    'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'models': report}, indent=2)+'\n')
print('EXPORTED', output, report)
