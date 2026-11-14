import json
import math
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "assets-src" / "pipeline"))
import gltf_tools as gt  # noqa: E402


def make_glb(animation_specs, *, mesh=True):
    binary = bytearray()
    views, accessors, samplers, channels = [], [], [], []

    def add_accessor(values, kind, component=5126, normalized=False, stride=None):
        fmt, size = gt.COMPONENT_FORMATS[component]
        components = gt.COMPONENTS[kind]
        offset = (len(binary) + 3) & ~3
        binary.extend(b"\0" * (offset - len(binary)))
        rows = values
        for row in rows:
            binary.extend(struct.pack("<" + fmt * components, *row))
            if stride and stride > size * components:
                binary.extend(b"\0" * (stride - size * components))
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(binary) - offset}
        if stride:
            view["byteStride"] = stride
        views.append(view)
        accessor = {"bufferView": len(views) - 1, "componentType": component,
                    "count": len(rows), "type": kind}
        if normalized:
            accessor["normalized"] = True
        accessors.append(accessor)
        return len(accessors) - 1

    nodes = [{"name": "Rig", "mesh": 0 if mesh else None, "skin": 0 if mesh else None}]
    meshes = []
    skins = []
    if mesh:
        pos = add_accessor([(0, 0, 0), (1, 0, 0), (0, 1, 0)], "VEC3")
        joints = add_accessor([(0, 0, 0, 0)] * 3, "VEC4", component=5121)
        weights = add_accessor([(255, 0, 0, 0)] * 3, "VEC4", component=5121, normalized=True)
        indices = add_accessor([(0,), (1,), (2,)], "SCALAR", component=5123)
        meshes.append({"primitives": [{"attributes": {"POSITION": pos, "JOINTS_0": joints,
                                                           "WEIGHTS_0": weights}, "indices": indices,
                                      "material": 0}]})
        skins.append({"joints": [0]})

    for spec in animation_specs:
        times = add_accessor(spec["times"], "SCALAR")
        out_kind = spec.get("type", "VEC3")
        output = add_accessor(spec["values"], out_kind)
        samplers.append({"input": times, "output": output, "interpolation": spec.get("interpolation", "LINEAR")})
        channels.append({"sampler": len(samplers) - 1,
                         "target": {"node": 0, "path": spec["path"]}})
    doc = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0]}],
           "nodes": nodes, "buffers": [{"byteLength": len(binary)}],
           "bufferViews": views, "accessors": accessors, "materials": [{"name": "Kept"}],
           "animations": [{"name": "Walk", "samplers": samplers, "channels": channels}]}
    if mesh:
        doc["meshes"] = meshes
        doc["skins"] = skins
    return gt.serialize_glb(doc, binary)


class GltfToolsTests(unittest.TestCase):
    def test_default_constant_channels_pruned_but_meaningful_constant_kept(self):
        glb = make_glb([
            {"path": "translation", "times": [(0,), (1,)], "values": [(0, 0, 0), (0, 0, 0)]},
            {"path": "scale", "times": [(0,), (1,)], "values": [(2, 1, 1), (2, 1, 1)]},
        ], mesh=False)
        optimized, report = gt.optimize_glb_bytes(glb)
        doc, binary, _ = gt.parse_glb(optimized)
        self.assertEqual(report["removed_constant_channels"], 1)
        self.assertEqual(len(doc["animations"][0]["channels"]), 1)
        ch = doc["animations"][0]["channels"][0]
        vals = gt.read_accessor(doc, binary, doc["animations"][0]["samplers"][ch["sampler"]]["output"])
        self.assertEqual(vals, [(2.0, 1.0, 1.0), (2.0, 1.0, 1.0)])

    def test_quaternion_sign_equivalence_is_default(self):
        glb = make_glb([
            {"path": "rotation", "type": "VEC4", "times": [(0,), (1,)],
             "values": [(0, 0, 0, 1), (0, 0, 0, -1)]},
            {"path": "translation", "times": [(0,), (1,)], "values": [(0, 0, 0), (1, 0, 0)]},
        ], mesh=False)
        _, report = gt.optimize_glb_bytes(glb)
        self.assertEqual(report["removed_constant_channels"], 1)

    def test_reference_duration_trims_and_linearly_resamples_terminal_key(self):
        output = make_glb([{"path": "translation", "times": [(0,), (1,), (2,)],
                            "values": [(0, 0, 0), (10, 0, 0), (20, 0, 0)]}], mesh=False)
        reference = make_glb([{"path": "translation", "times": [(0,), (1.8,)],
                               "values": [(0, 0, 0), (1, 0, 0)]}], mesh=False)
        optimized, report = gt.optimize_glb_bytes(output, reference)
        doc, binary, _ = gt.parse_glb(optimized)
        animation = doc["animations"][0]
        sampler = animation["samplers"][animation["channels"][0]["sampler"]]
        self.assertAlmostEqual(gt.read_accessor(doc, binary, sampler["input"])[-1][0], 1.8)
        self.assertAlmostEqual(gt.read_accessor(doc, binary, sampler["output"])[-1][0], 18.0)
        self.assertAlmostEqual(report["after"]["clip_durations"]["Walk"], 1.8, places=6)

    def test_step_uses_left_value_and_cubic_is_left_untouched(self):
        output = make_glb([{"path": "translation", "times": [(0,), (1,), (2,)],
                            "values": [(0, 0, 0), (4, 0, 0), (9, 0, 0)], "interpolation": "STEP"}], mesh=False)
        reference = make_glb([{"path": "translation", "times": [(0,), (1.5,)],
                               "values": [(0, 0, 0), (1, 0, 0)]}], mesh=False)
        optimized, _ = gt.optimize_glb_bytes(output, reference)
        doc, binary, _ = gt.parse_glb(optimized)
        sampler = doc["animations"][0]["samplers"][0]
        self.assertEqual(gt.read_accessor(doc, binary, sampler["output"])[-1][0], 4)

        cubic = make_glb([{"path": "translation", "times": [(0,), (2,)],
                           "values": [(0, 0, 0), (1, 1, 1)], "interpolation": "CUBICSPLINE"}], mesh=False)
        cubic_out, report = gt.optimize_glb_bytes(cubic, reference)
        cubic_doc, cubic_bin, _ = gt.parse_glb(cubic_out)
        self.assertEqual(gt._duration(cubic_doc, cubic_bin, cubic_doc["animations"][0]), 2)
        self.assertGreaterEqual(report["preserved_cubic_samplers"], 1)

    def test_mesh_skin_weights_material_and_binary_payload_survive(self):
        original = make_glb([{"path": "translation", "times": [(0,), (1,)],
                              "values": [(0, 0, 0), (1, 0, 0)]}])
        out, _ = gt.optimize_glb_bytes(original)
        before, bbin, _ = gt.parse_glb(original)
        after, abin, _ = gt.parse_glb(out)
        self.assertEqual(before["materials"], after["materials"])
        self.assertEqual(before["skins"], after["skins"])
        self.assertEqual(before["meshes"], after["meshes"])
        for field in ("POSITION", "JOINTS_0", "WEIGHTS_0"):
            a = before["meshes"][0]["primitives"][0]["attributes"][field]
            b = after["meshes"][0]["primitives"][0]["attributes"][field]
            self.assertEqual(gt.read_accessor(before, bbin, a, normalized=False),
                             gt.read_accessor(after, abin, b, normalized=False))
        for view in after["bufferViews"]:
            self.assertEqual(view.get("byteOffset", 0) % 4, 0)

    def test_rejects_broken_skin_weights_and_nonfinite(self):
        bad = make_glb([{"path": "translation", "times": [(0,), (1,)],
                         "values": [(0, 0, 0), (1, 0, 0)]}])
        doc, binary, extras = gt.parse_glb(bad)
        weight_idx = doc["meshes"][0]["primitives"][0]["attributes"]["WEIGHTS_0"]
        view = doc["bufferViews"][doc["accessors"][weight_idx]["bufferView"]]
        offset = view["byteOffset"]
        binary = bytearray(binary)
        binary[offset:offset + 4] = bytes((100, 100, 100, 100))
        with self.assertRaises(gt.GLTFError):
            gt.optimize_glb_bytes(gt.serialize_glb(doc, binary, extras))
        with self.assertRaises(gt.GLTFError):
            gt._finite_tree({"bad": float("nan")})

    def test_quaternion_slerp_is_normalized(self):
        result = gt._slerp((0, 0, 0, 1), (0, 0.70710678, 0, 0.70710678), 0.5)
        self.assertAlmostEqual(math.sqrt(sum(value * value for value in result)), 1.0)


if __name__ == "__main__":
    unittest.main()
