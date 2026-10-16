# 精细控制连线 / Fine-grained edge editing

选中连线后，画布显示端点、折点和添加按钮。支持单独控制每条线。

![精细连线编辑](edge-editing.png)

## 起点与终点

- **绿色方块**：分别表示起点和终点。拖到所属节点边框上的目标位置即可。
- 端点不会改连到其他节点；它调整的是现有关联节点上的连接位置。
- 右侧「起点连接位置」「终点连接位置」允许输入 **X%、Y%**。以节点左上角为 `(0,0)`、右下角为 `(100,100)`，坐标会投影到边框。例如矩形的 `(100,30)` 表示右边缘、从顶部向下 30% 的位置。
- 对圆形、菱形会投影到对应轮廓。角色、数据库和圆角矩形按节点包围框连接，暂未精确贴合装饰轮廓。
- 端点保存为相对节点的比例，移动或缩放节点时保持该相对位置。
- 「恢复自动起点 / 终点」单独解除该端的固定位置。

## 中间转折点

- **白色圆点**：每个圆点对应一个转折点，可以独立拖动。
- **线段上的 ＋**：点击在该段中间插入折点，也可以按住 ＋ 直接拖到目标位置。
- **右侧「＋ 添加折点」**：在当前最长线段中插入折点。
- **双击圆点**，或点击右侧坐标行末的 **×**，删除对应折点。
- 右侧列表按路径顺序列出折点，支持输入画布绝对 X/Y 坐标。让相邻点共用 X 或 Y，可以精确构造水平、垂直线段。
- 「自动路径」清除手动折点，重新生成中间路径；固定端点仍保留。

端点第一次调整时，会保留当前中间路径作为可编辑折点。中间折点使用画布绝对坐标，移动节点后不跟随节点整体平移。手动路径是逐点连接的折线，当前不自动保持每个线段水平或垂直。

## 连线文字框

每条线的文字都可独立拖动、调整宽高，缩窄后自动换行。选中连线后可拖动文字框右下角，或在右侧输入坐标与尺寸。详见[文字框操作说明](edge-labels.md)。

## 自动吸附与对齐

默认开启工具栏「吸附」。拖动折点时，在屏幕上距相邻折点或连接端的水平/垂直方向不超过 8 像素就会自动对齐，并显示紫色虚线参考线。拖动节点则会对齐其他节点的左右/上下边缘及中心。

- 按住 **Alt** 临时自由拖动，松开后恢复吸附。
- 点击工具栏「吸附」可持续开关。
- 缩放画布后，触发距离仍为屏幕上的 8 像素。
- 自动连接端会以节点中心轴作为对齐目标，固定连接端以实际连接点为目标。
- 参考线只在拖动时显示，松手后消失，不保存、不导出。
- 右侧输入坐标不触发吸附，保留精确输入值。

这帮助你拖出水平/垂直线段，但不会强制锁住整条路径；需要时仍可画斜线。

![折点吸附参考线](snapping.png)

## 保存、撤销与导出

端点调整、折点添加、拖动、坐标编辑和删除都支持撤销/重做。撤销时选中元素仍存在就保持选中，方便连续微调。

`.pumlstudio` 项目保存节点相对端点与有序折点，并兼容旧版单折点项目。SVG/PNG 使用当前路径；原生 `.drawio` 导出包含 `exitX/exitY`、`entryX/entryY` 和中间 `mxPoint` 坐标。draw.io 中可以继续编辑。

重新从 PlantUML 生成图形会重置手动修改。自动布局会重置中间折点，保留已固定的节点相对连接位置。

---

Select an edge. Drag the green endpoint squares along the attached nodes' boundaries; drag white circles to edit individual waypoints. Click or drag a segment's **+** handle to insert a point. Double-click a waypoint or use its inspector **×** button to delete it.

The inspector accepts node-relative endpoint percentages and absolute waypoint X/Y coordinates. Rectangular `(100,30)` means the right edge, 30% from the top. Ellipse/diamond anchors project onto their shape; decorative shapes currently use their bounding box. Endpoint anchors follow node moves/resizes; intermediate waypoints stay in canvas coordinates. Manual paths are polylines, without automatic orthogonal locking.

Projects, undo/redo and SVG/PNG/native draw.io exports preserve these edits. The automatic-path button resets middle points but keeps fixed anchors; the per-end reset buttons restore automatic attachment. Regenerating from source resets all manual edits.

Snapping is enabled by default: waypoints align with adjacent horizontal/vertical axes, and nodes align to other node edges/centers within 8 screen pixels at any zoom. Purple guides appear during dragging only. Hold **Alt** to bypass temporarily, or toggle **吸附** in the toolbar. Numeric inputs remain exact. This assists alignment without enforcing an orthogonal route.
