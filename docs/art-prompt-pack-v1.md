# 静照院 · 美术素材提示词包 v1

> 风格段落与本项目所有提示词包**逐字一致**；改动必须同步到全部文档与 `game.js` 色板常量、`index.html` CSS 变量。
> 本版对应已实装的「清雅水墨国风 + 低饱和 3+1 色 + 放大面板 3D 同源渲染图」。

## 1. 改动说明（相对旧版）

| 项 | 旧版 | v1 |
|---|---|---|
| 风格 | 年节红金 + AI 水墨背景 + CSS 拟物面板 + 低模 3D，四套画风混用 | 清雅水墨国风，全部主体统一到同一套 3D 建模语言 |
| 色板 | 7+ 色相（朱红、亮金、灰蓝、松绿、米灰…） | 3+1：宣纸米 / 墨青 / 低饱和朱砂 + 少量旧金 |
| 放大面板 | CSS 渐变另画一只猫 / 一只金蟾 | 复用 `buildCat()` / `buildToad()` / `buildIncenseBurner()`，离屏渲染成透明 PNG |
| 光 | 半球光 1.3 + 主光 1.9 + 曝光 1.32，平光过曝 | 半球 0.85 + 主光 1.45 + 佛前点光 1.9 + 曝光 1.12，有主次 |

## 2. 风险前置页

1. **汉字必乱码**：匾额、法号、印章、功德数字一律不交给模型画，用 PIL + 系统楷体后期合成（现有 `plaqueTexture()` / `wishTagTexture()` 已是此做法）。
2. **多主体串味**：一张图超过 6 个主体会数错、特征互串 → 主视觉只放 4 个锚点主体，其余拆图或由 3D 场景承担。
3. **风格漂移**：衍生图必须 `image-to-image` + `input_fidelity=high`，不许独立文生图；每 3 张抽检 1 张。

## 3. 变量槽位表（批量时只改这一列）

| 代号 | 主体 | 唯一识别线索（色 + 剪影） | 状态数 | 备注 |
|---|---|---|---|---|
| MNK | 小沙弥 | 灰蓝 A 形袍 + 光头大耳 | 站 / 合十 / 跪拜 | 已有 `monk.glb`，不重出 |
| CAT | 布偶猫 | 奶油底 + 深棕尖耳 | 坐 / 被撸 | 已有 `buildCat()` |
| TOD | 三足金蟾 | 旧金 + 口衔铜钱 | 蹲 / 中币 | 已有 `toad.glb` |
| BUD | 坐佛 | 旧金 + 螺发肉髻 | 静坐 | 已有 `buddha.glb` |
| CUS | 蒲团 | 青灰扁圆 + 布面包边 | 空 / 有人 | 程序化，4 档色差 |
| PIN | 松 | 墨绿棱面块叶 + 歪干 | 常态 | 程序化 |
| FIS | 木鱼 | 蜜木扁球 + 弧形开口 | 静 / 敲击 | 程序化 + 离屏渲染 |
| BED | 念珠 | 蜜木珠 + 绳 | 静 / 拨动 | 程序化 |
| INS | 香炉 | 青铜鼓腹 + 双耳三足 | 空 / 插香 | 复用 `buildIncenseBurner()` |
| LMP | 长明灯 | 青铜灯盏 + 一点暖焰 | 未点 / 已点 | 程序化 |
| PND | 荷池 | 青灰水 + 圆石台 | 静 / 涟漪 | 程序化 |
| LEAF | 银杏落叶堆 | 旧金扇叶 + 矮堆 | 堆 / 扫散 | 程序化 |

> 结论：**当前 12 个主体全部已有 3D 同源实现**，本包用于未来扩批（季节皮、节庆皮、表情包、宣发图），不是要推翻现有模型。

## 4. 风格锚点（逐字复用 · 一个字都不改）

**中文**
> 清雅水墨国风 3D 游戏美术，宣纸米与墨青为主，低饱和朱砂作点缀，旧金只作极少勾边；形体取自唐宋木构与民间泥塑，圆润低模、棱面块叶、细墨线勾边；柔光斜阳，一处暖光作视觉焦点；画面留白充分，远山以淡墨晕染，无艳色、无渐变炫光、无金属高反光。

**English**
> Elegant Chinese ink-wash inspired 3D game art, rice-paper beige and ink-teal as the base, desaturated cinnabar as accent, aged gold only for minimal edge lining; forms drawn from Tang-Song timber architecture and folk clay sculpture, rounded low-poly, faceted foliage, thin ink outlines; soft raking sunlight with one warm focal light; generous negative space, distant mountains in pale ink wash; no saturated colors, no gradient glow, no mirror-metal highlights.

## 5. 色板（单图用色 ≤ 4）

| 命名色 | HEX | 用途 |
|---|---|---|
| 宣纸米 `paper` | `#ECE5D5` | 纸面、地面、猫底色、UI 底 |
| 墨青 `ink` | `#2E3532` | 屋瓦、描边、文字、暗部 |
| 雾青 `mist` | `#C2C6B8` | 雾、远山、地面过渡 |
| 低饱和朱砂 `cinnabar` | `#96574C` | 柱、印章、法号牌（唯一暖重色） |
| 旧金 `gold` | `#B49A68` | 佛身、瓦当、包边（≤ 5% 画面） |
| 青灰 `jade` | `#788B80` | 蒲团、水面、松叶 |
| 蜜木 `wood` | `#A98257` | 木鱼、念珠、香筒 |

规则：`paper + ink + cinnabar` 为 3 主色，`gold` 为唯一点缀色；`mist / jade / wood` 属同色系派生，不另计色相。

## 6. 提示词模板（一段姿态一版，只替换【】）

**主视觉 / 场景**
```
【风格锚点全文】。画面为【季节/时辰】的静照院：从左到右依次是【一棵歪干松】、【敞口木构佛殿】、【一池青灰荷水】，殿前【成排青灰蒲团】，中轴留过道；视线平视略俯，光源来自【右上方】，殿内一点暖光；远处淡墨远山，留白充分。单幅横构图，主体互不重叠，基线齐平，不画任何文字。
```

**单主体 / 素材图（需抠图）**
```
【风格锚点全文】。单个【主体代号】，【姿态】，统一朝右，位于画面正中，纯色【#ECE5D5】背景，主体完整不出血、不重叠、基线齐平；不画影子、不画投影、不画环境光遮蔽；不画文字、不画水印。
```

**交互态变体（image-to-image, input_fidelity=high）**
```
以输入图为唯一形态依据，保持【主体代号】的【逐条特征：配色 hex / 剪影 / 纹饰 / 比例 / 墨线】完全不变，只把姿态改为【交互态】；仍是同一纯色背景、同一光源方向、同一镜头焦段。不新增配件、不改配色、不画文字。
```

## 7. 负面提示词

**中文**
> 影子，投影，落地阴影，环境光遮蔽，水印，文字，汉字，字母，logo，渐变炫光，霓虹，高饱和红金，大红灯笼串，金属镜面反光，塑料质感，写实照片，透视畸变，多余肢体，多条尾巴，凤凰，五彩羽色，华丽长尾翎，孔雀翎，金翅，火焰纹，发光特效。

**English**
> shadow, cast shadow, contact shadow, ambient occlusion, watermark, text, Chinese characters, letters, logo, gradient glow, neon, saturated red and gold, lantern strings, mirror-metal reflection, plastic look, photorealistic, perspective distortion, extra limbs, multiple tails, phoenix, iridescent plumage, ornate tail feathers, peacock feather, gilded wings, flame pattern, glowing VFX.

## 8. 批量执行清单

1. 只跑 **1 个主体 · 1 个状态**（推荐 `MNK` 坐姿）→ 验风格
2. 出该主体其余状态 → 验「像同一个」
3. 出双版本（透明底 / 纯色底）→ 验抠图边缘
4. **锁定参数**：种子、模型版本、步数、完整提示词全文存档到 `docs/concept/lock.json`
5. 才按槽位表批量替换；每 3 张抽检 1 张
6. 精修去杂点/水印 → 命名归档 → 回填 `docs/concept/manifest.csv`

## 9. 命名与归档规则

```
concept/hero-v1.png                  主视觉锚点（唯一，作废不删，改加 ⚠️ 声明）
sprites/<CODE>-<state>-v<N>.png     例：FIS-idle-v1.png
old/<date>-<CODE>-v<N>-deprecated   被推翻的旧稿，文件头写废弃原因
```
代号表见第 3 节，**一套到底**；改命名习惯必须同步更新全部提示词包与 manifest。

## 10. 验收自检清单

- [ ] 风格锚点与主视觉逐字一致（中英都核对）
- [ ] 单图用色 ≤ 4，金色占比 ≤ 5%
- [ ] 三视图：正/侧/背剪影、比例、配色、纹饰一致
- [ ] 无汉字 / 无水印 / 无落地阴影
- [ ] 抠图四角透明占比达标、边缘无脏边
- [ ] 与 `game.js` 现有 3D 模型摆在一起不串味
- [ ] 动态效果（光晕、呼吸、登场）全部留给代码，没画进图
- [ ] 代码侧已回填新色值，旧风格关键词全项目搜索无残留

## 11. 三级降级方案

| 级别 | 做法 | 适用 |
|---|---|---|
| L1 | 按槽位表全量出图（12 主体 × 2 状态 ≈ 24 张），逐张精修 | 有充足额度、要换整套皮肤 |
| L2 | 只出 1 张主视觉锁风格，其余靠代码换色 / 镜像 / 现有 GLB | **本轮推荐起点** |
| L3 | 完全不出图，用 `renderPropSprite()` 把现有 3D 模型离屏渲染成透明 PNG | **本轮已实装**，零额度消耗 |

## 12. 可直接粘贴的完整提示词（主视觉起手样稿）

```
Elegant Chinese ink-wash inspired 3D game art, rice-paper beige and ink-teal as the base, desaturated cinnabar as accent, aged gold only for minimal edge lining; forms drawn from Tang-Song timber architecture and folk clay sculpture, rounded low-poly, faceted foliage, thin ink outlines; soft raking sunlight with one warm focal light; generous negative space, distant mountains in pale ink wash; no saturated colors, no gradient glow, no mirror-metal highlights.

A serene Chinese temple courtyard at dawn: from left to right, one leaning pine with faceted ink-green foliage, an open-front timber hall with desaturated cinnabar columns and dark ink roof tiles, a round grey-green lotus pond on the central axis; rows of grey-blue round cushions in front of the hall with a clear central aisle; slightly elevated eye level, light from upper right, one warm glow inside the hall, pale ink mountains fading into mist, generous negative space. Single horizontal composition, subjects on the same sight plane, correct relative scale, unified light direction, no overlapping. No text, no letters, no watermark, no shadows, no glowing VFX.
```

---

**主视觉定稿**：`concept/hero-v1.png`（1536×932，已裁去平台生成水印；原始带水印稿归档在 `concept/old/`，仅作留痕，不作为风格锚点使用）。

**生成量估算**：完整扩批 `12 主体 × 2 状态 × 2 版本 = 48 张`；左向可代码 `scaleX=-1` 省一半，换色可省 3 张 → 实需约 **20 张**。
**成本提示**：图像生成按张单独计费（约 5–10 积分/张），批量前须先确认额度；本轮只出 1 张主视觉。
**推荐降级起点**：L2（1 张主视觉）→ 验证后决定是否进 L1；现有线上版本走 L3，不依赖任何生成图。
