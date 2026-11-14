"""Export an edited native source without regenerating its geometry.

blender -b path/to/source.blend --python export_blend.py -- path/to/output.glb [reference.glb]
The optional reference preserves licensed character clip names and durations.
"""
import hashlib
import json
import sys
from pathlib import Path
import bpy

args = sys.argv[sys.argv.index('--') + 1:]
output = Path(args[0]).resolve()
reference = Path(args[1]).resolve() if len(args) > 1 else None
source = Path(bpy.data.filepath)
# Imported bone display helpers are editor-only, never runtime geometry.
objects = [obj for obj in bpy.context.scene.objects
           if obj.type in {'MESH', 'ARMATURE'} and not obj.hide_render
           and not obj.name.startswith('Icosphere')]
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:
    obj.select_set(True)
    parent = obj.parent
    while parent:
        parent.select_set(True)
        parent = parent.parent
output.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
    export_texcoords=False, export_normals=True, export_materials='EXPORT',
    export_apply=not any(obj.type == 'ARMATURE' for obj in objects),
    export_vertex_color='ACTIVE', export_animations=True, export_animation_mode='NLA_TRACKS',
    export_frame_range=False, export_force_sampling=True, export_skins=True,
    export_def_bones=False, export_yup=True, export_anim_slide_to_zero=True,
    export_extras=True, export_optimize_animation_size=True)
sys.path.insert(0, str(Path(__file__).parent))
from gltf_tools import optimize_glb_bytes
optimized, report = optimize_glb_bytes(output.read_bytes(), reference.read_bytes() if reference else None)
output.write_bytes(optimized)
output.with_suffix('.export.json').write_text(json.dumps({
    'source': str(source), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'output_sha256': hashlib.sha256(optimized).hexdigest(), 'blender': bpy.app.version_string,
    'optimization': report,
}, indent=2) + '\n')
print('EXPORTED', output, len(optimized))
