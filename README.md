# muscle-view：康复用 3D 肌肉查看器

面向运动康复师的浏览器端 3D 肌肉查看工具，覆盖**肩、髋、膝、腰**四个部位。用于给患者讲解、自己复习解剖、对照体表触诊。

> **重要**：所有起止点、功能、动作与主动肌/拮抗肌表均为参照教材（Kendall、Neumann）整理的稿件，**尚未经临床审核**，界面上也同样标注"待临床确认"。肌肉的收缩/舒张着色是示意级估算，不是肌电或生物力学仿真结果。

## 功能

| 需求 | 实现 |
|---|---|
| 拖拽旋转 | 左键旋转、滚轮缩放、右键平移；前/后/左/右预设视角与重置；触控可用 |
| 隐藏部分肌肉 | 肌肉树（部位 → 分组 → 肌肉）三态勾选、"仅显示选中 / 隐藏选中 / 全部显示"、浅/中/深三层开关、骨骼开关、左右侧筛选、中/英/拉丁文搜索 |
| 亚洲成年男性模板 | Z-Anatomy（基于 BodyParts3D 日本成年男性 MRI 重建）。肌肉 73 块（左右共 146 个网格），骨骼 25 组 |
| 肌肉名称 | 中文 / English / Latina 一键切换；悬停显示名称，点击出详情；可显示全部名称标签（自动避让、被遮挡的不显示） |
| 肌肉-骨骼附着 | 算法从网格接触面提取起点（红）/止点（蓝），在骨骼上着色；"附着模式"只保留骨骼与选中肌肉轮廓；"校对模式"逐块审核并导出 `review.json` |
| 皮肤对照 | 半透明皮肤（0–100% 滑块）；26 个体表骨性标志（肩峰、喙突、ASIS、PSIS、大转子、髌骨、胫骨粗隆、L4 棘突等），含触诊提示与附着肌肉 |
| 收缩/舒张演示 | 9 个动作（肩外展、肩前屈/后伸、肩内/外旋、髋屈/伸、髋外展/内收、膝屈/伸、腰前屈/后伸、腰侧屈、躯干旋转）；骨骼按关节转动，肌肉跟随变形；缩短=红、拉长=蓝、变化小=灰；列出主动肌/稳定肌/拮抗肌；播放/暂停 |
| 部位聚焦 | 肩/髋/膝/腰按钮：相机飞到该部位，只显示该部位的结构 |

## 运行

要求：Node.js ≥ 20、npm。生成的模型已包含在 `web/public/data/` 中，**只看不改的话不需要 Python**。

```bash
cd web
npm install
npm run dev          # 开发：http://localhost:5173
npm run build        # 静态站点输出到 web/dist/（可放到任意静态服务器，使用相对路径）
npm run preview      # 预览构建结果：http://localhost:4173
```

## 重建数据（从数据源到网页）

数据流水线需要 Python（环境名 `health`）和 Blender 4.2 LTS（仅用于读取 Z-Anatomy 的 `.blend`）。

```bash
conda activate health
pip install -e '.[dev]'            # trimesh numpy scipy scikit-learn pyyaml requests fast-simplification pygltflib rtree networkx scikit-image
pip install scikit-image           # 皮肤外壳的体素化用到

# Blender 4.2：解压到 ~/opt/blender-4.2*/ 或设置环境变量 BLENDER=/path/to/blender
# 下载: https://download.blender.org/release/Blender4.2/

python -m pipeline.build           # 一条命令：fetch → za_extract → validate → export → golden
python -m pipeline.build --check   # 只检查生成物是否比输入旧
```

分步运行：

| 步骤 | 命令 | 说明 |
|---|---|---|
| 1 | `python -m pipeline.fetch` | 下载 BodyParts3D 4.0（约 136 MB，服务器慢，分段并行并可续传）。**只用于 FMA 编号对照**，几何不用它 |
| 2 | `python -m pipeline.za_extract` | 下载 Z-Anatomy（约 87 MB），用无界面 Blender 导出网格到 `data_cache/za/` |
| 3 | `python -m pipeline.inventory` | 按部位列出候选结构，报告皮肤与 BodyParts3D 缺失的肌肉 |
| 4 | `python -m pipeline.validate` | 校验 `anatomy/*.yaml`（名称齐全、骨/肌肉引用、网格存在、动作与标志表） |
| 5 | `python -m pipeline.export [--rebuild]` | 减面 → 起止点提取 → 关节中心 → 蒙皮权重 → `model.glb` + `manifest.json`，并回读校验压缩是否改变形状 |
| 6 | `python -m pipeline.attachments` | 起止点提取质量报告（与 Z-Anatomy 手绘区对比的 P/R/F1，异常项排前） |
| 7 | `python -m pipeline.golden` | 生成 `web/src/lib/kinematics.golden.json`，使网页端运动学/长度计算与 Python 一致 |
| 8 | `python -m pipeline.apply_review review.json` | 把网页校对模式导出的 `review.json` 变成修正待办（`docs/REVIEW_TODO.md`） |

## 数据文件（`anatomy/`，唯一数据源，手工维护）

| 文件 | 内容 |
|---|---|
| `muscles.yaml` | 73 块肌肉：Z-Anatomy 网格名、部位、分组、深浅层、中/英/拉丁名、起点/止点/功能文字、起止点所在骨、绕行点 `via` |
| `bones.yaml` | 骨骼条目与刚体归属 |
| `skeleton.yaml` | 19 个刚体、关节中心算法、自由度与方向约定、腰椎角度分摊 |
| `motions.yaml` | 9 个动作的关键帧（含肩肱节律）与主动肌/稳定肌/拮抗肌 |
| `landmarks.yaml` | 26 个体表骨性标志的取点规则与触诊提示 |
| `attachment_overrides.yaml` | 起止点提取的人工修正（采用 Z-Anatomy 手绘区、补点状贴片等） |

## 测试

```bash
pytest                       # 数据校验、网格处理、起止点、关节/蒙皮、动作、标志（114 项）
cd web
npm test                     # vitest：纯逻辑（运动学、长度、显隐、搜索、i18n、校对…，93 项）
npm run e2e                  # Playwright：构建后在软件 WebGL 下走完整流程
```

端到端测试会先 `npm run build` 再启动预览服务器。若 4173 端口上已有手动启动的预览服务，请先关闭，否则测到的是旧构建（设置 `E2E_REUSE=1` 可强制复用）。

## 方法与已知局限

- **几何来源**：BodyParts3D 4.0/4.3 缺少背阔肌、多裂肌、腰方肌、腹直肌、腹内斜肌、腹横肌，Z-Anatomy 补全了它们，所以肌骨与皮肤统一取自 Z-Anatomy（两套数据的坐标不是刚体变换关系，不能混用）。详见 `docs/DATA_SOURCES.md`。
- **Z-Anatomy 的斜方肌升部/降部命名相反**，已在 `muscles.yaml` 中按几何位置纠正。
- **起止点**：算法取肌肉与骨骼表面距离 ≤ 2.5 mm 的骨面，闭运算后按连通域分块。在 57 块有 Z-Anatomy 手绘区的肌肉上，纯算法与手绘区的平均 F1 为 0.52；其中 F1 < 0.5 的 28 块直接采用手绘区（见 `attachment_overrides.yaml`），3 块肌腱缺失的止点用点状贴片补上。肌肉长段贴骨的情形（股四头肌、肱三头肌、腹壁肌）算法分不出起点范围，需靠校对模式人工确认。
- **运动**：示意级刚体运动学 + 线性混合蒙皮。肌肉形状不会随收缩鼓起；角度超过约 120°（肩上举）时肌肉与骨骼会有穿插。腰椎角度按固定比例分摊给 L5…L1 与胸廓，不是个体化测量。
- **收缩/舒张着色**：肌肉长度 = 起点附着中心 → （可选绕行点 `via`）→ 止点附着中心 的折线长度变化，缩短/拉长超过 2.5 % 才着色，±25 % 为满色。只有股四头肌（绕髌骨）、髂肌与腰大肌（绕股骨头前方）、臀大肌（绕大转子）设有绕行点。肱二头肌、腓肠肌等肌腱在网格中缺失，止点用点状贴片近似；屈髋时髂肌、屈膝时腓肠肌缩短量偏小；肩上举 120° 以上直线路径不再能描述肌肉走向，胸大肌锁骨部等会被判为拉长。着色只表示趋势，不是定量。
- **肌肉长度与显示是两套计算**：显示用蒙皮后的网格，长度只用上述路径，因此肌肉看起来穿插的地方，着色仍然有意义。
- **皮肤**：由 Z-Anatomy 体表分区体素化重建的单层水密外壳，随最近的骨骼蒙皮；关节处有线性混合蒙皮常见的收缩/挤压。

## 许可与署名

- BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan
- Z-Anatomy (https://www.z-anatomy.com)，CC BY-SA 4.0
- `web/public/data/` 下的模型文件是上述数据的衍生品，同样以 **CC BY-SA 4.0** 发布（相同方式共享）。界面页脚保留了署名。
- 本仓库代码的许可证由使用者按 CC BY-SA 的传染性要求自行评估：仅分发代码、不含模型数据时不受 SA 约束。
