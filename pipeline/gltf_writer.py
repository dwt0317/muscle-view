"""Minimal glTF 2.0 (.glb) writer on top of pygltflib.

Supports: PBR materials, triangle meshes (POSITION/NORMAL/indices, optional
JOINTS_0/WEIGHTS_0), node hierarchy with TRS + extras, and skins.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from pygltflib import (
    ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, FLOAT, GLTF2, UNSIGNED_INT, UNSIGNED_SHORT,
    Accessor, Asset, Attributes, Buffer, BufferView, Material, Mesh, Node, PbrMetallicRoughness,
    Primitive, Scene, Skin,
)

from pipeline.meshops import MeshData


class GltfBuilder:
    def __init__(self, generator: str = "muscle_view pipeline") -> None:
        self.g = GLTF2(asset=Asset(version="2.0", generator=generator), scene=0, scenes=[Scene(nodes=[])])
        self.blob = bytearray()

    # ---- buffers
    def _view(self, data: bytes, target: int | None) -> int:
        while len(self.blob) % 4:
            self.blob.append(0)
        off = len(self.blob)
        self.blob += data
        self.g.bufferViews.append(BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(self.g.bufferViews) - 1

    def _accessor(self, arr: np.ndarray, comp: int, kind: str, target: int | None, bounds: bool = False) -> int:
        view = self._view(np.ascontiguousarray(arr).tobytes(), target)
        acc = Accessor(bufferView=view, componentType=comp, count=len(arr), type=kind)
        if bounds:
            acc.min = arr.min(axis=0).astype(float).tolist()
            acc.max = arr.max(axis=0).astype(float).tolist()
        self.g.accessors.append(acc)
        return len(self.g.accessors) - 1

    # ---- scene graph
    def material(self, name: str, rgba: tuple[float, float, float, float], roughness: float = 0.7,
                 metallic: float = 0.0, blend: bool = False, double_sided: bool = False) -> int:
        self.g.materials.append(
            Material(name=name, pbrMetallicRoughness=PbrMetallicRoughness(
                baseColorFactor=list(rgba), metallicFactor=metallic, roughnessFactor=roughness),
                alphaMode="BLEND" if blend else "OPAQUE", doubleSided=double_sided))
        return len(self.g.materials) - 1

    def node(self, name: str, parent: int | None = None, translation=None, rotation=None,
             extras: dict | None = None) -> int:
        n = Node(name=name, extras=extras or None)
        if translation is not None:
            n.translation = [float(x) for x in translation]
        if rotation is not None:
            n.rotation = [float(x) for x in rotation]
        self.g.nodes.append(n)
        idx = len(self.g.nodes) - 1
        if parent is None:
            self.g.scenes[0].nodes.append(idx)
        else:
            self.g.nodes[parent].children.append(idx)
        return idx

    def mesh_node(self, name: str, data: MeshData, material: int, parent: int | None = None,
                  translation=None, extras: dict | None = None, skin: int | None = None) -> int:
        attrs = Attributes(
            POSITION=self._accessor(data.positions.astype(np.float32), FLOAT, "VEC3", ARRAY_BUFFER, bounds=True),
            NORMAL=self._accessor(data.normals.astype(np.float32), FLOAT, "VEC3", ARRAY_BUFFER),
        )
        if data.joints is not None:
            attrs.JOINTS_0 = self._accessor(data.joints.astype(np.uint16), UNSIGNED_SHORT, "VEC4", ARRAY_BUFFER)
            attrs.WEIGHTS_0 = self._accessor(data.weights.astype(np.float32), FLOAT, "VEC4", ARRAY_BUFFER)
        idx = self._accessor(data.indices.astype(np.uint32).reshape(-1), UNSIGNED_INT, "SCALAR", ELEMENT_ARRAY_BUFFER)
        self.g.meshes.append(Mesh(name=name, primitives=[Primitive(attributes=attrs, indices=idx, material=material)]))
        n = self.node(name, parent, translation, extras=extras)
        self.g.nodes[n].mesh = len(self.g.meshes) - 1
        if skin is not None:
            self.g.nodes[n].skin = skin
        return n

    def skin(self, joints: list[int], inverse_bind: np.ndarray, name: str = "skeleton") -> int:
        # glTF matrices are column-major: transpose row-major numpy matrices.
        ibm = np.ascontiguousarray(np.transpose(inverse_bind.astype(np.float32), (0, 2, 1)))
        acc = self._accessor(ibm.reshape(-1, 16), FLOAT, "MAT4", None)
        self.g.skins.append(Skin(name=name, joints=joints, inverseBindMatrices=acc))
        return len(self.g.skins) - 1

    # ---- output
    def save(self, path: Path | str) -> None:
        path = Path(path)
        self.g.buffers = [Buffer(byteLength=len(self.blob))]
        self.g.set_binary_blob(bytes(self.blob))
        path.parent.mkdir(parents=True, exist_ok=True)
        self.g.save_binary(str(path))
