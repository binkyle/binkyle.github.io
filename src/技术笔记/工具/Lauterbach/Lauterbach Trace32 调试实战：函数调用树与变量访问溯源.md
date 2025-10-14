---
title: Lauterbach TRACE32 调试实战：函数调用树与变量访问溯源
icon: network
date: 2025-10-15
order: 1
isOriginal: true
article: true
timeline: true
category:
 - 调试
 - 嵌入式
 - AUTOSAR
tag:
 - Lauterbach
 - TRACE32
 - ETM/ETB
 - Data Trace
 - 变量访问
 - 函数调用树
---

> 一文搞定两件事：**用 TRACE32 生成 C 语言函数调用树**，以及**找出“某个全局变量被哪些函数读/写”**。

## 0. 背景与目标

在车规项目（AUTOSAR Classic / S32G 多核）中，日常调试常见两类诉求：

1. **函数调用树（Call Tree）**：快速定位 CPU 时间去哪了、哪层调用最重、是否出现递归/意外路径。
2. **变量访问溯源（Who touched my var）**：明确“谁读/谁写了某个全局变量”，辅助竞态与越权定位。

---

## 1. 准备工作

* **连接与符号**：

  * 连接目标板，确认 JTAG/NEXUS/CSI/ETM 通道可用。
  * `Data.Load.Elf <your.elf>` 载入带符号的映像；确保源码路径已配好以便双击跳转。
* **编译建议**：

  * Release 亦可，但建议在关键模块保留 `-g` 调试符号与合理的 `-O` 优化，避免过度内联导致调用关系难读。
* **时间基准**：

  * 若分析性能，建议启用 **时间戳/周期计数**；必要时锁频/关闭 DVFS，保证可重复性。

::: tip 关于“你的芯片是否支持数据 Trace？”
并非所有目标都支持“**数据访问**”的 Trace。A-profile 常见 **PTM（程序流）** 仅有指令流；M-profile + ETM/DWT、TriCore + MCDS/Nexus 等才可能拿到数据访问。若**没有数据 Trace**，请直接看 **方案 B：监视点**。
:::

---

## 2. 生成函数调用树（基于 ETM/片上 Trace）

> 目标：得到 **函数级别的详细调用树** 与 **函数运行时统计**。

### 2.1 GUI 快速路径

1. **开启 ETM**：`Trace → ETM Settings` 中启用 ETM，`ON`。
2. **选择 Trace 方式**：`Trace.Method = Onchip`（片上缓冲/ETB/Nexus 等）。
3. **自动录制**：勾选 `AutoArm`（自动 armed）与 `AutoInit`（断点后自动初始化 buffer）。
4. **运行到断点/场景结束**：程序在断点处停下。
5. **查看调用树**：`Perf → Function Runtime → Show Detailed Tree`。

> 这条路径能直接得到按函数归并的**调用树 + 运行时**视图，适合快速定位热函数与异常调用路径。

### 2.2 常用命令（可脚本化）

```t32
; 典型最小集（实际命令名大小写不敏感，不同版本略有差异）
Trace.METHOD ONCHIP        ; 选择片上 Trace
Trace.AUTOARM ON           ; 自动 armed
Trace.AUTOINIT ON          ; 自动初始化缓冲
Trace.RESet                ; 清空缓冲
Trace.ON                   ; 开始采集
; ... 运行至断点/场景结束 ...
Trace.OFF                  ; 停止
Perf.FunctionRuntime.Show  ; 打开函数运行时/调用树视图（或通过 GUI 菜单）
```

### 2.3 阅读与导出

* 在 **Function Runtime** 视图中：

  * 展开树查看父子关系、累计/自身耗时、调用次数等；
  * 右键可导出为文本/CSV 以做进一步分析。
* 若出现 **FLOWERROR**/**OVERFLOW**，说明带宽不足或缓冲不够：

  * 缩小关注区间（添加触发器/ARM 条件）；
  * 只打开必要的 Trace 源；
  * 提高传输带宽或使用更大外置缓冲。

---

## 3. 变量访问溯源（谁在读/写我的全局变量？）

> 目标：列出**所有读/写该变量的指令**，并映射回**函数**。

### 3.1 方案 A（首选）：**数据 Trace → 反查函数**

**思路**：把所有数据访问录下来 → 在 Trace 中按变量地址/符号搜索 → 结果行自带程序符号（函数名）。

**步骤**：

1. **录数据访问**：与 §2 相同，确保目标支持数据 Trace；必要时开启**片上过滤**，只放行与该变量相关的访问，降低带宽压力。
2. **在 Trace 中查找变量读写**：

   * 打开 *Trace* 窗口 → `Find...` → *Address/Expression* 填变量名（如 `g_var`），*Cycle* 选 `Read/Write` 或分别选择；`Find All`。
   * 命令行等价：

```t32
; 查找对变量 g_var 的所有读/写
Trace.FindAll Address Var.RANGE(g_var) CYcle ReadWrite /List sYmbol Var TIme.Back

; 分开查读或写
Trace.FindAll Address Var.RANGE(g_var) CYcle Read
Trace.FindAll Address Var.RANGE(g_var) CYcle Write
```

3. **映射回函数**：

   * 在 `Trace.FindAll` 结果中点任一条，`Trace.List` 会同步跳到该指令，列中包含**符号/函数名**；
   * 也可使用更简洁的 `Trace.ListVar` 只查看“变量的读写列表”。

::: tip HLL 符号名
GUI 搜索框支持**变量名**（HLL），等价 `Var.RANGE(name)`；对结构体/数组也适用（如 `g_arr[3]`）。
:::

### 3.2 方案 B（无数据 Trace）：**读/写监视点（数据断点）**

**思路**：对变量地址设置**读/写监视点**，命中时记录当前 PC/函数与调用栈。适用于只有程序流 Trace 或无 Trace 带宽的情况。

**步骤**：

```t32
; 方式一：基于变量名（推荐）
Var.Break.Set g_var           ; 监视这个变量的访问（读写均可配置）

; 方式二：基于地址/范围（按需改成 /Read 或 /Write）
Break.Set 0x20001000 /Data /ReadWrite /Len 4

; 命中时查看当前函数/栈
; 可在 PRACTICE 脚本里打印 SYmbol()、FRAME 等，或手动看 Call Stack 窗口
```

**注意**：

* 数据断点数量受限于 DWT/Comparator 等硬件资源；
* 会影响实时性（尤其是“真停”式断点）；可将动作改为 **Spot** 等“轻触式”以降低侵入；
* 与编译优化相关：寄存器缓存/内联可能改变访存形态，必要时对关键对象加 `volatile` 或降优化验证。

---

## 4. Cortex‑M7 / S32G M 核专项建议

* **ETM + DWT**：M7 常见 ETM 支持程序流；DWT 提供数据比较器做硬件监视点。若要全量数据 Trace，需确认 SoC 的 **ETM/ETB/Nexus 通道**是否支持数据访问采集。
* **带宽**：数据 Trace 极吃带宽，优先用 **on-chip 过滤**（地址范围、读/写类型）缩减；观察 **FLOWERROR**。
* **多核**：多核环境要注意每核独立配置 Trace，必要时加核 ID 标注与统一触发；
* **时间一致性**：跨核事件分析时，尽量统一计时源或对齐时间戳。
---

## 5. 常见问题与排查

* **找不到变量命中**：确认变量未被优化掉（`static`/`const`/LTO），或者加 `volatile` 保证访存；使用 `Var.WHERE g_var` 验证地址。
* **Trace 丢包**：检查 **FLOWERROR**，缩小采集窗口、打开过滤；必要时减少并发 Trace 源或提高链路带宽。
* **函数树乱/缺边**：ETM 未全开、触发点设置导致丢前史、或优化内联过多；可在关键模块加 `noinline` 验证。
* **监视点不命中**：硬件比较器不足或被其他断点占用；精简断点，合并范围，或改为“写专用”。

---

## 6. 常用命令速查

```t32
; === 片上 Trace 基础 ===
Trace.METHOD ONCHIP
Trace.AUTOARM ON
Trace.AUTOINIT ON
Trace.RESet
Trace.ON
; ... run ...
Trace.OFF

; === 函数运行时 / 调用树 ===
Perf.FunctionRuntime.Show

; === 变量访问（数据 Trace 可用） ===
Trace.FindAll Address Var.RANGE(g_var) CYcle ReadWrite /List sYmbol Var TIme.Back
Trace.FindAll Address Var.RANGE(g_var) CYcle Read
Trace.FindAll Address Var.RANGE(g_var) CYcle Write
; Trace.ListVar  ; GUI：变量读写列表

; === 监视点（无数据 Trace） ===
Var.Break.Set g_var                 ; HLL 变量监视（读写都可配置）
Break.Set 0x20001000 /Data /ReadWrite /Len 4
; 命中后查看当前符号/栈
```

---

## 7. 小结

* **有数据 Trace**：优先 `Trace.FindAll` + `Trace.List/Trace.ListVar`，一键列出“谁读/写变量”，还能回放时序。
* **无数据 Trace**：用监视点（数据断点）收集命中位置，再看当前函数/调用栈。
* **函数调用树**：ETM + `Perf → Function Runtime` 是最快捷的性能鸟瞰工具。

