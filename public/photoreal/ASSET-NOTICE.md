# Photoreal asset notice

The assets listed below originate from [Poly Haven](https://polyhaven.com/) and
are available under the [Creative Commons CC0
license](https://polyhaven.com/license). Attribution is not required by CC0;
the source links are retained here for provenance.

| Local asset | Resolution / format | Size (bytes) | Official source |
| --- | --- | ---: | --- |
| `shrub_04/` | 1K glTF package | 1,907,514 | [Shrub 04](https://polyhaven.com/a/shrub_04) · [file API](https://api.polyhaven.com/files/shrub_04) |
| `fern_02/` | 1K glTF package | 1,146,361 | [Fern 02](https://polyhaven.com/a/fern_02) · [file API](https://api.polyhaven.com/files/fern_02) |
| `rock_moss_set_01/` | 1K glTF package | 1,937,065 | [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) · [file API](https://api.polyhaven.com/files/rock_moss_set_01) |
| `nature_reserve_forest_1k.hdr` | 1K Radiance HDR | 1,900,770 | [Nature Reserve Forest](https://polyhaven.com/a/nature_reserve_forest) · [file API](https://api.polyhaven.com/files/nature_reserve_forest) |
| `island_tree_01.glb` | Optimized 1K GLB derivative | 9,845,856 | [Island Tree 01](https://polyhaven.com/a/island_tree_01) · [file API](https://api.polyhaven.com/files/island_tree_01) |
| `island_tree_01_leaves_alpha_1k.png` | 1K PNG alpha map | 57,438 | [Island Tree 01](https://polyhaven.com/a/island_tree_01) · [official file](https://dl.polyhaven.org/file/ph-assets/Models/png/1k/island_tree_01/island_tree_01_leaves_alpha_1k.png) |
| `textures/mossy_rock/` | 1K JPG texture set | 2,901,083 | [Mossy Rock](https://polyhaven.com/a/mossy_rock) · [file API](https://api.polyhaven.com/files/mossy_rock) |
| `textures/brown_mud_leaves_01/` | 1K JPG texture set | 3,337,357 | [Brown Mud Leaves 01](https://polyhaven.com/a/brown_mud_leaves_01) · [file API](https://api.polyhaven.com/files/brown_mud_leaves_01) |

The combined size of the assets covered by this notice is **23,033,444 bytes**.

## Package inventory

```text
    176176  fern_02/fern_02.bin
      6899  fern_02/fern_02_1k.gltf
    280359  fern_02/textures/fern_02_arm_1k.jpg
    315705  fern_02/textures/fern_02_diff_1k.jpg
    367222  fern_02/textures/fern_02_nor_gl_1k.jpg
   9845856  island_tree_01.glb
     57438  island_tree_01_leaves_alpha_1k.png
   1900770  nature_reserve_forest_1k.hdr
   1466380  rock_moss_set_01/rock_moss_set_01.bin
      9987  rock_moss_set_01/rock_moss_set_01_1k.gltf
    168099  rock_moss_set_01/textures/rock_moss_set_01_diff_1k.jpg
    209975  rock_moss_set_01/textures/rock_moss_set_01_nor_gl_1k.jpg
     82624  rock_moss_set_01/textures/rock_moss_set_01_rough_1k.jpg
    749084  shrub_04/shrub_04.bin
      2882  shrub_04/shrub_04_1k.gltf
    332957  shrub_04/textures/shrub_04_arm_1k.jpg
    373350  shrub_04/textures/shrub_04_diff_1k.jpg
    449241  shrub_04/textures/shrub_04_nor_gl_1k.jpg
   1206953  textures/brown_mud_leaves_01/brown_mud_leaves_01_diff_1k.jpg
   1486072  textures/brown_mud_leaves_01/brown_mud_leaves_01_nor_gl_1k.jpg
    644332  textures/brown_mud_leaves_01/brown_mud_leaves_01_rough_1k.jpg
   1124438  textures/mossy_rock/mossy_rock_diff_1k.jpg
    995727  textures/mossy_rock/mossy_rock_nor_gl_1k.jpg
    780918  textures/mossy_rock/mossy_rock_rough_1k.jpg
```

All unmodified Poly Haven downloads were verified against the MD5 checksums
published by the official file API.

## Island Tree 01 derivative

The official 1K tree package contains 60,709,812 bytes of geometry before
textures. For web delivery, it was converted with glTF-Transform 4.4.1 using:

- meshoptimizer high-level compression and quantization;
- mesh simplification targeting 20% of the original vertices, constrained to a
  maximum error of 0.004;
- deduplication, welding, pruning, flattening, and mesh joining;
- the original nine 1K JPEG material textures embedded without recompression.

The optimized result retains 319,068 triangles, 381,869 uploaded vertices,
three original materials, and the original model bounds. It requires
`EXT_meshopt_compression` support. Its SHA-256 checksum is:

```text
f76dc9581ebdfabc1fc6549489163c3da140ecd547d232753fbf732d8307ba1a
```

The separate official leaf alpha map is applied at runtime because the 1K
source glTF declares blended leaves while its JPEG base-color texture cannot
carry an alpha channel. Its verified MD5 checksum is:

```text
5ad9fb9a06e70c069bd3d3ba23577375
```
