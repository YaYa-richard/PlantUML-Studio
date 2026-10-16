# 连线文字框 / Edge label boxes

![连线文字框与自动换行](edge-labels.png)

每条连线的文字都可以独立移动、调整框大小，默认透明填充且无可见边框，选中时显示蓝色虚线框。

1. **拖动文字**：直接按住文字或文字框区域拖动（透明时也可拖动），调整位置。
2. **调整宽高**：选中连线或文字后，拖动文字框右下角的绿色方块。
3. **精确输入**：右侧「连线文字框」可以输入框左上角的画布 X/Y，以及宽度、高度。
4. **自动换行**：缩小宽度时，按浏览器实际字体宽度换行；英文优先在空格处断行，单词太长时允许拆分，中文可逐字换行。
5. **手动换行**：双击文字修改内容，输入的换行与空行都会保留。
6. **高度不足**：自动撑高，保证文字完整显示。宽度扩大后，如需缩短先前的较高文字框，可减小高度，程序会保留容纳文字的最小高度。
7. **恢复默认**：点击「恢复自动文字框」，清除位置偏移和自定义尺寸。

右侧「文字框填充」可选透明或颜色填充，并设置填充颜色及 0–100% 不透明度。默认 0% 为透明；100% 为完全不透明，修改只影响背景，不会让文字变淡。填充设置独立保存，移动、调整尺寸或恢复自动文字框不会清除填充。

位置以文字框中心相对连线中点附近的偏移保存，调整连线路径后会继续保留该偏移。移动文字不会改变连线端点和折点，调整某个标签不会影响其他标签。

宽度范围 32–2400，手动高度范围 28–10000（均为画布单位）。字体大小当前固定为 11，调整文字框宽高不会缩放字体。

移动、调整尺寸和内容编辑均支持撤销/重做。保存 `.pumlstudio` 后会恢复位置、尺寸和原始文字，换行根据当前设备字体重新计算。重新从 PlantUML 生成会重置手工修改。

SVG / PNG 使用与编辑画布相同的文字测量和换行结果，导出边界包含移到远处的文字框。原生 draw.io 中每个标签导出为连线的独立子文字框，保留宽高、相对位置与当前分行，仍可编辑；不同设备字体可能产生细微差异。

---

Drag an edge label to reposition it. Select it and drag its bottom-right handle to resize, or enter exact top-left X/Y and width/height in the inspector. Narrower boxes wrap text automatically; height grows to keep all lines visible. English wraps at spaces where possible; long words and Chinese text can break within a word. Explicit newlines remain intact.

Each label stores an offset from its route anchor and independent dimensions. Moving a label does not change the edge path or other labels. History and project files retain label geometry; SVG/PNG share the editor's line breaking. Native draw.io exports editable child label cells with size, offset and explicit line breaks. Font size currently stays fixed at 11.

Label backgrounds are transparent by default and remain draggable. Choose transparent or color fill in the inspector; background opacity ranges from 0–100% without fading the text. Appearance is saved separately from geometry and preserved in SVG/PNG/native draw.io exports.
