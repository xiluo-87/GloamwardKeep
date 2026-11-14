"""Refine the actual purchased meshes; keep source rigs and all native animation data.

Initialize once:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python-exit-code 1 --python assets-src/rework/pipeline/refine_pack.py -- --asset all
Export a saved native edit without regenerating it:
  ... -- --asset goblin --export-existing

Geometry is extracted from Blender mesh-local space, not through Blender's skin exporter.
The source GLB hierarchy/skin/animation data is retained, with only geometry accessors replaced.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import adapt_pack as palette
gltf = palette.gltf_tools
OUT = ROOT / 'assets-src/rework/refined/characters'

# Review recipes, not accepted final preferences. These modify the source vertices;
# no replacement body, head, weapon, or equipment primitives are created.
RECIPES = {
    'goblin': {'decimate_ratio': .5, 'head_width': 1.13, 'head_depth': 1.07, 'body_width': 1.07, 'limbs': 1.10, 'cap_start': .85, 'cap_compress': .80},
    'orc': {'decimate_ratio': .5, 'head_width': 1.08, 'head_depth': 1.04, 'body_width': 1.04, 'limbs': 1.07, 'cap_start': .88, 'cap_compress': .80},
    'troll': {'decimate_ratio': .5, 'head_width': 1.07, 'head_depth': 1.04, 'body_width': 1.025, 'limbs': 1.05, 'cap_start': 1., 'cap_compress': 1.},
    'archer-crew': {'decimate_ratio': .5, 'head_width': 1.14, 'head_depth': 1.08, 'body_width': 1.10, 'limbs': 1.12, 'cap_start': .78, 'cap_compress': .65},
}

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def curves(action):
    legacy = getattr(action, 'fcurves', None)
    if legacy is not None:
        return list(legacy)
    return [curve for layer in action.layers for strip in layer.strips
            for bag in getattr(strip, 'channelbags', []) for curve in bag.fcurves]

def rig_signature(mesh, arm):
    """Native edits may change the mesh, but not silently discard animation/rig edits."""
    objects = set()
    for obj in (mesh, arm):
        while obj:
            objects.add(obj)
            obj = obj.parent
    data = {
        'objects': [(o.name, o.parent.name if o.parent else None, [list(row) for row in o.matrix_local]) for o in sorted(objects, key=lambda o:o.name)],
        'bones': [(b.name, b.parent.name if b.parent else None, [list(row) for row in b.matrix_local]) for b in arm.data.bones],
        'actions': [(a.name, [(f.data_path, f.array_index, [(list(p.co), list(p.handle_left), list(p.handle_right), p.interpolation) for p in f.keyframe_points]) for f in curves(a)]) for a in sorted(bpy.data.actions, key=lambda a:a.name)],
        'groups': [group.name for group in mesh.vertex_groups],
        'modifiers': [(m.name, m.type, getattr(getattr(m, 'object', None), 'name', None)) for m in mesh.modifiers],
    }
    return digest(data)

def source_point(point):
    # Whole-array calibration below verifies this import basis for every original vertex.
    return (point[0] / 100, point[2] / 100, -point[1] / 100)

def source_template(name):
    path = ROOT / palette.ASSETS[name]['source']
    raw = path.read_bytes()
    document, binary, extra = gltf.parse_glb(raw)
    gltf.validate_container(document, binary)
    primitives = [(m, p) for m in document['meshes'] for p in m['primitives']]
    if len(primitives) != 1:
        raise RuntimeError('Expected the actual pack single-mesh source, not an assembled replacement.')
    mesh, primitive = primitives[0]
    attributes = primitive['attributes']
    return raw, document, binary, extra, mesh, primitive, {
        key: gltf.read_accessor(document, binary, index, normalized=key != 'JOINTS_0') for key,index in attributes.items()
    }

def skin_signatures(attributes):
    return [tuple(sorted((int(j), round(float(w), 7)) for j,w in zip(js, ws) if w > 1e-7))
            for js,ws in zip(attributes['JOINTS_0'], attributes['WEIGHTS_0'])]

def shape_points(name, mesh, arm):
    """Monotonic source-mesh shaping: never flatten separate surface layers."""
    recipe = RECIPES[name]
    coordinates = [v.co.copy() for v in mesh.data.vertices]
    height = max(v.z for v in coordinates)-min(v.z for v in coordinates)
    head = arm.data.bones['mixamorig:Head'].head_local
    groups = [g.name for g in mesh.vertex_groups]
    for vertex in mesh.data.vertices:
        bone = groups[max(vertex.groups,key=lambda g:g.weight).group]
        point = vertex.co
        if bone == 'mixamorig:Head' or bone in {'LeftEye','RightEye'}:
            point.x = head.x+(point.x-head.x)*recipe['head_width']
            point.y = head.y+(point.y-head.y)*recipe['head_depth']
            ceiling = height*recipe['cap_start']
            if point.z > ceiling: point.z = ceiling+(point.z-ceiling)*recipe['cap_compress']
        elif bone in {'mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2','mixamorig:Hips'}:
            point.x *= recipe['body_width']
        elif 'Leg' in bone or 'Foot' in bone:
            pivot = arm.data.bones[bone].head_local
            point.x = pivot.x+(point.x-pivot.x)*recipe['limbs']
            point.y = pivot.y+(point.y-pivot.y)*recipe['limbs']
        elif bone.endswith('Arm'):
            pivot = arm.data.bones[bone].head_local
            point.y = pivot.y+(point.y-pivot.y)*recipe['limbs']
            point.z = pivot.z+(point.z-pivot.z)*recipe['limbs']
    return {'restHeightBlender':height,'gridSnapping':False,
            'maxVertexMoveBlender':max((v.co-coordinates[v.index]).length for v in mesh.data.vertices)}


def repair_t_junctions(bm, deform, epsilon):
    def signature(vertex):
        return tuple(sorted((g,round(float(w),7)) for g,w in vertex[deform].items() if w>1e-7))
    groups = defaultdict(list)
    for vertex in bm.verts: groups[signature(vertex)].append(vertex)
    trees = {}
    for key,vertices in groups.items():
        tree = KDTree(len(vertices))
        for i,vertex in enumerate(vertices): tree.insert(vertex.co,i)
        tree.balance(); trees[key] = (tree,vertices)
    records = []
    for edge in list(bm.edges):
        a,b = edge.verts
        key = signature(a)
        if key != signature(b) or not key: continue
        delta = b.co-a.co
        length = delta.length
        if length < epsilon: continue
        tree,vertices = trees[key]
        points = []
        for _,i,_ in tree.find_range((a.co+b.co)*.5,length*.5+epsilon):
            vertex = vertices[i]
            if vertex in (a,b): continue
            t = (vertex.co-a.co).dot(delta)/(length*length)
            if epsilon/length < t < 1-epsilon/length and (vertex.co-a.co-delta*t).length < epsilon:
                points.append((t,vertex))
        if points: records.append((edge,a,b,sorted(points,key=lambda row:row[0])))
    count = 0
    for edge,a,b,points in records:
        if not edge.is_valid: continue
        start,previous = a,0.
        for t,target in points:
            if not target.is_valid or not edge.is_valid: continue
            _,vertex = bmesh.utils.edge_split(edge,start,(t-previous)/(1-previous))
            vertex.co = target.co
            bmesh.ops.weld_verts(bm,targetmap={vertex:target})
            count += 1
            previous,start = t,target
            edge = next((e for e in start.link_edges if b in e.verts),None)
            if edge is None: break
    bm.normal_update()
    return count


def reduce_mesh(name, obj, source_weights):
    """Weld/repair actual source surfaces, then collapse interiors with hard locks."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    original_color = mesh.color_attributes.active_color
    source_colors = []
    for triangle in mesh.loop_triangles:
        samples = [tuple(original_color.data[i if original_color.domain=='CORNER' else mesh.loops[i].vertex_index].color)
                   for i in triangle.loops]
        source_colors.append(samples)
    source_triangles = [tuple(mesh.vertices[i].co.copy() for i in t.vertices) for t in mesh.loop_triangles]
    source_surface = BVHTree.FromPolygons([v.co.copy() for v in mesh.vertices],
        [list(t.vertices) for t in mesh.loop_triangles],all_triangles=True)
    group_names = [group.name for group in obj.vertex_groups]
    source_points = defaultdict(list)
    for vertex in mesh.vertices:
        source_points[source_weights[vertex.index]].append((vertex.co.copy(),vertex.index))
    _,document,_,_,_,_,source_attributes = source_template(name)
    joint_names = [document['nodes'][i]['name'] for i in document['skins'][0]['joints']]
    trees = {}
    for signature,points in source_points.items():
        tree = KDTree(len(points))
        for point,index in points: tree.insert(point,index)
        tree.balance()
        total=sum(w for _,w in signature)
        trees[tuple(sorted((joint_names[j],round(w/total,6)) for j,w in signature))] = tree
    ancestry = mesh.attributes.new('source_vertex','INT','POINT')
    for i,item in enumerate(ancestry.data): item.value=i
    color_name = mesh.color_attributes.active_color.name
    original_material = mesh.materials[0]
    bm = bmesh.new(); bm.from_mesh(mesh)
    deform = bm.verts.layers.deform.active
    height = max(v.co.z for v in bm.verts)-min(v.co.z for v in bm.verts)
    epsilon = max(1e-4,height*1e-7)
    def weights(vertex):
        items=[(group_names[g],float(w)) for g,w in vertex[deform].items() if w>1e-7]
        total=sum(w for _,w in items)
        return tuple(sorted((g,round(w/total,6)) for g,w in items))
    by_skin = defaultdict(list)
    for vertex in bm.verts: by_skin[weights(vertex)].append(vertex)
    for vertices in by_skin.values(): bmesh.ops.remove_doubles(bm,verts=vertices,dist=epsilon)
    splits = repair_t_junctions(bm,deform,epsilon)
    bm.verts.ensure_lookup_table(); bm.verts.index_update(); bm.edges.ensure_lookup_table()
    boundary_before = sum(len(edge.link_faces)==1 for edge in bm.edges)
    critical = {'LeftEye','RightEye','Arrow','BowString','Quiver'}
    if name=='troll': critical.add('mixamorig:Head')
    if name=='archer-crew':
        # The hood, chest panels and bow gloves are already very thin source
        # solids. Keep these intact rather than flattening their opposite walls.
        critical.update({'mixamorig:RightHand','mixamorig:LeftHand','mixamorig:Head','mixamorig:Spine2'})
    protected = set()
    extents = {}
    for signature,vertices in by_skin.items():
        valid = [v for v in vertices if v.is_valid]
        if valid: extents[signature]=([min(v.co[a] for v in valid) for a in range(3)], [max(v.co[a] for v in valid) for a in range(3)])
    for face in bm.faces:
        signatures = {weights(v) for v in face.verts}
        if len(signatures)>1: protected.update(face.verts)
    for edge in bm.edges:
        if len(edge.link_faces)!=2: protected.update(edge.verts)
    for vertex in bm.verts:
        signature = weights(vertex)
        # A voxel corner belongs to three independent surface planes. Lock it;
        # only redundant points along planes/straight creases may collapse.
        normals = [face.normal for face in vertex.link_faces]
        if name!='archer-crew' and any(abs(a.cross(b).dot(c))>.01 for i,a in enumerate(normals)
               for j,b in enumerate(normals[i+1:],i+1) for c in normals[j+1:]):
            protected.add(vertex)
        if any(bone in critical for bone,_ in signature): protected.add(vertex)
        bone = max(signature,key=lambda row:row[1])[0]
        axis = 0 if bone.endswith('Arm') else 2 if ('Leg' in bone or 'Foot' in bone) else None
        if axis is not None:
            lo,hi = extents[signature][0][axis],extents[signature][1][axis]
            if vertex.co[axis]-lo < height*.015 or hi-vertex.co[axis] < height*.015: protected.add(vertex)
    protected_points = [(v.co.copy(),weights(v)) for v in protected]
    locked = {v.index for v in protected}
    bm.to_mesh(mesh); bm.free(); mesh.update()
    mask = obj.vertex_groups.new(name='ReductionInterior')
    mask_name = mask.name
    editable = [v.index for v in mesh.vertices if v.index not in locked]
    if editable: mask.add(editable,1.,'REPLACE')
    # Zero-weight vertices are hard locks at factor 1, inversion off. Evaluate the
    # decimator BEFORE the armature so posed geometry is never baked into rest data.
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    armatures = [(modifier.name,modifier.show_viewport) for modifier in obj.modifiers if modifier.type=='ARMATURE']
    for modifier_name,_ in armatures: obj.modifiers[modifier_name].show_viewport=False
    modifier = obj.modifiers.new('Source surface simplification','DECIMATE')
    modifier.decimate_type='COLLAPSE'
    modifier.ratio=RECIPES[name]['decimate_ratio']
    modifier.vertex_group=mask_name
    modifier.vertex_group_factor=1.
    modifier.invert_vertex_group=False
    modifier.use_collapse_triangulate=True
    try:
        bpy.context.view_layer.update()
        bpy.ops.object.modifier_move_to_index(modifier=modifier.name,index=0)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    finally:
        for modifier_name,visible in armatures: obj.modifiers[modifier_name].show_viewport=visible
        current_mask=obj.vertex_groups.get(mask_name)
        if current_mask: obj.vertex_groups.remove(current_mask)
    mesh=obj.data
    bm=bmesh.new(); bm.from_mesh(mesh); bm.normal_update()
    boundary_after=sum(len(edge.link_faces)==1 for edge in bm.edges)
    bm.to_mesh(mesh); bm.free(); mesh.update()
    if boundary_after>boundary_before: raise RuntimeError('Simplification opened additional surface boundaries.')
    def current_signature(vertex):
        items=[(group_names[g.group],float(g.weight)) for g in vertex.groups if g.weight>1e-7]
        total=sum(w for _,w in items)
        return tuple(sorted((g,round(w/total,6)) for g,w in items))
    output_trees={}
    grouped=defaultdict(list)
    for vertex in mesh.vertices: grouped[current_signature(vertex)].append(vertex.co.copy())
    for signature,points in grouped.items():
        tree=KDTree(len(points))
        for i,point in enumerate(points): tree.insert(point,i)
        tree.balance(); output_trees[signature]=tree
    for point,signature in protected_points:
        if signature not in output_trees or output_trees[signature].find(point)[2]>epsilon*2:
            raise RuntimeError('Simplification moved or removed a protected boundary/eye/joint vertex.')
    attr=mesh.attributes['source_vertex']
    max_distance=0.
    for vertex in mesh.vertices:
        signature=current_signature(vertex)
        candidates=[key for key in trees if [g for g,_ in key]==[g for g,_ in signature]
                    and all(abs(a[1]-b[1])<=2e-6 for a,b in zip(key,signature))]
        if not candidates: raise RuntimeError(f'Simplification crossed a skin influence boundary: {signature}')
        _,index,distance=min((trees[key].find(vertex.co) for key in candidates),key=lambda row:row[2])
        attr.data[vertex.index].value=index
        max_distance=max(max_distance,distance)
        # Decimate normalizes all deform groups, including its temporary mask.
        # Restore the exact original skin row after removing that non-bone group.
        for assignment in list(vertex.groups): obj.vertex_groups[assignment.group].remove([vertex.index])
        for joint,weight in zip(source_attributes['JOINTS_0'][index],source_attributes['WEIGHTS_0'][index]):
            if weight>1e-7: obj.vertex_groups[joint_names[int(joint)]].add([vertex.index],float(weight),'REPLACE')
    # Re-sample the original corner paint, including its ambient shading. A flat
    # color chosen per triangle turns that shading into visible triangle patches.
    # Pull queries slightly inside each face to preserve hard paint seams.
    color=mesh.color_attributes.active_color
    for face in mesh.polygons:
        for i in face.loop_indices:
            point=mesh.vertices[mesh.loops[i].vertex_index].co
            nearest,_,source_face,_=source_surface.find_nearest(point.lerp(face.center,.0001))
            a,b,c=source_triangles[source_face]
            u,v,p=b-a,c-a,nearest-a
            uu,uv,vv,pu,pv=u.dot(u),u.dot(v),v.dot(v),p.dot(u),p.dot(v)
            denominator=uu*vv-uv*uv
            if abs(denominator)<1e-12:
                bary=(1.,0.,0.)
            else:
                y=(vv*pu-uv*pv)/denominator
                z=(uu*pv-uv*pu)/denominator
                bary=(1-y-z,y,z)
            color.data[i].color=tuple(sum(w*rgba[channel] for w,rgba in zip(bary,source_colors[source_face])) for channel in range(4))
        face.use_smooth=False
    mesh.materials.clear(); mesh.materials.append(original_material)
    for face in mesh.polygons: face.material_index=0
    mesh.calc_loop_triangles()
    return {'nativeVertices':len(mesh.vertices),'nativeTriangles':len(mesh.loop_triangles),
        'tJunctionSplits':splits,'boundaryEdgesBefore':boundary_before,'boundaryEdgesAfter':boundary_after,
        'protectedVertices':len(protected_points),'protectedVerticesPreserved':True,
        'maxRetopologyDistanceBlender':max_distance}

def add_accessor(document, binary, rows, component, kind, target=None, bounds=False, normalized=False):
    while len(binary)%4: binary.append(0)
    offset = len(binary)
    formats = {5126:'f', 5123:'H', 5125:'I', 5121:'B'}
    count = {'SCALAR':1,'VEC3':3,'VEC4':4}[kind]
    fmt = '<'+formats[component]*count
    for row in rows: binary.extend(struct.pack(fmt, *row))
    view = {'buffer':0, 'byteOffset':offset, 'byteLength':len(binary)-offset}
    if target: view['target'] = target
    view_id = len(document['bufferViews']); document['bufferViews'].append(view)
    definition = {'bufferView':view_id,'componentType':component,'count':len(rows),'type':kind}
    if bounds:
        definition['min'] = [min(row[i] for row in rows) for i in range(count)]
        definition['max'] = [max(row[i] for row in rows) for i in range(count)]
    if normalized: definition['normalized'] = True
    accessor_id = len(document['accessors']); document['accessors'].append(definition)
    return accessor_id

def motion_signature(document, binary):
    """Semantic source data hash, independent of accessor renumbering/buffer packing."""
    animations = []
    for clip in document['animations']:
        animations.append({'name':clip['name'], 'channels':clip['channels'], 'samplers':[
            {'interpolation':s.get('interpolation','LINEAR'),
             'input':gltf.read_accessor(document,binary,s['input']),
             'output':gltf.read_accessor(document,binary,s['output'])} for s in clip['samplers']]})
    return digest({'animations':animations,'nodes':[{k:v for k,v in n.items() if k!='extras'} for n in document['nodes']],
        'skins':[{k:v for k,v in s.items() if k!='inverseBindMatrices'} for s in document['skins']],
        'inverseBindMatrices':[gltf.read_accessor(document,binary,s['inverseBindMatrices']) for s in document['skins']]})

def export_existing(name):
    native = OUT/f'{name}.blend'
    bpy.ops.wm.open_mainfile(filepath=str(native))
    mesh, arm = palette.scene_objects()
    if mesh.get('refinedRigSignature') != rig_signature(mesh, arm):
        raise RuntimeError('Rig/animation/transform edits detected. This geometry exporter never discards them silently.')
    raw, document, original_bin, extra, original_mesh, primitive, attributes = source_template(name)
    source_hash = hashlib.sha256(raw).hexdigest()
    if source_hash != mesh['refinedSourceHash']:
        raise RuntimeError('Original pack source changed; refusing to map a different rig.')
    source_motion = motion_signature(document, original_bin)
    bone_names = [document['nodes'][i]['name'] for i in document['skins'][0]['joints']]
    ancestry_attr = mesh.data.attributes.get('source_vertex')
    if not ancestry_attr or len(ancestry_attr.data) != len(mesh.data.vertices):
        raise RuntimeError('Mesh is missing source-vertex ancestry. Keep this point attribute when editing.')
    ancestors = [int(v.value) for v in ancestry_attr.data]
    for vertex in mesh.data.vertices:
        ancestor = ancestors[vertex.index]
        if ancestor < 0 or ancestor >= len(attributes['POSITION']): raise RuntimeError('Unmapped source vertex.')
        actual = {mesh.vertex_groups[g.group].name:float(g.weight) for g in vertex.groups if g.weight>1e-7}
        expected = {bone_names[int(j)]:float(w) for j,w in zip(attributes['JOINTS_0'][ancestor],attributes['WEIGHTS_0'][ancestor]) if w>1e-7}
        if actual.keys() != expected.keys() or any(abs(actual[key]-expected[key])>1e-6 for key in actual):
            raise RuntimeError(f'Vertex {vertex.index} ancestor {ancestor} skin weights changed: {actual} != {expected}.')
    mesh.data.calc_loop_triangles()
    color = mesh.data.color_attributes.active_color
    rows = {'POSITION':[], 'NORMAL':[], 'COLOR_0':[], 'JOINTS_0':[], 'WEIGHTS_0':[]}
    indices, ancestry_rows, unique = [], [], {}
    for triangle in mesh.data.loop_triangles:
        if triangle.area < 1e-8: continue
        normal = source_point(triangle.normal)
        normal = Vector(normal).normalized()
        for loop_index in triangle.loops:
            vertex_index = mesh.data.loops[loop_index].vertex_index
            vertex = mesh.data.vertices[vertex_index]
            rgba = tuple(float(v) for v in color.data[loop_index].color)
            ancestor = ancestors[vertex_index]
            key = (vertex_index, tuple(round(v,6) for v in normal), tuple(round(v,6) for v in rgba))
            if key not in unique:
                unique[key] = len(rows['POSITION'])
                rows['POSITION'].append(source_point(vertex.co))
                rows['NORMAL'].append(tuple(normal))
                rows['COLOR_0'].append(rgba)
                rows['JOINTS_0'].append(tuple(int(v) for v in attributes['JOINTS_0'][ancestor]))
                rows['WEIGHTS_0'].append(attributes['WEIGHTS_0'][ancestor])
                ancestry_rows.append(ancestor)
            indices.append((unique[key],))
    binary = bytearray(original_bin[:document['buffers'][0]['byteLength']])
    primitive['attributes'] = {
        'POSITION':add_accessor(document,binary,rows['POSITION'],5126,'VEC3',34962,True),
        'NORMAL':add_accessor(document,binary,rows['NORMAL'],5126,'VEC3',34962),
        'COLOR_0':add_accessor(document,binary,rows['COLOR_0'],5126,'VEC4',34962),
        'JOINTS_0':add_accessor(document,binary,rows['JOINTS_0'],5123,'VEC4',34962),
        'WEIGHTS_0':add_accessor(document,binary,rows['WEIGHTS_0'],5126,'VEC4',34962),
    }
    primitive['indices'] = add_accessor(document,binary,indices,5123 if len(rows['POSITION'])<65536 else 5125,'SCALAR',34963)
    primitive.pop('targets', None)
    metadata = {'source':palette.ASSETS[name]['source'], 'sourceSha256':source_hash,
        'geometryRevision':'refined-pack-v1', 'recipe':RECIPES[name],
        'ancestry':{'encoding':'source-vertex-index','role':'source skin-influence representative for decimated source surfaces','indices':ancestry_rows},
        'sourceMotionSha256':source_motion, 'adaptation':'Reduced and shape-refined actual pack mesh; original rig and all ten animations preserved.'}
    for node in document['nodes']:
        if 'mesh' in node:
            node.setdefault('extras', {})['gloamwardRework'] = metadata
    # Only prune unreferenced geometry; DO NOT optimize/rebake/remove animation channels.
    gltf._compact_accessors(document)
    binary, _ = gltf._repack_views(document, bytes(binary))
    gltf.validate_container(document, binary)
    gltf._validate_skin_weights(document, binary)
    if motion_signature(document,binary) != source_motion:
        raise RuntimeError('Source rig or animation data changed during geometry packing.')
    output = gltf.serialize_glb(document,binary,extra)
    gltf.validate_container(*gltf.parse_glb(output)[:2])
    source_document, source_binary, _ = gltf.parse_glb(raw)
    triangles = len(indices)//3
    source_triangles = palette.primitive_triangles(source_document,source_binary)
    report = {'asset':name,'sourcePath':metadata['source'],'sourceSha256':source_hash,
        'pipeline':str(Path(__file__).resolve().relative_to(ROOT)),
        'pipelineSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'geometryRevision':metadata['geometryRevision'], 'blender':bpy.app.version_string,
        'recipe':RECIPES[name], 'sourceTriangles':source_triangles, 'triangles':triangles,
        'reductionPercent':round((1-triangles/source_triangles)*100,2),
        'sourceVertices':len(attributes['POSITION']), 'vertices':len(rows['POSITION']),
        'sourceBytes':len(raw), 'bytes':len(output), 'clips':gltf._metrics(document,binary)['clip_durations'],
        'joints':len(document['skins'][0]['joints']), 'sourceMotionSha256':source_motion,
        'exportedMotionSha256':motion_signature(document,binary), 'originalMotionDataExact':True,
        'nativeSource':str(native.relative_to(ROOT)) if native.is_relative_to(ROOT) else str(native), 'nativeSourceSha256':hashlib.sha256(native.read_bytes()).hexdigest(),
        'shapeEdits':json.loads(mesh['refinementStats']), 'nativeMeshTriangles':len(mesh.data.loop_triangles),
        'method':'Shape actual source surfaces without grid snapping; repair T-junctions; constrained surface collapse with protected eyes, boundaries and joints. Splice only mesh accessors into original rig.'}
    # Publish only after every data check succeeds.
    (OUT/f'{name}.glb').write_bytes(output)
    (OUT/f'{name}.json').write_text(json.dumps(report,indent=2)+'\n')
    print('REFINED', json.dumps(report))
    return report

def initialize(name):
    path = OUT/f'{name}.blend'
    if path.exists(): raise RuntimeError(f'{path} exists. Edit it and use --export-existing; initialization never overwrites native edits.')
    bpy.ops.wm.open_mainfile(filepath=str(palette.OUT/f'{name}.blend'))
    mesh, arm = palette.scene_objects()
    raw, document, binary, _, _, _, attributes = source_template(name)
    if len(mesh.data.vertices) != len(attributes['POSITION']): raise RuntimeError('Source/native vertex mapping differs.')
    max_error = max((Vector(source_point(v.co))-Vector(attributes['POSITION'][v.index])).length for v in mesh.data.vertices)
    if max_error > 2e-6: raise RuntimeError(f'Whole-mesh source/native basis calibration failed: {max_error}')
    stats = shape_points(name, mesh, arm)
    stats.update(reduce_mesh(name,mesh,skin_signatures(attributes)))
    mesh['refinementStats'] = json.dumps(stats)
    mesh['refinedRigSignature'] = rig_signature(mesh,arm)
    mesh['refinedSourceHash'] = hashlib.sha256(raw).hexdigest()
    mesh['gloamwardPaletteOnly'] = False
    mesh['gloamwardRework'] = json.dumps({'source':palette.ASSETS[name]['source'], 'geometryRevision':'refined-pack-v1'})
    bpy.context.preferences.filepaths.save_version = 0
    for obj in bpy.context.scene.objects: obj.select_set(False)
    mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
    bpy.ops.wm.save_as_mainfile(filepath=str(path),compress=True)
    return export_existing(name)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--asset',choices=[*RECIPES,'all'],default='all')
    parser.add_argument('--export-existing',action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    OUT.mkdir(parents=True,exist_ok=True)
    for name in RECIPES if args.asset=='all' else [args.asset]:
        export_existing(name) if args.export_existing else initialize(name)
