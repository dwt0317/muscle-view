# 数据来源与决策记录

## 结论（Task 1）

| 项目 | 结论 |
|---|---|
| 几何主数据源 | **Z-Anatomy**（`Startup.blend`，CC BY-SA 4.0）。它由 BodyParts3D 日本成年男性模型整理而来，人体模板与 BodyParts3D 相同 |
| BodyParts3D 4.0 | 已下载（2234 个 OBJ，sha256 `40665852…409e`）。用于 FMA ID 映射、对照与皮肤备选 |
| 皮肤 | BodyParts3D 4.0 有 skin（FMA7163 → FJ2810，20 万面，非水密，100 个连通块）。Z-Anatomy 有 "Regions of human body" 体表分区网格，坐标与肌骨一致。**选用 Z-Anatomy 体表分区合并为皮肤** |

## 为什么改用 Z-Anatomy 作为几何主源

BodyParts3D 4.0（以及 olivercase 镜像的 4.3 全分辨率版）**缺少以下重点肌肉**：
背阔肌、多裂肌、腰方肌、腹直肌、腹内斜肌、腹横肌。前两项对肩和腰是核心肌肉。
Z-Anatomy 补建了这些肌肉，同时保留了其余 BodyParts3D 结构。

两者的坐标并不是一个刚体平移关系：以质心比较，各结构偏移量在 Y 方向为 85–120 mm，在 Z 方向为 30–100 mm，个别肌肉被重建过（倒角距离超过 20 mm）。所以把两个来源的网格混用会出现错位，最后决定**肌骨和皮肤都统一取自 Z-Anatomy**。

Z-Anatomy 还额外提供了：
- 拉丁/英文 TA 名称（对象名），以及维基百科来源的英文释义（Blender text）
- 手工绘制的起止点贴片（`.or/.er` 等对象，位于 "2: Muscular insertions" 集合）。Task 8 用它来**校验**算法提取结果

## 获取流程

```
conda activate health
python -m pipeline.fetch        # BodyParts3D 4.0 OBJ + parts list（服务器慢，分段并行 + 断点续传）
python -m pipeline.za_extract   # 下载 Z-Anatomy.zip，用 headless Blender 导出 PLY + index.json
python -m pipeline.inventory    # 按部位列出候选结构，报告皮肤和缺失肌肉
```

需要 Blender 4.2 LTS（已测 4.2.23），程序会自动查找 `~/opt/blender-4.2*/blender`，也可以用 `BLENDER=` 指定路径。

## 坐标

Z-Anatomy 坐标：米，Z 轴朝上，前方为 -Y，患者右侧为 -X。导出 glTF 时转换为 Y 轴朝上、前方为 +Z：`(x, y, z) -> (x, z, -y)`。

## 许可

- BodyParts3D, (c) The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan
- Z-Anatomy (https://www.z-anatomy.com) — CC BY-SA 4.0
- 衍生模型文件（`web/public/data/*.glb`）以 CC BY-SA 4.0 发布

## 处理步骤与精度（Task 3–10 记录）

| 步骤 | 做法 | 精度 / 限制 |
|---|---|---|
| 减面 | `fast_simplification` 二次误差减面：肌肉保留 30 %（250–5000 面），骨骼 50 %（200–12000 面），背景骨（颅骨、手、足、颈椎）12 % | 总面数约 43.5 万；肌肉全部位于皮肤之内（顶点超出皮肤 >3 mm 的肌肉为 0） |
| 皮肤 | Z-Anatomy 体表分区拼成体素场（4 mm），外部洪水填充，高斯平滑 + Taubin，减面到 7 万面 | 体积 76.6 L，水密；手指、外生殖器细节被平滑 |
| 起止点 | 肌肉表面 ≤ 2.5 mm 的骨面 → 图上闭运算 → 连通域；见 `attachment_overrides.yaml` | 与手绘区平均 F1 0.52（57 块肌肉）；28 块采用手绘区 |
| 关节中心 | 髋/盂肱：RANSAC 球拟合；膝：股骨内外上髁连线中点；腰椎：椎间盘重心；锁骨：端点 | 髋中心距髋臼盂唇重心 3.5 mm，盂肱中心距关节囊重心 10 mm |
| 蒙皮 | 肌肉：起止点锚点沿肌肉轴向的平滑插值（跨越的股骨/腰椎节段自动加入）；皮肤：最近骨软权重 | 示意级线性混合蒙皮 |
| 压缩 | `gltf-transform meshopt`（含位置量化）；导出后用 three.js 重新加载并比较世界坐标 | 最大偏差 0.035 mm |
| 网页运动学 | 与 `pipeline/skeleton.py` 同一套数学；`kinematics.golden.json` 校验 6 个姿势 × 19 个刚体的四元数、渲染器中的质心、4 个姿势 × 146 块肌肉的长度比 | 偏差 < 2 mm / 2e-4 |
