"""One-time authoring of seven roofless archer structures. Never overwrites a native edit.

blender -b --python assets-src/rework/pipeline/build_archer_proof.py
Then export the editable .blend with export_archer_proof.py (no regeneration).
Coordinates below use game-space X/right, Y/up, Z/depth.
"""
import json
import math
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'assets-src/rework/proof/archers/archers.blend'
if OUT.exists():
    raise RuntimeError('Native source already exists; edit it, then use export_archer_proof.py.')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

PALETTE = {'wood': '#865b36', 'edge': '#a57342', 'dark': '#624329',
           'stone': '#999994', 'stone-dark': '#7e827f', 'iron': '#5b666a',
           'orange': '#ca6a2c', 'plank': '#a17b4c'}
MATS = {}
for name, hex_color in PALETTE.items():
    channels = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*linear, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear, 1)
    shader.inputs['Roughness'].default_value = .92
    MATS[name] = mat

def xyz(v): return Vector((v[0], -v[2], v[1]))
current = None
counter = 0

def block(name, pos, size, color='wood', bevel=.009):
    global counter
    counter += 1
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos))
    obj = bpy.context.object
    obj.name = f'{counter:04d} {name}'
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = current
    obj.data.materials.append(MATS[color])
    modifier = obj.modifiers.new('Small voxel edge', 'BEVEL')
    modifier.width = min(bevel, min(size) * .12)
    modifier.segments = 1
    obj['part'] = name
    return obj

def beam(name, a, b, width=.11, color='wood'):
    mid = tuple((a[i] + b[i]) / 2 for i in range(3))
    obj = block(name, mid, (width, (Vector(a)-Vector(b)).length, width), color)
    direction = xyz(b) - xyz(a)
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return obj

def stone_foot(x, z, y=.12):
    block('Foundation block', (x, y, z), (.26, .24, .26), 'stone')

def deck(y, width=1.2, depth=1.1, x=0, z=0):
    n = max(3, round(width / .2))
    for i in range(n):
        block('Deck plank', (x-width/2+(i+.5)*width/n, y-.07, z), (width/n-.009, .14, depth), 'plank')
    for dz in (-depth/2+.055, depth/2-.055):
        block('Deck rim', (x, y-.15, z+dz), (width+.04, .13, .13), 'dark')

def rail(y, width=1.16, depth=1.04, x=0, z=0, front=True):
    # Front stays low enough for a real pack character's bow to clear it.
    for dx in (-width/2, width/2):
        for dz in (-depth/2, depth/2):
            block('Railing post', (x+dx, y+.18, z+dz), (.1, .38, .1), 'edge')
        block('Side handrail', (x+dx, y+.35, z), (.11, .09, depth+.06), 'edge')
    block('Rear handrail', (x, y+.35, z+depth/2), (width, .09, .11), 'edge')
    if front:
        block('Low firing rail', (x, y+.17, z-depth/2), (width, .12, .1), 'wood')

def legs(y, span=.9, stone=False):
    for x in (-span/2, span/2):
        for z in (-span/2, span/2):
            stone_foot(x, z)
            block('Upright timber', (x, (y+.18)/2, z), (.15, y-.18, .15), 'wood')
    for z in (-span/2, span/2):
        beam('Cross brace', (-span/2, .3, z), (span/2, y-.2, z), .115, 'edge')
        beam('Cross brace', (span/2, .3, z), (-span/2, y-.2, z), .1, 'dark')
    for x in (-span/2, span/2):
        beam('Side brace', (x, .35, -span/2), (x, y-.2, span/2), .1, 'wood')

def masonry(y, width=.8, depth=.8, open_front=False):
    rows = round(y/.22)
    h = y/rows
    for row in range(rows):
        # Deliberate courses; seams are visible but the tower remains a simple mass.
        for side in range(4):
            if side == 0 and open_front: continue
            n = 3
            for i in range(n):
                a = -width/2 + (i+.5)*width/n
                b = -depth/2 + (i+.5)*depth/n
                p = (a, (row+.5)*h, -depth/2) if side == 0 else (a, (row+.5)*h, depth/2) if side == 1 else (-width/2, (row+.5)*h, b) if side == 2 else (width/2, (row+.5)*h, b)
                dims = (width/n-.009, h-.009, .19) if side < 2 else (.19, h-.009, depth/n-.009)
                block('Masonry course', p, dims, 'stone-dark' if (row+i+side)%5 == 0 else 'stone')

def socket(index, pos, height=.72):
    obj = bpy.data.objects.new(f'crew-{index}', None)
    bpy.context.collection.objects.link(obj)
    obj.parent = current
    obj.location = xyz(pos)
    obj.scale = (height/1.02,)*3
    obj['component_id'] = f'crew-{index}'
    obj['character_id'] = 'archer-crew'
    obj['presentation_height'] = height
    obj.empty_display_type = 'ARROWS'
    obj.empty_display_size = .15

def anchor(name, pos):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = current
    obj.location = xyz(pos)
    obj['component_id'] = name

DESIGNS = []
def start(state, label, description):
    global current
    current = bpy.data.objects.new('tower/archer/'+state, None)
    bpy.context.collection.objects.link(current)
    current['asset_id'] = 'tower/archer/'+state
    current['label'] = label
    current['design'] = description
    current['revision'] = 'stage-2-review'
    DESIGNS.append({'id': current['asset_id'], 'label': label, 'design': description})

start('tier-1', 'Timber lookout', 'Four timber stilts with exposed X braces and a single open plank deck.')
legs(1.08)
deck(1.08)
rail(1.08)
socket(0, (0, 1.08, .07))
anchor('muzzle', (0, 1.61, -.54))

start('tier-2', 'Stone-footed watchstand', 'Low coursed stone plinth, cantilever braces, open timber upper frame and a front access ladder.')
masonry(.5, .83, .76)
for x in (-.43, .43):
    for z in (-.4, .4):
        block('Upper timber', (x, .94, z), (.14, .88, .14), 'wood')
        beam('Cantilever bracket', (x, .56, z*.65), (x*1.28, 1.18, z*1.22), .115, 'edge')
deck(1.36, 1.25, 1.12)
rail(1.36, 1.19, 1.06)
for x in (-.17, .17): beam('Ladder side', (x, .08, -.62), (x, 1.34, -.46), .055, 'dark')
for i in range(5): block('Ladder rung', (0, .22+i*.22, -.60+i*.025), (.38, .045, .055), 'edge')
socket(0, (0, 1.36, .09))
anchor('muzzle', (0, 1.89, -.54))

start('tier-3', 'Masonry watchtower', 'Square stone shaft, stepped corner buttresses and a broad wood fighting platform with low stone merlons.')
masonry(1.62, .79, .79, True)
for x in (-.49, .49):
    for z in (-.49, .49):
        for j in range(3): block('Stepped buttress', (x, .16+j*.27, z), (.27-j*.035, .31, .27-j*.035), 'stone-dark')
deck(1.64, 1.3, 1.18)
for x in (-.58, .58):
    for z in (-.5, .5): block('Stone corner merlon', (x, 1.84, z), (.2, .4, .2), 'stone')
rail(1.64, 1.16, 1.0, front=False)
socket(0, (0, 1.64, .06))
anchor('muzzle', (0, 2.17, -.55))

start('fork-a-1', 'Longbow perch', 'Narrow tall braced timber lookout on two massive side trestles; one unobstructed firing position.')
for x in (-.37, .37):
    for z in (-.3, .3):
        stone_foot(x, z)
        beam('Splayed trestle', (x*1.25, .2, z*1.4), (x, 1.91, z), .17, 'wood')
    beam('Tall diagonal brace', (x*1.25, .25, -.4), (x, 1.78, .3), .12, 'edge')
    block('Side cross tie', (x, .87, 0), (.19, .16, .85), 'dark')
deck(1.94, .98, .88)
rail(1.94, .92, .82, front=False)
block('Longbow equipment rack', (.34, 2.15, .29), (.1, .42, .12), 'dark')
socket(0, (0, 1.94, -.015), .76)
anchor('muzzle', (0, 2.49, -.53))

start('fork-a-2', 'Eagle-eye gantry', 'Offset stone observation pier and a cantilevered split-level timber perch, joined by a visible side stair.')
masonry(1.65, .53, .69)
for x in (-.23, .23):
    beam('Cantilever beam', (x, 1.26, .23), (x, 2.14, -.47), .17, 'edge')
deck(2.16, 1.08, .84, 0, -.18)
rail(2.16, 1.02, .78, 0, -.18, False)
deck(1.62, .46, .75, .44, .23)
for i in range(4): block('Observation steps', (.45, 1.68+i*.12, .41-i*.16), (.35, .12, .17), 'wood')
block('Rear observation mast', (-.42, 2.22, .43), (.11, 1.17, .11), 'dark')
for j in range(2): block('Orange signal tab', (-.26+j*.13, 2.72-j*.035, .43), (.16, .13, .055), 'orange')
socket(0, (0, 2.16, -.22), .76)
anchor('muzzle', (0, 2.71, -.66))

start('fork-b-1', 'Twin volley stand', 'Two separated low firing bays with a central access notch and a shared stone-backed Y-braced trestle.')
for x in (-.45, .45):
    for z in (-.38, .38):
        stone_foot(x, z)
        block('Trestle upright', (x, .79, z), (.17, 1.35, .17), 'wood')
    beam('Y brace', (x, .54, .0), (x-.19, 1.41, -.4), .12, 'edge')
    beam('Y brace', (x, .54, .0), (x+.19, 1.41, .4), .12, 'edge')
for x in (-.35, .35):
    deck(1.5, .61, 1.0, x, 0)
    rail(1.5, .55, .94, x, 0, False)
    socket(0 if x < 0 else 1, (x, 1.5, -.03), .61)
block('Rear shared cross beam', (0, 1.34, .47), (1.38, .17, .15), 'dark')
anchor('muzzle', (0, 1.97, -.57))

start('fork-b-2', 'Arrow-storm battery', 'Three staggered firing platforms: two low side bays and a raised rear centre bay, on a stone-and-timber gantry.')
for x in (-.48, .48):
    for z in (-.42, .42):
        for row in range(4): block('Battery stone pier', (x, .12+row*.23, z), (.23, .22, .23), 'stone-dark' if row%2 else 'stone')
        block('Battery timber upright', (x, 1.15, z), (.15, .62, .15), 'wood')
for x in (-.37, .37):
    deck(1.43, .58, .86, x, -.2)
    rail(1.43, .52, .8, x, -.2, False)
    socket(0 if x < 0 else 1, (x, 1.43, -.24), .57)
beam('Rear gantry support', (-.48, .75, .42), (0, 1.9, .37), .15, 'edge')
beam('Rear gantry support', (.48, .75, .42), (0, 1.9, .37), .15, 'edge')
deck(1.94, .62, .63, 0, .32)
rail(1.94, .56, .57, 0, .32, False)
socket(2, (0, 1.94, .32), .61)
anchor('muzzle', (0, 2.4, -.57))

for asset in [obj for obj in bpy.context.scene.objects if 'asset_id' in obj]:
    anchor_parent = current
    current = asset
    anchor('feet', (0, 0, 0))
    anchor('aim', (0, 1.7, 0))
    current = anchor_parent
bpy.context.scene['art_status'] = 'Stage 2 visual proof, pending user review; roofless per user decision.'
bpy.context.scene['reference'] = 'First voxel artwork: warm timber, cool stone, chunky cubes and restrained orange.'
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT))
OUT.with_suffix('.designs.json').write_text(json.dumps(DESIGNS, indent=2)+'\n')
print('AUTHORED', OUT)
