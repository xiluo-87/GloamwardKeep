"""Guard refined character meshes against newly introduced coplanar overlap."""
from __future__ import annotations

import hashlib
import itertools
import json
import math
import sys
import unittest
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "assets-src" / "pipeline"))
import gltf_tools  # noqa: E402

REFINED = ROOT / "assets-src" / "rework" / "refined" / "characters"
AREA_TOLERANCE = 1.0e-9
SIGNIFICANT_AREA = 1.0e-6


def _mesh_triangles(path: Path) -> tuple[list[dict[str, Any]], dict[int, str]]:
    document, binary, _ = gltf_tools.parse_glb(path.read_bytes())
    gltf_tools.validate_container(document, binary)
    meshes = document.get("meshes", [])
    if len(meshes) != 1 or len(meshes[0].get("primitives", [])) != 1:
        raise ValueError(f"expected one character mesh primitive in {path}")
    primitive = meshes[0]["primitives"][0]
    attributes = primitive["attributes"]
    positions = gltf_tools.read_accessor(document, binary, attributes["POSITION"])
    joints = gltf_tools.read_accessor(document, binary, attributes["JOINTS_0"], normalized=False)
    weights = gltf_tools.read_accessor(document, binary, attributes["WEIGHTS_0"])
    indices = gltf_tools.read_accessor(document, binary, primitive["indices"], normalized=False)
    joint_names = {index: document["nodes"][node].get("name", str(node))
                   for index, node in enumerate(document["skins"][0]["joints"])}
    vertex_signatures = [
        tuple(sorted((int(joint), round(float(weight), 5))
                     for joint, weight in zip(joint_row, weight_row)
                     if weight > 1.0e-5))
        for joint_row, weight_row in zip(joints, weights)
    ]
    if len(positions) != len(vertex_signatures):
        raise ValueError(f"POSITION and skin attributes disagree in {path}")
    flat_indices = [int(row[0]) for row in indices]
    if len(flat_indices) % 3:
        raise ValueError(f"triangle index accessor is not divisible by three in {path}")
    triangles = []
    for offset in range(0, len(flat_indices), 3):
        ids = tuple(flat_indices[offset:offset + 3])
        points = tuple(tuple(float(value) for value in positions[index]) for index in ids)
        signatures = tuple(vertex_signatures[index] for index in ids)
        triangles.append({"points": points, "skin": tuple(sorted(signatures)), "vertex_ids": ids})
    return triangles, joint_names


def _cross2(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _signed_area(polygon: list[tuple[float, float]]) -> float:
    return sum(polygon[i][0] * polygon[(i + 1) % len(polygon)][1]
               - polygon[(i + 1) % len(polygon)][0] * polygon[i][1]
               for i in range(len(polygon))) * 0.5 if len(polygon) >= 3 else 0.0


def _area(polygon: list[tuple[float, float]]) -> float:
    return abs(_signed_area(polygon))


def _intersection_area(subject: list[tuple[float, float]],
                       clipper: list[tuple[float, float]]) -> float:
    """Clip a triangle against another; edge-only contact yields zero area."""
    if _signed_area(clipper) < 0:
        clipper = list(reversed(clipper))
    output = subject
    for index, a in enumerate(clipper):
        b = clipper[(index + 1) % len(clipper)]
        incoming, output = output, []
        if not incoming:
            break
        start = incoming[-1]
        start_inside = _cross2(a, b, start) >= -1.0e-12
        for end in incoming:
            end_inside = _cross2(a, b, end) >= -1.0e-12
            if end_inside != start_inside:
                dx, dy = end[0] - start[0], end[1] - start[1]
                ex, ey = b[0] - a[0], b[1] - a[1]
                denominator = dx * ey - dy * ex
                if abs(denominator) > 1.0e-20:
                    t = ((a[0] - start[0]) * ey - (a[1] - start[1]) * ex) / denominator
                    output.append((start[0] + t * dx, start[1] + t * dy))
            if end_inside:
                output.append(end)
            start, start_inside = end, end_inside
    return _area(output)


def _plane(triangle: dict[str, Any]) -> tuple[Any, ...] | None:
    points = triangle["points"]
    u = tuple(points[1][i] - points[0][i] for i in range(3))
    v = tuple(points[2][i] - points[0][i] for i in range(3))
    normal = (u[1] * v[2] - u[2] * v[1],
              u[2] * v[0] - u[0] * v[2],
              u[0] * v[1] - u[1] * v[0])
    length = math.sqrt(sum(component * component for component in normal))
    if length < 1.0e-15:
        return None
    normal = tuple(component / length for component in normal)
    offset = sum(normal[i] * points[0][i] for i in range(3))
    if next((component for component in normal if abs(component) > 1.0e-9), 1.0) < 0:
        normal = tuple(-component for component in normal)
        offset = -offset
    axis = max(range(3), key=lambda index: abs(normal[index]))
    projected = [tuple(value for index, value in enumerate(point) if index != axis)
                 for point in points]
    minimum = tuple(min(point[index] for point in projected) for index in range(2))
    maximum = tuple(max(point[index] for point in projected) for index in range(2))
    return normal, offset, axis, projected, minimum, maximum


def analyze(path: str | Path) -> dict[str, Any]:
    """Analyze coplanar, positive-area triangle intersections in a character GLB."""
    triangles, joint_names = _mesh_triangles(Path(path))
    groups: dict[tuple[Any, ...], list[tuple[dict[str, Any], tuple[Any, ...]]]] = defaultdict(list)
    exact_geometry: Counter[tuple[tuple[float, float, float], ...]] = Counter()
    for triangle in triangles:
        exact_geometry[tuple(sorted(tuple(round(value, 7) for value in point)
                                    for point in triangle["points"]))] += 1
        plane = _plane(triangle)
        if plane is None:
            continue
        normal, offset, axis, *_ = plane
        key = (triangle["skin"], axis, tuple(round(value, 5) for value in normal), round(offset, 6))
        groups[key].append((triangle, plane))

    exact_duplicate_pairs = sum(count * (count - 1) // 2 for count in exact_geometry.values())
    overlap_pairs = significant_pairs = 0
    overlap_area = 0.0
    bone_pairs: Counter[str] = Counter()
    bone_areas: Counter[str] = Counter()
    for candidates in groups.values():
        for (first, p1), (second, p2) in itertools.combinations(candidates, 2):
            n1, d1, axis, polygon1, min1, max1 = p1
            n2, d2, axis2, polygon2, min2, max2 = p2
            if axis != axis2 or sum(n1[i] * n2[i] for i in range(3)) < 1.0 - 1.0e-8:
                continue
            if abs(d1 - d2) > 1.0e-6:
                continue
            # This box check only prunes; a clipped triangle intersection is required.
            if (max1[0] <= min2[0] + 1.0e-8 or max2[0] <= min1[0] + 1.0e-8
                    or max1[1] <= min2[1] + 1.0e-8 or max2[1] <= min1[1] + 1.0e-8):
                continue
            area = _intersection_area(polygon1, polygon2)
            if area <= AREA_TOLERANCE:
                continue
            overlap_pairs += 1
            overlap_area += area
            significant_pairs += area > SIGNIFICANT_AREA
            bones = {joint_names.get(joint, str(joint))
                     for vertex_signature in first["skin"] + second["skin"]
                     for joint, _ in vertex_signature}
            bone_pairs.update(bones)
            for bone in bones:
                bone_areas[bone] += area
    return {"triangles": len(triangles), "exactDuplicatePairs": exact_duplicate_pairs,
            "overlapPairs": overlap_pairs, "significantPairs": significant_pairs,
            "pairwiseProjectedArea": overlap_area,
            "bonePairwiseProjectedArea": dict(bone_areas),
            "topBones": bone_pairs.most_common(12)}


class RefinedSurfaceRegressionTests(unittest.TestCase):
    def test_refinement_does_not_introduce_coplanar_overlap(self) -> None:
        for asset in ("goblin", "orc", "troll", "archer-crew"):
            with self.subTest(asset=asset):
                with (REFINED / f"{asset}.json").open(encoding="utf-8") as handle:
                    report = json.load(handle)
                source_path = ROOT / report["sourcePath"]
                source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
                self.assertEqual(report["sourceSha256"], source_hash,
                                 f"{asset} source no longer matches the pinned refinement report")
                source = analyze(source_path)
                refined = analyze(REFINED / f"{asset}.glb")
                area_limit = source["pairwiseProjectedArea"] * 1.2 + 1.0e-6
                diagnostic = (f"source={source}; refined={refined}; "
                              f"allowed pairwise projected area <= {area_limit:.8g}")
                self.assertLessEqual(refined["pairwiseProjectedArea"], area_limit, diagnostic)
                self.assertLessEqual(refined["exactDuplicatePairs"],
                                     source["exactDuplicatePairs"], diagnostic)
                for bone in sorted(set(source["bonePairwiseProjectedArea"])
                                   | set(refined["bonePairwiseProjectedArea"])):
                    source_area = source["bonePairwiseProjectedArea"].get(bone, 0.0)
                    refined_area = refined["bonePairwiseProjectedArea"].get(bone, 0.0)
                    bone_limit = source_area * 1.2 + 1.0e-6
                    self.assertLessEqual(
                        refined_area, bone_limit,
                        f"{asset} introduces coplanar overlap on {bone}: "
                        f"source={source_area:.8g}, refined={refined_area:.8g}, "
                        f"allowed={bone_limit:.8g}; {diagnostic}",
                    )


if __name__ == "__main__":
    unittest.main()
