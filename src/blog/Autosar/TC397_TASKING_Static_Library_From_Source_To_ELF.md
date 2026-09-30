---
title: 从 .c 到 .a 再到 ELF：TC397 + TASKING 静态库生产与链接全流程
icon: code
date: 2026-09-30
category:
  - Autosar
tag:
  - TC397
  - TASKING
  - 静态库
  - Linker
  - AUTOSAR
isOriginal: true
article: true
timeline: true
---

在嵌入式工程里，我们经常会接触两类静态库：

- **自己生产的库**：把工程源码编译成 `.a`，交给第三方集成；
- **别人交付的库**：拿到供应商的 `.a`，再链接进自己的 ECU 工程。

这两件事表面上都是“用静态库”，本质却处在构建链的两端。

本文基于一个 **Infineon TC397 + TASKING TriCore v6.3r1 + AUTOSAR Classic** 的真实工程取证，以工程自身生成的 **`libAdc.a`** 为 Producer 主案例，完整走一遍：

```text
.c
 │
 │ TASKING cctc
 ▼
relocatable .o
 │
 │ TASKING artc
 ▼
libAdc.a
 │
 │ TASKING ltc
 ▼
ELF
 │
 ▼
HEX
```

并在最后用第三方的 `libDrApp.a` 做 Consumer 侧对照。

<!-- more -->

## 1. 先建立正确模型：Compile、Archive、Link 是三件事

很多人第一次接触静态库时，会把“编译库”理解成一个步骤：

```text
源码 → libxxx.a
```

真实过程至少应该拆成：

```text
Source
  │
  │ Compile
  ▼
Object
  │
  │ Archive
  ▼
Static Library
  │
  │ Link
  ▼
Executable Image
```

在当前工程中，对应工具分别是：

| 阶段 | TASKING 工具 | 主要职责 |
|---|---|---|
| Compile | `cctc` | C 源码编译，生成可重定位目标文件 |
| Assemble | `astc` | TriCore 汇编器；显式 `.s` 规则直接使用 |
| Archive | `artc` | 把大量 `.o` 组织成静态归档 `.a` |
| Link | `ltc` | 抽取成员、解析符号、重定位、执行 LSL 放置并生成 ELF |

工程中的工具链版本为：

```text
TASKING VX-toolset for TriCore v6.3r1
Target: tc39xb
Core:   tc1.6.2
```

目标 MCU 为 TC397 / TC39x。

---

## 2. Stage 1：源码如何变成 `.o`

### 2.1 编译入口是 `cctc`

工程 Makefile 中：

```makefile
CC = cctc
```

并针对 TC39x 使用：

```text
-Ctc39xb
--core=tc1.6.2
```

例如一个真实编译单元：

```text
Adc.c
```

最终生成：

```text
Adc.o
```

从工具职责上，真实模型更准确地写成：

```text
Adc.c
  │
  │ cctc compiler driver
  │
  ├─ preprocessing
  ├─ C compilation / code generation
  └─ assembly
  ▼
Adc.o
```

也就是说，不应该理解成：

```text
.c → .o → astc → 又一个 .o
```

`astc` 是实际汇编工具，但对 C 文件，工程侧主要由 `cctc` 作为 driver 驱动完整流程；只有独立汇编源 `.s` 才在 MakeSupport 中看到显式 `astc` 规则。

### 2.2 编译阶段已经固定了很多东西

当前工程关键编译选项包括：

```text
--fp-model=2
--align=4
--default-near-size=0
--default-faraccess=call,xy
--use-address-registers=a10,a11
--no-clear
-O2
--iso=99
--language=-gcc,+volatile,+typeof
--exceptions
--c++-style-comments
--char-is-signed
--enum-size=int
```

这些参数很重要，因为一个静态库在变成 `.o` 时，就已经固定了一大批 ABI 和代码生成属性，例如：

- TriCore 指令集；
- calling convention；
- 枚举表示；
- 对齐规则；
- 浮点模型；
- 符号命名；
- section 名；
- near/far 等地址模型相关属性。

所以：

> **同样都是 TC397，并不意味着任意编译器、任意参数生成的库都天然兼容。**

真正能否安全集成，还要看 ABI 和运行环境是否匹配。

---

## 3. 一个 `.o` 里到底有什么？

从 `libAdc.a` 中取出真实成员，对 `Adc.o`、`CanServer.o` 等执行 TASKING `elfdump`，可以看到三个很关键的事实。

### 3.1 它已经有 Defined Symbol

例如：

```text
Adc_Init
```

已经是：

```text
GLOBAL FUNC
```

也就是：

> 这个 Object 已经知道“我实现了哪些函数”。

### 3.2 它同时可以保留 Undefined Symbol

例如：

```text
Mcal_xxx
Rte_xxx
__d_xxx
```

仍然可以处于：

```text
GLOBAL UND
```

这并不代表编译失败。

Object 文件允许说：

> “我需要这个符号，但当前编译单元不负责实现它，留到以后链接时再找。”

### 3.3 它还保留 Relocation

`.o` 中存在 `.rela.*` 等 relocation 信息。

这说明此时：

```text
函数在哪里？
全局变量在哪里？
外部符号最终地址是多少？
```

都还没有最终决定。

因此可以把 `.o` 理解成：

> **已经生成机器代码，但仍然可以搬家、仍然等待外部符号解析的可重定位模块。**

---

## 4. Section 名在什么时候产生？

这是嵌入式库与普通 PC Library 很不一样的地方。

在实际 Object 中可以看到类似：

```text
.text.MSR_CODE
.rodata.MSR_PBCONST
.bss.MSR_VAR_CLEARED
.bss.bss_lmu1_core0
.bss.OS_CORE0_VAR_CLEARED
```

这些名字并不是 Linker 最后临时发明出来的。

工程通过 MemMap / `#pragma section` 等机制，在**编译阶段**就把函数和变量归入特定 section。

流程可以理解为：

```text
变量 / 函数
   │
   │ MemMap / pragma
   ▼
Section Name
   │
   │ 编译进 .o
   ▼
.text.xxx / .data.xxx / .bss.xxx
```

真正到 Link 阶段，LSL 做的是：

```text
Section Name
   ↓
Memory Region
   ↓
最终地址
```

也就是说：

> **Compiler 决定“属于哪一类 Section”，Linker 决定“这个 Section 最后放到哪”。**

---

## 5. Stage 2：为什么工程要生成 `libAdc.a`

当前工程存在一个很关键的构建开关：

```text
RELEASE_FLAG
```

取证发现，Release 模式不是简单地“再生成一个库文件”，而是存在 **Source Mode → Library Mode** 的切换机制。

在相关 Global Makefile 中：

- 某些对象 / library path / include dir 会被重新整理；
- Release 路径下会生成 `libAdc.a`；
- 随后最终工程通过 `-lAdc` 再消费这个库。

这形成了一条很有价值的自验证链：

```text
工程源码
   ↓
编译
   ↓
Object
   ↓
libAdc.a
   ↓
同一工程 Release Link
   ↓
ELF
```

因此 `libAdc.a` 并不是一个抽象概念，它正是工程提供给外部集成者时可以使用的二进制交付形态。

---

## 6. 719 个 Object 如何变成一个 `libAdc.a`

### 6.1 先生成成员列表

取证得到：

```text
libAdc_objs.rsp
```

最终参与归档的 Object 数量为：

```text
719
```

随后形成供 Archiver 使用的 response file。

### 6.2 真正的归档命令

工程确认：

```makefile
AR = artc
ARFLAGS = -cr
```

实际规则等价于：

```text
删除旧 libAdc.a
        ↓
artc -cr libAdc.a -f libAdc.rsp
```

这里“先删旧文件”很重要。

它避免旧 archive member 因增量更新而意外残留，使本次 `libAdc.a` 的成员集合完全由新的 response file 决定。

最终生成：

```text
libAdc.a
size ≈ 134,003,004 bytes
```

---

## 7. `.a` 本质上是什么？

对 `libAdc.a` 检查后：

```text
magic = !<arch>
members = 719
```

使用：

```bash
artc -t libAdc.a
```

可以直接列出归档成员，其中包含真实的：

```text
Adc.o
...
```

因此一个静态库可以非常直观地理解为：

```text
libAdc.a
├── Object_A.o
├── Object_B.o
├── Adc.o
├── CanServer.o
├── ...
└── Archive Symbol Index
```

它不是已经完成最终地址分配的“半个 ELF”。

更准确地说，它是：

> **一组 relocatable Object + 用于快速检索符号的 Archive Index。**

---

## 8. Archive 不负责解决符号

这是整个静态库机制里最重要的概念之一。

`libAdc.a` 中聚合得到的 Undefined Symbol 数量为：

```text
17146
```

进一步分析：

```text
16707
```

可以在库内部其它 Object 中找到定义。

剩余真正需要最终 Consumer 提供的外部符号约：

```text
439
```

包括：

- LSL 边界符号；
- TASKING 浮点运行时中的 `__d_*`；
- TASKING runtime 中的 `__ll_*`；
- 以及其它平台侧依赖。

这说明：

```text
artc
```

在创建 `libAdc.a` 时并不会要求：

> “所有 Undefined Symbol 必须全部解决。”

它只负责：

```text
.o
 +
.o
 +
.o
   ↓
Archive
```

真正的 Symbol Resolution 要留给最终 Link。

---

## 9. Archive 阶段到底做了什么、没做什么？

可以用一张表概括：

| 行为 | Compile | Archive | Link |
|---|---:|---:|---:|
| C → Machine Code | ✅ | ❌ | ❌ |
| 生成 Section | ✅ | ❌ | ❌ |
| 生成 Symbol | ✅ | ❌ | ❌ |
| 保存 Relocation | ✅ | 保留 | 处理 |
| 打包多个 Object | ❌ | ✅ | ❌ |
| 建立 Archive Index | ❌ | ✅ | 使用 |
| 解析外部符号 | ❌ | ❌ | ✅ |
| 决定最终地址 | ❌ | ❌ | ✅ |
| 执行 LSL Placement | ❌ | ❌ | ✅ |
| 生成 ELF | ❌ | ❌ | ✅ |

所以：

> **Archive 基本不改变 Object 的二进制语义，它主要负责组织与索引。**

---

## 10. 为什么 134 MB 的 `.a` 不代表 134 MB Flash？

这是工程中非常容易误判的问题。

`libAdc.a` 包含：

- 真正会进入 ECU 的代码/常量/数据；
- Symbol Table；
- String Table；
- Relocation；
- TASKING metadata；
- DWARF Debug Information；
- Archive Index；
- Object 元数据。

因此：

```text
libAdc.a file size
≠
Flash usage
```

甚至：

```text
ELF file size
≠
Flash usage
```

最终 Flash / RAM 占用应该看：

- Link Map；
- ALLOC Section；
- Memory Region；
- 最终 HEX / binary layout。

当前 `libAdc.a` 没有 strip，成员还包含 DWARF 信息，因此 archive 本身很大是正常的。

这也带来另一个 Release Hygiene 问题：

> 如果对外交付二进制库，需要关注 Debug Info、绝对源码路径、member timestamp 等元信息是否应该保留。

---

## 11. Stage 3：Consumer 怎么使用 `libAdc.a`

Release 模式下，工程最终会：

```makefile
SYSLIBS += -lAdc
```

同时当前目录：

```text
-L./
```

位于 library search path。

于是：

```text
-lAdc
   ↓
搜索 libAdc.a
   ↓
交给 ltc
```

这里必须区分：

```text
-L
```

和：

```text
-l
```

的职责：

```text
-Lxxx    = 去哪里找
-lAdc    = 要找哪个库
```

---

## 12. Linker 并不会把整个 `libAdc.a` 都塞进 ELF

静态库最大的价值之一就在这里。

假设 archive 中有：

```text
719 个 Object
```

Linker 不需要把 719 个全部放入镜像。

它从当前 unresolved symbol 开始：

```text
某个 Object 需要 Foo()
      ↓
Archive Symbol Index
      ↓
找到 Foo 所在 Member
      ↓
抽取 Member
      ↓
该 Member 又产生新的 Undefined Symbol
      ↓
继续解析
```

实际工程的 Map 已经能在其它静态库上看到类似信息：

```text
Member[libSocManager.a|timer_soft_timer.o]
Symbol[...]
```

这证明 TASKING Map 能记录：

> **哪个符号触发了哪个 Archive Member 被拉入最终镜像。**

当前缺少一次 `RELEASE_FLAG=1` 的完整 Map，因此：

> `libAdc.a` 在 Release ON 时具体抽取了哪些成员、每个成员最终地址是多少，目前仍然是 Unknown。

这也是现阶段最值得继续补的一项证据。

---

## 13. Symbol Resolution：剩下的 439 个符号怎么办？

当 Linker 把需要的 `libAdc.a` 成员抽出来以后，成员内部仍可能引用外部符号。

例如：

```text
__d_xxx
__ll_xxx
LSL boundary symbol
...
```

最终工程还需要：

```text
-lfp
-lrt
其它平台对象
LSL 定义
```

继续完成解析。

于是最终链接的核心问题不再是：

> “Library 文件存在吗？”

而是：

> “所有真正被抽取进来的 Object，其 Undefined Symbol 能否在整个链接输入集合中被满足？”

这才是判断一个静态库能不能成功集成的关键。

对于当前 TASKING `ltc`，取证表明其 library 解析行为不能简单套用 GNU ld 的“一次从左往右扫描”经验；当前配置会对库进行多次扫描。因此讨论 library order 时，应以具体 TASKING Linker 行为为准，而不是直接套 GNU 工具链结论。

---

## 14. LSL 在这个阶段才真正决定地址

编译阶段已经产生：

```text
.bss.bss_lmu1_core0
```

但它还不知道最后实际地址。

工程 `vLinkGen_Template.lsl` 中存在对应规则，例如：

```text
select "[.]bss.bss_lmu1_core0"
```

然后将其映射到相应 Memory Region，并产生相关 Linker boundary symbol。

完整过程：

```text
Source Variable
   ↓
MemMap / pragma
   ↓
.bss.bss_lmu1_core0
   ↓
Object
   ↓
libAdc.a
   ↓
ltc
   ↓
LSL select
   ↓
LMU / DSPR / PFlash ...
   ↓
Final Address
```

这正好说明：

> **Section Name 是 Compile-time Contract，Memory Address 是 Link-time Decision。**

---

## 15. Startup 也是静态库契约的一部分

当前工程存在：

```text
--no-clear
--user-provided-initialization-code
```

因此变量初始化并不是一句：

> “Linker 把 `.data/.bss` 放进去就结束了。”

还涉及：

- initialized data 的 load / run address；
- Copy Table；
- zero initialization；
- startup code；
- Linker 生成的边界符号。

所以一个对外交付的嵌入式静态库，如果包含特殊：

```text
.data.xxx
.bss.xxx
```

就不能只告诉第三方：

```text
-lAdc
```

还应该明确：

> Consumer 的 LSL 和 Startup 是否能够正确处理这些 Section。

这也是嵌入式静态库与普通桌面软件静态库集成的核心差异之一。

---

## 16. Stage 4：最后生成 ELF / HEX

Linker 完成：

1. Archive Member Extraction
2. Symbol Resolution
3. Relocation
4. Section Placement
5. Address Assignment

之后生成：

```text
TestSuit.elf
TestSuit.map
TestSuit.hex
```

现有取证中的 `TestSuit.elf` 约：

```text
69,969,736 bytes
```

但这个现有产物属于：

```text
RELEASE_FLAG = OFF
```

也就是：

> 工程 Object 直接进入 ELF，并没有通过 `libAdc.a → -lAdc` 的 Release 自消费路径。

因此目前能确认：

```text
Source → Object → ELF
```

以及：

```text
Source → Object → libAdc.a
```

都已经跑通。

而：

```text
libAdc.a → 按需抽取 → Final ELF
```

这一段机制已经确认，但 `libAdc.a` 自身在 Release ON 下的逐成员地址证据仍待一次安全构建闭环。

---

## 17. 一张图总结完整生命周期

```text
┌──────────────────── Producer ────────────────────┐

ADC Source (.c)
      │
      │ cctc
      ▼
Relocatable Objects (.o)
      │
      │  section / symbol / relocation 已存在
      ▼
719 Objects
      │
      │ artc -cr libAdc.a -f libAdc.rsp
      ▼
libAdc.a
      │
      ├─ !<arch>
      ├─ Object Members
      └─ Archive Symbol Index

└─────────────────────────────────────────────────┘
                       │
                       │ Delivery / Release
                       ▼
┌──────────────────── Consumer ────────────────────┐

-L...
-lAdc
      │
      ▼
TASKING ltc
      │
      ├─ Archive Member Extraction
      ├─ Symbol Resolution
      ├─ Runtime Libraries
      ├─ Relocation
      └─ LSL Placement
      ▼
TestSuit.elf
      │
      ▼
HEX / ECU

└─────────────────────────────────────────────────┘
```

---

## 18. 反过来看第三方库 `libDrApp.a`

前面的 `libAdc.a` 是：

> **当前工程作为 Producer。**

而第三方交付的 `libDrApp.a` 正好提供了另一侧案例：

```text
第三方源码
   ↓
供应商编译
   ↓
libDrApp.a
   ↓
当前工程
   ↓
-lDrApp
   ↓
ltc
   ↓
ELF
```

当前工程通过：

```text
DEEPROUTE_SWC_FLAG=1
```

同时完成：

- 切换对应 SWC Wrapper；
- 增加 library search path；
- 增加 `-lDrApp`；
- 增加配套 `-lc_tc397`。

因此两个案例刚好形成镜像：

| 视角 | 案例 |
|---|---|
| 我怎么把自己的源码做成库 | `libAdc.a` |
| 我怎么把别人的库接入工程 | `libDrApp.a` |

理解了前者，后者的很多问题就自然清楚了。

---

## 19. Producer 和 Consumer 真正需要对齐什么？

一个静态库能够被另一个嵌入式工程正确使用，至少需要检查：

### 编译 / ABI

- CPU Architecture
- TriCore ISA
- Compiler ABI
- Calling Convention
- Enum Model
- Alignment
- Floating Point Model
- C / C++ ABI
- Address Model

### Link

- Public Header
- Library Search Path
- Library Name
- Undefined Symbol Provider
- Runtime Library
- Library Dependency
- TASKING Linker 行为

### Memory

- Custom Section
- LSL Select
- PFlash / LMU / DSPR 等 Region
- Copy / Clear
- Startup

### Runtime

- Init 顺序
- API 生命周期
- Task / Core
- Stack
- Heap
- RTE / BSW / MCAL 依赖

所以：

> **“给一个 `.a` 文件”并不等于完成嵌入式 Library Delivery。**

真正的交付对象应该是一套完整的二进制接口契约。

---

## 20. 最容易混淆的几个概念

### 20.1 `.o` 不是最终机器镜像

它已经有机器码，但：

- 可以有 Undefined Symbol；
- 可以有 Relocation；
- 没有最终运行地址。

### 20.2 `.a` 不是把所有依赖都链接好了

它主要是：

```text
Object 集合 + Symbol Index
```

因此完全可以保留外部依赖。

### 20.3 静态库文件大，不代表 Flash 占用大

```text
archive size
≠
linked code size
≠
Flash usage
```

### 20.4 Section 和 Address 不是一回事

```text
Compiler → Section Name
Linker   → Final Address
```

### 20.5 能找到 Library，不代表集成成功

真正需要闭环：

```text
找到库
  ↓
抽取成员
  ↓
符号全部解析
  ↓
Section 正确放置
  ↓
Startup 正确初始化
  ↓
Runtime 正确执行
```

---

## 21. 当前证据已经确认什么，什么还没有确认？

| 项目 | 状态 |
|---|---|
| TC397 / TASKING v6.3r1 | Confirmed |
| `.c → .o` 编译规则 | Confirmed |
| ABI 关键编译参数 | Confirmed |
| Section 编译期产生 | Confirmed |
| `libAdc.a` 使用 `artc` | Confirmed |
| 719 个 Archive Member | Confirmed |
| `!<arch>` 格式 | Confirmed |
| Archive 保留 relocation / undefined symbol | Confirmed |
| Release 模式使用 `-lAdc` | Confirmed |
| Linker 按需抽取机制 | Confirmed |
| LSL 决定最终 Region / Address | Confirmed |
| Release ON 时 `libAdc.a` 实际抽取哪些成员 | **Unknown** |
| Release ON 时成员最终地址 | **Unknown** |
| 最大 Stack | **Unknown** |
| 完整逐条 `-I` 编译命令 | **Unknown** |
| 正式第三方交付包完整清单 | **Unknown** |

保留 Unknown 很重要。

工程分析最危险的不是“不知道”，而是：

> **把“机制上应该如此”写成“当前工程已经证明如此”。**

---

## 22. 最终结论

从这个 TC397 + TASKING 工程可以非常清楚地看到，静态库生命周期不是一句：

```text
编译成 .a 然后链接
```

而是一条严格分层的流水线：

```text
.c
 │
 │ 编译：固定 ISA / ABI / Symbol / Section
 ▼
.o
 │
 │ 归档：组织 Object + 建立 Symbol Index
 ▼
.a
 │
 │ 链接：按需抽取 + Symbol Resolution + Relocation
 ▼
LSL
 │
 │ 决定 Memory Region / Final Address
 ▼
ELF
 │
 ▼
HEX / ECU Runtime
```

其中最值得记住的是三句话：

> **第一，`.o` 可以保留 Undefined Symbol，因为最终解析发生在 Link。**

> **第二，`.a` 本质上是一组可重定位 Object 的归档，而不是已经完成链接的程序。**

> **第三，嵌入式库是否真正可用，不只取决于 API，还取决于 ABI、Runtime、Section、LSL、Startup 和最终执行环境。**

一旦把 **Compile → Archive → Link** 三个阶段真正分开，很多常见问题——为什么 `-lxxx` 会报错、为什么 Library 很大但 Flash 增量很小、为什么同样 TC397 的库仍可能不能用、为什么还需要修改 LSL——都会变得非常直观。
