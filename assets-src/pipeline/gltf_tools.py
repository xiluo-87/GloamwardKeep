#!/usr/bin/env python3
"""Small dependency-free GLB optimizer for the authored character pipeline.

The tool only removes provably redundant animation channels and repacks referenced binary
views. It never decimates, merges, or rewrites mesh, material, skin, or bind-pose data.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

MAGIC = 0x46546C67
VERSION = 2
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
COMPONENT_FORMATS = {
    5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
    5125: ("I", 4), 5126: ("f", 4),
}
UNSIGNED_INDEX_TYPES = {5121, 5123, 5125}
EPSILON = 1e-6


class GLTFError(ValueError):
    """Malformed or unsupported glTF input that must not be silently rewritten."""


def _reject_constant(value: str) -> None:
    raise GLTFError(f"non-finite JSON number {value}")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise GLTFError(f"duplicate JSON member {key!r}")
        result[key] = value
    return result


def _finite_tree(value: Any, where: str = "JSON") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise GLTFError(f"{where} contains a non-finite number")
    if isinstance(value, dict):
        for key, child in value.items():
            _finite_tree(child, f"{where}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _finite_tree(child, f"{where}[{index}]")


def parse_glb(data: bytes) -> tuple[dict[str, Any], bytes, list[tuple[int, bytes]]]:
    if len(data) < 12:
        raise GLTFError("GLB header is truncated")
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != MAGIC or version != VERSION or declared_length != len(data):
        raise GLTFError("invalid GLB magic, version, or declared length")
    chunks: list[tuple[int, bytes]] = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            raise GLTFError("truncated GLB chunk header")
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        if length % 4 or offset + length > len(data):
            raise GLTFError("invalid GLB chunk length")
        chunks.append((kind, data[offset:offset + length]))
        offset += length
    json_chunks = [chunk for kind, chunk in chunks if kind == JSON_CHUNK]
    bin_chunks = [chunk for kind, chunk in chunks if kind == BIN_CHUNK]
    if len(json_chunks) != 1 or len(bin_chunks) > 1 or not chunks or chunks[0][0] != JSON_CHUNK:
        raise GLTFError("GLB must contain one leading JSON chunk and at most one BIN chunk")
    try:
        document = json.loads(json_chunks[0].decode("utf-8").rstrip(" \t\r\n\0"),
                              parse_constant=_reject_constant, object_pairs_hook=_unique_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GLTFError(f"invalid GLB JSON: {error}") from error
    if not isinstance(document, dict) or document.get("asset", {}).get("version") != "2.0":
        raise GLTFError("only glTF 2.0 documents are supported")
    _finite_tree(document)
    binary = bin_chunks[0] if bin_chunks else b""
    extras = [(kind, chunk) for kind, chunk in chunks if kind not in (JSON_CHUNK, BIN_CHUNK)]
    return document, binary, extras


def _array(document: dict[str, Any], name: str) -> list[Any]:
    value = document.get(name, [])
    if not isinstance(value, list):
        raise GLTFError(f"{name} must be an array")
    return value


def _index(value: Any, length: int, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value >= length:
        raise GLTFError(f"invalid {label} reference {value!r}")
    return value


def validate_container(document: dict[str, Any], binary: bytes) -> int:
    buffers = _array(document, "buffers")
    views = _array(document, "bufferViews")
    accessors = _array(document, "accessors")
    if buffers:
        if len(buffers) != 1 or "uri" in buffers[0]:
            raise GLTFError("only one embedded GLB buffer is supported")
        declared = buffers[0].get("byteLength")
        if not isinstance(declared, int) or declared < 0 or declared > len(binary) or len(binary) - declared > 3:
            raise GLTFError("GLB buffer byteLength does not match its BIN chunk")
    else:
        declared = 0
        if views or accessors or binary:
            raise GLTFError("buffer views require the embedded GLB buffer")
    for view_index, view in enumerate(views):
        if not isinstance(view, dict):
            raise GLTFError(f"bufferViews[{view_index}] must be an object")
        if view.get("buffer", 0) != 0:
            raise GLTFError(f"bufferViews[{view_index}] references a non-embedded buffer")
        offset = view.get("byteOffset", 0)
        length = view.get("byteLength")
        if not isinstance(offset, int) or offset < 0 or not isinstance(length, int) or length < 0 or offset + length > declared:
            raise GLTFError(f"bufferViews[{view_index}] exceeds the GLB buffer")
        stride = view.get("byteStride")
        if stride is not None and (not isinstance(stride, int) or stride < 4 or stride > 252):
            raise GLTFError(f"bufferViews[{view_index}] has an invalid byteStride")
    for accessor_index, accessor in enumerate(accessors):
        if not isinstance(accessor, dict):
            raise GLTFError(f"accessors[{accessor_index}] must be an object")
        _accessor_shape(accessor, accessor_index)
        if "bufferView" in accessor:
            _index(accessor["bufferView"], len(views), f"accessors[{accessor_index}].bufferView")
        if "bufferView" not in accessor and "sparse" not in accessor:
            # glTF defines a zero-initialized accessor in this case; leave it legal.
            pass
        sparse = accessor.get("sparse")
        if sparse is not None:
            if not isinstance(sparse, dict):
                raise GLTFError(f"accessors[{accessor_index}].sparse must be an object")
            count = sparse.get("count")
            if not isinstance(count, int) or count < 0 or count > accessor["count"]:
                raise GLTFError(f"accessors[{accessor_index}] has invalid sparse count")
            indices = sparse.get("indices", {})
            values = sparse.get("values", {})
            for sparse_part in (indices, values):
                _index(sparse_part.get("bufferView"), len(views), f"accessors[{accessor_index}].sparse.bufferView")
                byte_offset = sparse_part.get("byteOffset", 0)
                if not isinstance(byte_offset, int) or byte_offset < 0:
                    raise GLTFError(f"accessors[{accessor_index}] has invalid sparse byteOffset")
            if indices.get("componentType") not in UNSIGNED_INDEX_TYPES:
                raise GLTFError(f"accessors[{accessor_index}] sparse indices must be unsigned integers")
    return declared


def _accessor_shape(accessor: dict[str, Any], index: int) -> tuple[int, int, str, int]:
    component_type = accessor.get("componentType")
    component = COMPONENT_FORMATS.get(component_type)
    type_name = accessor.get("type")
    components = COMPONENTS.get(type_name)
    count = accessor.get("count")
    if component is None or components is None or not isinstance(count, int) or count < 0:
        raise GLTFError(f"accessors[{index}] has invalid type, componentType, or count")
    byte_offset = accessor.get("byteOffset", 0)
    if not isinstance(byte_offset, int) or byte_offset < 0:
        raise GLTFError(f"accessors[{index}] has invalid byteOffset")
    return component_type, components, component[0], component[1]


def _read_from_view(document: dict[str, Any], binary: bytes, view_index: int, byte_offset: int,
                    fmt: str, count: int, stride: int, components: int) -> list[tuple[float, ...]]:
    views = _array(document, "bufferViews")
    view = views[_index(view_index, len(views), "bufferView")]
    base = view.get("byteOffset", 0) + byte_offset
    view_end = view.get("byteOffset", 0) + view["byteLength"]
    packed_size = struct.calcsize("<" + fmt * components)
    if stride < packed_size or (count and base + (count - 1) * stride + packed_size > view_end):
        raise GLTFError("accessor data exceeds its bufferView or byteStride")
    result: list[tuple[float, ...]] = []
    for item in range(count):
        result.append(struct.unpack_from("<" + fmt * components, binary, base + item * stride))
    return result


def read_accessor(document: dict[str, Any], binary: bytes, index: int, *, normalized: bool = True) -> list[tuple[float, ...]]:
    accessors = _array(document, "accessors")
    accessor = accessors[_index(index, len(accessors), "accessor")]
    component_type, components, fmt, component_size = _accessor_shape(accessor, index)
    count = accessor["count"]
    views = _array(document, "bufferViews")
    view_index = accessor.get("bufferView")
    stride = views[view_index].get("byteStride", components * component_size) if view_index is not None else components * component_size
    if view_index is None:
        values: list[tuple[float, ...]] = [tuple(0.0 for _ in range(components)) for _ in range(count)]
    else:
        values = _read_from_view(document, binary, view_index, accessor.get("byteOffset", 0), fmt, count, stride, components)
    is_normalized = bool(accessor.get("normalized", False)) and normalized
    sparse = accessor.get("sparse")
    if sparse:
        indices_def = sparse["indices"]
        indices_type = indices_def["componentType"]
        index_fmt, index_size = COMPONENT_FORMATS[indices_type]
        indices_view = indices_def["bufferView"]
        indices = _read_from_view(document, binary, indices_view, indices_def.get("byteOffset", 0), index_fmt,
                                  sparse["count"], index_size, 1)
        sparse_values = _read_from_view(document, binary, sparse["values"]["bufferView"],
                                        sparse["values"].get("byteOffset", 0), fmt, sparse["count"],
                                        components * component_size, components)
        for raw_index, row in zip(indices, sparse_values):
            target_index = int(raw_index[0])
            if target_index < 0 or target_index >= count:
                raise GLTFError(f"accessors[{index}] sparse index is out of range")
            values[target_index] = row
    if is_normalized and component_type != 5126:
        if component_type in (5120, 5122):
            maximum = (1 << (component_size * 8 - 1)) - 1
            values = [tuple(max(-1.0, v / maximum) for v in row) for row in values]
        else:
            maximum = (1 << (component_size * 8)) - 1
            values = [tuple(v / maximum for v in row) for row in values]
    if any(not math.isfinite(float(component)) for row in values for component in row):
        raise GLTFError(f"accessors[{index}] contains a non-finite value")
    return values


def _accessor_ref(document: dict[str, Any], index: Any, label: str) -> dict[str, Any]:
    accessors = _array(document, "accessors")
    return accessors[_index(index, len(accessors), label)]


def _same_value(a: Iterable[float], b: Iterable[float], tolerance: float = EPSILON) -> bool:
    aa, bb = tuple(a), tuple(b)
    return len(aa) == len(bb) and all(abs(x - y) <= tolerance for x, y in zip(aa, bb))


def _same_quaternion(a: Iterable[float], b: Iterable[float]) -> bool:
    aa, bb = tuple(a), tuple(b)
    if len(aa) != 4 or len(bb) != 4:
        return False
    return _same_value(aa, bb) or _same_value(aa, (-bb[0], -bb[1], -bb[2], -bb[3]))


def _default_transform(node: dict[str, Any], path: str) -> tuple[float, ...] | None:
    if path == "translation":
        value = node.get(path, [0, 0, 0])
    elif path == "rotation":
        value = node.get(path, [0, 0, 0, 1])
    elif path == "scale":
        value = node.get(path, [1, 1, 1])
    else:
        return None
    if not isinstance(value, list) or len(value) != (4 if path == "rotation" else 3):
        raise GLTFError(f"node has an invalid default {path} transform")
    return tuple(float(component) for component in value)


def _is_redundant_channel(document: dict[str, Any], binary: bytes, channel: dict[str, Any], sampler: dict[str, Any]) -> bool:
    target = channel.get("target")
    if not isinstance(target, dict):
        raise GLTFError("animation channel target must be an object")
    path = target.get("path")
    default = _default_transform(_nodes(document, target.get("node")), path)
    if default is None:
        return False
    interpolation = sampler.get("interpolation", "LINEAR")
    if interpolation == "CUBICSPLINE":
        return False
    input_accessor = _accessor_ref(document, sampler.get("input"), "animation sampler input")
    output_index = sampler.get("output")
    output_accessor = _accessor_ref(document, output_index, "animation sampler output")
    if input_accessor.get("componentType") != 5126 or input_accessor.get("type") != "SCALAR":
        raise GLTFError("animation input accessors must be float SCALAR")
    if output_accessor.get("componentType") != 5126 or output_accessor.get("normalized", False):
        raise GLTFError("animation output accessors must be non-normalized floats")
    if output_accessor.get("type") != ("VEC4" if path == "rotation" else "VEC3"):
        raise GLTFError(f"animation {path} output accessor has the wrong vector type")
    times = read_accessor(document, binary, sampler["input"])
    values = read_accessor(document, binary, output_index)
    if interpolation not in ("LINEAR", "STEP"):
        raise GLTFError(f"unsupported animation interpolation {interpolation!r}")
    if not times or len(values) != len(times):
        raise GLTFError("animation input/output accessor counts do not match")
    if path == "rotation":
        return all(_same_quaternion(row, default) for row in values)
    return all(_same_value(row, default) for row in values)


def _nodes(document: dict[str, Any], node_index: Any) -> dict[str, Any]:
    nodes = _array(document, "nodes")
    node = nodes[_index(node_index, len(nodes), "animation target node")]
    if not isinstance(node, dict):
        raise GLTFError("animation target node must be an object")
    return node


def _duration(document: dict[str, Any], binary: bytes, animation: dict[str, Any]) -> float:
    max_time = 0.0
    for sampler in animation.get("samplers", []):
        index = sampler.get("input")
        times = read_accessor(document, binary, index)
        if times:
            max_time = max(max_time, max(row[0] for row in times))
    return max_time


def _slerp(a: tuple[float, ...], b: tuple[float, ...], t: float) -> tuple[float, ...]:
    if len(a) != 4 or len(b) != 4:
        raise GLTFError("rotation output must contain VEC4 quaternions")
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = tuple(-v for v in b)
        dot = -dot
    dot = min(1.0, max(-1.0, dot))
    if dot > 0.9995:
        result = tuple(x + t * (y - x) for x, y in zip(a, b))
    else:
        theta = math.acos(dot)
        sin_theta = math.sin(theta)
        wa = math.sin((1 - t) * theta) / sin_theta
        wb = math.sin(t * theta) / sin_theta
        result = tuple(wa * x + wb * y for x, y in zip(a, b))
    length = math.sqrt(sum(v * v for v in result))
    if length <= 1e-12:
        raise GLTFError("cannot interpolate a zero-length quaternion")
    return tuple(v / length for v in result)


def _sample_terminal(times: list[tuple[float, ...]], values: list[tuple[float, ...]], duration: float,
                     interpolation: str, rotation: bool, group_size: int) -> list[tuple[float, ...]]:
    if not times or len(values) != len(times) * group_size:
        raise GLTFError("animation output count is inconsistent with its input keys")
    time_values = [row[0] for row in times]
    if any(not math.isfinite(value) for value in time_values) or any(a > b for a, b in zip(time_values, time_values[1:])):
        raise GLTFError("animation input times must be finite and nondecreasing")
    if duration <= time_values[0]:
        return values[:group_size]
    right = 0
    while right < len(time_values) and time_values[right] < duration:
        right += 1
    if right < len(time_values) and abs(time_values[right] - duration) <= EPSILON:
        return values[right * group_size:(right + 1) * group_size]
    if right == 0:
        return values[:group_size]
    left = right - 1
    if interpolation == "STEP" or right >= len(time_values):
        return values[left * group_size:(left + 1) * group_size]
    span = time_values[right] - time_values[left]
    if span <= 0:
        return values[left * group_size:(left + 1) * group_size]
    t = (duration - time_values[left]) / span
    result: list[tuple[float, ...]] = []
    for group in range(group_size):
        a = values[left * group_size + group]
        b = values[right * group_size + group]
        if rotation:
            result.append(_slerp(a, b, t))
        else:
            result.append(tuple(x + t * (y - x) for x, y in zip(a, b)))
    return result


def _aligned_append(binary: bytearray, data: bytes) -> tuple[int, int]:
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    binary.extend(data)
    return offset, len(data)


def _write_float_accessor(document: dict[str, Any], binary: bytearray, type_name: str,
                          values: list[tuple[float, ...]]) -> int:
    components = COMPONENTS[type_name]
    if any(len(row) != components for row in values):
        raise GLTFError("new animation accessor rows have inconsistent component count")
    flat = [float(value) for row in values for value in row]
    if any(not math.isfinite(value) for value in flat):
        raise GLTFError("cannot write a non-finite animation value")
    data = struct.pack("<" + "f" * len(flat), *flat) if flat else b""
    offset, length = _aligned_append(binary, data)
    buffer_views = _array(document, "bufferViews")
    view_index = len(buffer_views)
    buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": length})
    accessor = {
        "bufferView": view_index, "componentType": 5126, "count": len(values), "type": type_name,
    }
    if values:
        accessor["min"] = [min(row[c] for row in values) for c in range(components)]
        accessor["max"] = [max(row[c] for row in values) for c in range(components)]
    accessors = _array(document, "accessors")
    index = len(accessors)
    accessors.append(accessor)
    return index


def _trim_sampler(document: dict[str, Any], binary: bytearray, sampler: dict[str, Any], duration: float,
                  target_path: str) -> bool:
    interpolation = sampler.get("interpolation", "LINEAR")
    if interpolation == "CUBICSPLINE":
        return False
    if interpolation not in ("LINEAR", "STEP"):
        raise GLTFError(f"unsupported animation interpolation {interpolation!r}")
    input_index = sampler.get("input")
    output_index = sampler.get("output")
    input_accessor = _accessor_ref(document, input_index, "animation sampler input")
    output_accessor = _accessor_ref(document, output_index, "animation sampler output")
    if input_accessor.get("componentType") != 5126 or input_accessor.get("type") != "SCALAR":
        raise GLTFError("animation input accessors must be float SCALAR")
    if output_accessor.get("componentType") != 5126 or output_accessor.get("normalized", False):
        raise GLTFError("animation output accessors must be non-normalized floats")
    times = read_accessor(document, bytes(binary), input_index)
    values = read_accessor(document, bytes(binary), output_index)
    if not times:
        raise GLTFError("cannot trim an animation sampler with no keys")
    time_values = [row[0] for row in times]
    if any(a > b for a, b in zip(time_values, time_values[1:])):
        raise GLTFError("animation input times must be nondecreasing")
    if abs(time_values[-1] - duration) <= EPSILON:
        return False
    out_type = output_accessor.get("type")
    if target_path == "rotation" and out_type != "VEC4":
        raise GLTFError("rotation animation output must be VEC4")
    if target_path in ("translation", "scale") and out_type != "VEC3":
        raise GLTFError(f"{target_path} animation output must be VEC3")
    if target_path == "weights" and out_type != "SCALAR":
        raise GLTFError("weights animation output must be SCALAR")
    group_size = len(values) // len(times)
    if group_size < 1 or len(values) != len(times) * group_size:
        raise GLTFError("animation input/output count mismatch")
    if target_path != "weights" and group_size != 1:
        raise GLTFError("transform animation output count must match input count")
    if target_path == "weights" and group_size * COMPONENTS[out_type] * 1 != group_size:
        raise GLTFError("weights animation output accessor is malformed")

    keep_count = sum(1 for value in time_values if value < duration - EPSILON)
    if duration < time_values[0] - EPSILON:
        kept_times = [(duration,)]
        terminal = values[:group_size]
    else:
        kept_times = times[:keep_count]
        exact = keep_count < len(time_values) and abs(time_values[keep_count] - duration) <= EPSILON
        if exact:
            terminal = values[keep_count * group_size:(keep_count + 1) * group_size]
            kept_times = times[:keep_count + 1]
        else:
            terminal = _sample_terminal(times, values, duration, interpolation, target_path == "rotation", group_size)
            kept_times = kept_times + [(duration,)]
    kept_values = values[:len(kept_times) * group_size - group_size] + terminal
    if not kept_times or kept_times[-1][0] != duration:
        raise GLTFError("internal error: trimmed animation did not end at reference duration")
    sampler["input"] = _write_float_accessor(document, binary, "SCALAR", kept_times)
    sampler["output"] = _write_float_accessor(document, binary, out_type, kept_values)
    return True


def _animation_channels(document: dict[str, Any], binary: bytes) -> tuple[int, int, int]:
    removed = 0
    trimmed = 0
    cubic = 0
    animations = _array(document, "animations")
    for animation_index, animation in enumerate(animations):
        samplers = animation.get("samplers", [])
        channels = animation.get("channels", [])
        if not isinstance(samplers, list) or not isinstance(channels, list):
            raise GLTFError(f"animations[{animation_index}] samplers/channels must be arrays")
        kept: list[dict[str, Any]] = []
        candidates: list[dict[str, Any]] = []
        for channel in channels:
            sampler_index = _index(channel.get("sampler"), len(samplers), "animation channel sampler")
            if _is_redundant_channel(document, binary, channel, samplers[sampler_index]):
                candidates.append(channel)
            else:
                kept.append(channel)
        # The glTF schema requires a channel. Keep a single no-op track if removing all of
        # them would erase a named clip or leave an invalid animation object.
        if candidates and not kept:
            kept.append(candidates.pop(0))
        removed += len(candidates)
        animation["channels"] = kept

        used_samplers = sorted({channel["sampler"] for channel in kept})
        sampler_remap = {old: new for new, old in enumerate(used_samplers)}
        animation["samplers"] = [samplers[old] for old in used_samplers]
        for channel in kept:
            channel["sampler"] = sampler_remap[channel["sampler"]]
        for sampler in animation["samplers"]:
            interpolation = sampler.get("interpolation", "LINEAR")
            if interpolation == "CUBICSPLINE":
                cubic += 1
            if interpolation not in ("LINEAR", "STEP", "CUBICSPLINE"):
                raise GLTFError(f"unsupported animation interpolation {interpolation!r}")
    return removed, trimmed, cubic


def _reference_durations(document: dict[str, Any], binary: bytes) -> dict[str, float]:
    durations: dict[str, float] = {}
    for index, animation in enumerate(_array(document, "animations")):
        name = animation.get("name")
        if not isinstance(name, str) or not name:
            continue
        if name in durations:
            raise GLTFError(f"duplicate reference animation name {name!r}")
        durations[name] = _duration(document, binary, animation)
    return durations


def _apply_reference_durations(document: dict[str, Any], binary: bytearray,
                               reference_durations: dict[str, float]) -> tuple[int, int]:
    trimmed = cubic = 0
    for animation in _array(document, "animations"):
        name = animation.get("name")
        if not isinstance(name, str) or name not in reference_durations:
            continue
        duration = reference_durations[name]
        if not math.isfinite(duration) or duration < 0:
            raise GLTFError(f"reference animation {name!r} has invalid duration")
        samplers = animation.get("samplers", [])
        used_paths: dict[int, str] = {}
        for channel in animation.get("channels", []):
            sampler = _index(channel.get("sampler"), len(samplers), "animation channel sampler")
            path = channel.get("target", {}).get("path")
            previous = used_paths.get(sampler)
            if previous is not None and previous != path:
                raise GLTFError("one animation sampler cannot target different paths")
            used_paths[sampler] = path
        for sampler_index, path in used_paths.items():
            sampler = samplers[sampler_index]
            if sampler.get("interpolation", "LINEAR") == "CUBICSPLINE":
                cubic += 1
                continue
            if _trim_sampler(document, binary, sampler, duration, path):
                trimmed += 1
    return trimmed, cubic


def _accessor_references(document: dict[str, Any]) -> set[int]:
    refs: set[int] = set()
    for mesh in _array(document, "meshes"):
        for primitive in mesh.get("primitives", []):
            if "indices" in primitive:
                refs.add(primitive["indices"])
            for value in primitive.get("attributes", {}).values():
                refs.add(value)
            for target in primitive.get("targets", []):
                refs.update(target.values())
    for skin in _array(document, "skins"):
        if "inverseBindMatrices" in skin:
            refs.add(skin["inverseBindMatrices"])
    for animation in _array(document, "animations"):
        for sampler in animation.get("samplers", []):
            refs.add(sampler["input"]); refs.add(sampler["output"])
    # Include accessors exposed through extension properties with an explicit accessor suffix.
    def visit(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                if child_key.lower().endswith("accessor") and isinstance(child, int) and not isinstance(child, bool):
                    refs.add(child)
                else:
                    visit(child, child_key)
        elif isinstance(value, list):
            for child in value:
                visit(child, key)
    for key, value in document.items():
        if key not in ("accessors", "meshes", "skins", "animations"):
            visit(value, key)
    accessors = _array(document, "accessors")
    for ref in refs:
        _index(ref, len(accessors), "accessor")
    return refs


def _remap_accessors(document: dict[str, Any], remap: dict[int, int]) -> None:
    def replace(container: dict[str, Any], key: str) -> None:
        value = container.get(key)
        if value is not None:
            if value not in remap:
                raise GLTFError(f"cannot remove referenced accessor {value}")
            container[key] = remap[value]
    for mesh in _array(document, "meshes"):
        for primitive in mesh.get("primitives", []):
            if "indices" in primitive:
                replace(primitive, "indices")
            for attributes in [primitive.get("attributes", {}), *primitive.get("targets", [])]:
                for key, value in list(attributes.items()):
                    if value not in remap:
                        raise GLTFError(f"cannot remove referenced accessor {value}")
                    attributes[key] = remap[value]
    for skin in _array(document, "skins"):
        if "inverseBindMatrices" in skin:
            replace(skin, "inverseBindMatrices")
    for animation in _array(document, "animations"):
        for sampler in animation.get("samplers", []):
            replace(sampler, "input"); replace(sampler, "output")
    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in list(value.items()):
                if key.lower().endswith("accessor") and isinstance(child, int) and not isinstance(child, bool):
                    if child not in remap:
                        raise GLTFError(f"cannot remove extension-referenced accessor {child}")
                    value[key] = remap[child]
                else:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    for key, value in document.items():
        if key not in ("accessors", "meshes", "skins", "animations"):
            visit(value)


def _buffer_view_references(document: dict[str, Any]) -> set[int]:
    refs: set[int] = set()
    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "bufferView":
                    refs.add(child)
                else:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(document)
    views = _array(document, "bufferViews")
    for ref in refs:
        _index(ref, len(views), "bufferView")
    return refs


def _remap_buffer_views(document: dict[str, Any], remap: dict[int, int]) -> None:
    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in list(value.items()):
                if key == "bufferView":
                    if child not in remap:
                        raise GLTFError(f"cannot remove referenced bufferView {child}")
                    value[key] = remap[child]
                else:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(document)


def _validate_skin_weights(document: dict[str, Any], binary: bytes) -> None:
    for mesh_index, mesh in enumerate(_array(document, "meshes")):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            attributes = primitive.get("attributes", {})
            for suffix in ("", "_0", "_1", "_2", "_3"):
                joint_key, weight_key = "JOINTS" + suffix, "WEIGHTS" + suffix
                if joint_key not in attributes and weight_key not in attributes:
                    continue
                if joint_key not in attributes or weight_key not in attributes:
                    raise GLTFError(f"mesh {mesh_index} primitive {primitive_index} has unmatched joint/weight attributes")
                joints = _accessor_ref(document, attributes[joint_key], joint_key)
                weights = _accessor_ref(document, attributes[weight_key], weight_key)
                if joints.get("type") != "VEC4" or weights.get("type") != "VEC4" or joints["count"] != weights["count"]:
                    raise GLTFError(f"mesh {mesh_index} primitive {primitive_index} has malformed skin attributes")
                joint_type = joints["componentType"]
                weight_type = weights["componentType"]
                if joint_type not in (5121, 5123) or joints.get("normalized", False):
                    raise GLTFError(f"{joint_key} must use non-normalized unsigned byte/short indices")
                if weight_type == 5126:
                    if weights.get("normalized", False):
                        raise GLTFError(f"float {weight_key} must not be marked normalized")
                elif weight_type in (5121, 5123):
                    if not weights.get("normalized", False):
                        raise GLTFError(f"integer {weight_key} must be normalized")
                else:
                    raise GLTFError(f"{weight_key} must use float or normalized unsigned byte/short values")
                joint_values = read_accessor(document, binary, attributes[joint_key], normalized=False)
                weight_values = read_accessor(document, binary, attributes[weight_key])
                if len(joint_values) != len(weight_values):
                    raise GLTFError(f"mesh {mesh_index} primitive {primitive_index} skin accessor counts differ")
                for vertex, (joint_row, weight_row) in enumerate(zip(joint_values, weight_values)):
                    if any(value < 0 or int(value) != value for value in joint_row):
                        raise GLTFError(f"{joint_key} vertex {vertex} has an invalid joint index")
                    if any(value < -EPSILON for value in weight_row):
                        raise GLTFError(f"{weight_key} vertex {vertex} has a negative weight")
                    total = sum(weight_row)
                    if not 0.98 <= total <= 1.02:
                        raise GLTFError(f"{weight_key} vertex {vertex} weights sum to {total:g}, expected 1")


def _compact_accessors(document: dict[str, Any]) -> int:
    accessors = _array(document, "accessors")
    used = sorted(_accessor_references(document))
    remap = {old: new for new, old in enumerate(used)}
    _remap_accessors(document, remap)
    document["accessors"] = [accessors[old] for old in used]
    return len(accessors) - len(used)


def _repack_views(document: dict[str, Any], binary: bytes) -> tuple[bytes, int]:
    views = _array(document, "bufferViews")
    used = sorted(_buffer_view_references(document))
    remap = {old: new for new, old in enumerate(used)}
    _remap_buffer_views(document, remap)
    packed = bytearray()
    new_views: list[dict[str, Any]] = []
    for old in used:
        view = dict(views[old])
        offset = view.get("byteOffset", 0)
        length = view["byteLength"]
        while len(packed) % 4:
            packed.append(0)
        view["byteOffset"] = len(packed)
        view["buffer"] = 0
        packed.extend(binary[offset:offset + length])
        new_views.append(view)
    document["bufferViews"] = new_views
    unused = len(views) - len(used)
    if "buffers" in document:
        if document["buffers"]:
            document["buffers"][0]["byteLength"] = len(packed)
        else:
            raise GLTFError("document has bufferViews but no buffers")
    return bytes(packed), unused


def _metrics(document: dict[str, Any], binary: bytes) -> dict[str, Any]:
    animations = _array(document, "animations")
    return {
        "clips": len(animations),
        "clip_names": [animation.get("name") for animation in animations],
        "clip_durations": {animation.get("name", f"#{i}"): _duration(document, binary, animation)
                           for i, animation in enumerate(animations)},
        "channels": sum(len(animation.get("channels", [])) for animation in animations),
        "animation_samplers": sum(len(animation.get("samplers", [])) for animation in animations),
        "accessors": len(_array(document, "accessors")),
        "buffer_views": len(_array(document, "bufferViews")),
        "binary_bytes": len(binary),
    }


def serialize_glb(document: dict[str, Any], binary: bytes, extras: list[tuple[int, bytes]] | None = None) -> bytes:
    if "buffers" in document and document["buffers"]:
        document["buffers"][0]["byteLength"] = len(binary)
    json_data = json.dumps(document, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    json_data += b" " * ((-len(json_data)) % 4)
    bin_data = binary + b"\0" * ((-len(binary)) % 4)
    chunks = [(JSON_CHUNK, json_data)]
    if binary or document.get("buffers"):
        chunks.append((BIN_CHUNK, bin_data))
    chunks.extend(extras or [])
    payload = bytearray()
    for kind, chunk in chunks:
        payload.extend(struct.pack("<II", len(chunk), kind)); payload.extend(chunk)
    return struct.pack("<III", MAGIC, VERSION, 12 + len(payload)) + payload


def optimize_glb_bytes(data: bytes, reference_data: bytes | None = None) -> tuple[bytes, dict[str, Any]]:
    document, binary, extras = parse_glb(data)
    declared = validate_container(document, binary)
    binary = binary[:declared]
    _validate_skin_weights(document, binary)
    before = _metrics(document, binary)

    reference_durations: dict[str, float] = {}
    if reference_data is not None:
        reference, reference_binary, _ = parse_glb(reference_data)
        reference_declared = validate_container(reference, reference_binary)
        reference_binary = reference_binary[:reference_declared]
        reference_durations = _reference_durations(reference, reference_binary)

    removed_channels, _, cubic_untouched = _animation_channels(document, binary)
    working_binary = bytearray(binary)
    trimmed_samplers, preserved_cubic = _apply_reference_durations(document, working_binary, reference_durations)
    working_binary = bytearray(working_binary)
    pruned_accessors = _compact_accessors(document)
    packed_binary, pruned_views = _repack_views(document, bytes(working_binary))
    final_document, final_binary, _ = parse_glb(serialize_glb(document, packed_binary, extras))
    validate_container(final_document, final_binary)
    _validate_skin_weights(final_document, final_binary[:final_document.get("buffers", [{}])[0].get("byteLength", 0)])
    after = _metrics(final_document, final_binary[:final_document.get("buffers", [{}])[0].get("byteLength", 0)])

    if reference_durations:
        for name, duration in reference_durations.items():
            if name not in after["clip_durations"]:
                raise GLTFError(f"optimized GLB lost reference animation {name!r}")
            actual = after["clip_durations"][name]
            # Cubic spline clips are intentionally preserved without resampling.
            cubic_names = {animation.get("name", f"#{i}")
                           for i, animation in enumerate(final_document.get("animations", []))
                           if any(sampler.get("interpolation", "LINEAR") == "CUBICSPLINE"
                                  for sampler in animation.get("samplers", []))}
            if name not in cubic_names and abs(actual - duration) > EPSILON:
                raise GLTFError(f"optimized animation {name!r} does not match its reference duration")
    report = {
        "before": before,
        "after": after,
        "removed_constant_channels": removed_channels,
        "trimmed_samplers": trimmed_samplers,
        "preserved_cubic_samplers": preserved_cubic + cubic_untouched,
        "removed_accessors": pruned_accessors,
        "removed_buffer_views": pruned_views,
        "reference_durations": reference_durations,
    }
    result = serialize_glb(final_document, packed_binary, extras)
    # The final serializer mutates only the buffer length. Round-trip validates chunk lengths and references.
    checked, checked_binary, _ = parse_glb(result)
    checked_len = validate_container(checked, checked_binary)
    _validate_skin_weights(checked, checked_binary[:checked_len])
    report["after"]["glb_bytes"] = len(result)
    report["before"]["glb_bytes"] = len(data)
    return result, report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb", type=Path, help="GLB to optimize in place")
    parser.add_argument("--reference", type=Path, help="original GLB used to preserve clip names and durations")
    parser.add_argument("--output", type=Path, help="write to another path instead of replacing the input")
    args = parser.parse_args(argv)
    source = args.glb.read_bytes()
    reference = args.reference.read_bytes() if args.reference else None
    result, metrics = optimize_glb_bytes(source, reference)
    destination = args.output or args.glb
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=destination.name + ".", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(result)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, destination)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise
    print(json.dumps({"path": str(destination), **metrics}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GLTFError as error:
        print(f"gltf_tools: {error}", file=sys.stderr)
        raise SystemExit(2)
