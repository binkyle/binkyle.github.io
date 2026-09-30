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

在嵌入式工程里，经常会遇到两种静态库场景：

- **作为 Producer**：把自己的源码编译成 `.a`，交给其他团队或第三方集成；
- **作为 Consumer**：拿到供应商提供的 `.a`，再链接进自己的 ECU 工程。

两种场景其实是同一条构建链的两端。

本文结合 **TC397 + TASKING + AUTOSAR Classic** 工程，完整梳理：

```text
.c
 │
 │ Compile
 ▼
.o
 │
 │ Archive
 ▼
.a
 │
 │ Link
 ▼
ELF
 │
 ▼
HEX / ECU
```

重点不是某一个具体库，而是理解 **Compile、Archive、Link** 三个阶段分别做了什么，以及一个嵌入式静态库真正要能够被第三方使用，需要满足哪些条件。

<!-- more -->

## 1. Compile、Archive、Link 是三件不同的事

很多人第一次接触静态库时，会把“编译一个库”理解成：

```text
源码 → libxxx.a
```

实际过程应该拆成：

```text
Source
  │
  │ Compiler
  ▼
Relocatable Object
  │
  │ Archiver
  ▼
Static Library
  │
  │ Linker
  ▼
Executable Image
```

在 TASKING TriCore 工具链中，可以对应为：

| 阶段 | 工具 | 作用 |
|---|---|---|
| Compile | `cctc` | 将 C 源文件编译成可重定位目标文件 |
| Assemble | `astc` | 将 TriCore 汇编源编译成目标文件 |
| Archive | `artc` | 将多个 `.o` 组织成静态库 `.a` |
| Link | `ltc` | 解析符号、重定位、执行 LSL 放置并生成 ELF |

因此，静态库并不是“编译完成的程序”，而是 **Link 之前的一种中间交付形态**。

---

## 2. Stage 1：从 `.c` 到 `.o`

以一个普通模块为例：

```text
Module.c
   │
   │ cctc
   ▼
Module.o
```

对 C 源文件而言，`cctc` 作为 compiler driver，内部完成预处理、代码生成以及汇编等步骤。

可以概念化为：

```text
Module.c
   │
   ├─ preprocessing
   ├─ compilation / code generation
   └─ assembly
   ▼
Module.o
```

需要注意的是，`astc` 是 TriCore 汇编器，但并不是：

```text
.c → .o → astc → 再生成一个 .o
```

对于独立的 `.s` 汇编文件，构建系统才会显式走汇编规则。

### 编译阶段已经固定了什么？

当源码变成 `.o` 时，很多关键属性其实已经确定，例如：

- 目标 CPU / TriCore ISA；
- calling convention；
- 数据对齐；
- enum 表示方式；
- 浮点模型；
- C/C++ ABI；
- 符号名称；
- section 名；
- 部分 memory model。

所以即使两个库都声称支持 TC397，也不能简单认为它们一定兼容。

> **CPU 相同只是第一层条件，真正决定二进制能否互相调用的是 ABI。**

---

## 3. 一个 `.o` 里到底有什么？

`.o` 可以理解成：

> **已经生成机器代码，但还没有决定最终运行地址的可重定位模块。**

一个典型 Object 中会包含：

### 3.1 Defined Symbol

例如：

```text
App_Init
App_MainFunction
```

表示这些函数由当前 Object 提供。

### 3.2 Undefined Symbol

例如：

```text
Rte_Read_xxx
Platform_GetTime
memcpy
```

表示当前 Object 使用了这些符号，但定义来自其他模块或库。

Undefined Symbol 并不意味着编译失败。

它表达的是：

> “我需要这个函数，但现在还不知道它最终来自哪里，留到 Link 阶段解决。”

### 3.3 Relocation

Object 中还会保存 relocation 信息。

因此此时：

```text
函数最终在哪个 Flash 地址？
全局变量最终在哪块 RAM？
外部函数最终地址是多少？
```

都还没有确定。

---

## 4. Section 是编译阶段和链接阶段之间的契约

AUTOSAR 工程里经常会看到：

```text
.text.xxx
.rodata.xxx
.data.xxx
.bss.xxx
```

或者更具体的核、本地 RAM、共享 RAM 等 section。

这些 section 名通常通过：

- MemMap；
- `#pragma section`；
- compiler attribute；

在 **Compile 阶段**写进 Object。

流程是：

```text
函数 / 变量
   │
   │ MemMap / pragma
   ▼
Section Name
   │
   ▼
.o
```

而最终：

```text
Section
   ↓
PFlash / LMU / DSPR / PSPR
   ↓
Final Address
```

则由 Linker + LSL 决定。

因此可以记住一句话：

> **Compiler 决定“属于哪个 Section”，Linker 决定“Section 最后放在哪里”。**

---

## 5. Stage 2：从多个 `.o` 到静态库 `.a`

当一个模块需要以二进制形式对外交付时，可以把多个 Object 组织成一个静态库。

例如：

```text
ModuleA.o
ModuleB.o
ModuleC.o
    │
    │ artc
    ▼
libProduct.a
```

TASKING Archiver 的典型形式类似：

```bash
artc -cr libProduct.a -f objects.rsp
```

其中 response file 用来保存较长的 Object 列表。

静态库的内部结构可以简化为：

```text
libProduct.a
├── ModuleA.o
├── ModuleB.o
├── ModuleC.o
├── ...
└── Archive Symbol Index
```

它的核心并不是“再次编译”，而是：

1. 保存多个可重定位 Object；
2. 建立符号索引；
3. 让 Linker 以后可以根据符号快速找到对应成员。

所以 `.a` 更接近：

> **Object 集合 + Symbol Index**

而不是一个已经完成地址分配的程序。

---

## 6. 为什么静态库里可以存在 Undefined Symbol？

这是理解静态库最关键的一步。

假设：

```text
ModuleA.o
  Defined:
    Product_Init

  Undefined:
    Rte_Read_xxx
    memcpy
    Platform_GetTime
```

即使这些 Undefined Symbol 当前没有定义，`ModuleA.o` 仍然可以被正常放进：

```text
libProduct.a
```

因为 **Archive 阶段不负责最终符号解析**。

真正的职责划分是：

| 行为 | Compile | Archive | Link |
|---|---:|---:|---:|
| C → Machine Code | ✅ | ❌ | ❌ |
| 产生 Symbol | ✅ | 保留 | 解析 |
| 产生 Relocation | ✅ | 保留 | 处理 |
| 打包多个 Object | ❌ | ✅ | ❌ |
| 建立 Archive Index | ❌ | ✅ | 使用 |
| 决定最终地址 | ❌ | ❌ | ✅ |
| 执行 Memory Placement | ❌ | ❌ | ✅ |
| 生成 ELF | ❌ | ❌ | ✅ |

因此：

> **生成静态库时，不需要把所有外部依赖全部解决。**

真正需要保证的是：

> Consumer 最终 Link 时，所有被使用到的 Undefined Symbol 都能够找到对应定义。

---

## 7. Stage 3：Consumer 如何链接一个静态库

当另一个工程拿到：

```text
libProduct.a
```

通常需要同时配置：

```text
-L<library_path>
-lProduct
```

两者职责完全不同：

```text
-Lxxx       → 去哪里找库
-lProduct   → 要链接哪个库
```

然后 Linker 开始处理：

```text
Application Objects
      +
libProduct.a
      +
Runtime Libraries
      ↓
      ltc
      ↓
ELF
```

### Linker 会把整个 `.a` 都放进 ELF 吗？

通常不会。

静态库最大的特点之一就是：

> **Linker 按需要从 Archive 中抽取 Object。**

例如：

```text
Application.o
   │
   │ needs Product_Init
   ▼
Archive Symbol Index
   │
   ▼
找到 ModuleA.o
   │
   ▼
抽取 ModuleA.o
   │
   ├─ 又产生新的 Undefined Symbol
   ▼
继续解析
```

因此：

```text
Archive File Size
≠
最终进入 ELF 的代码大小
≠
最终 Flash 占用
```

这也是为什么一个很大的静态库，最终对 ECU ROM 的增量可能远小于库文件本身。

---

## 8. Linker 不只做“找函数”，还要做 Relocation 和 Memory Placement

当需要的 Object 被抽取出来以后，Linker 还要继续完成：

1. Symbol Resolution；
2. Relocation；
3. Section 合并；
4. LSL 匹配；
5. Memory Region 分配；
6. Final Address Assignment；
7. ELF / HEX 生成。

可以把整个过程理解成：

```text
Object Section
    ↓
Linker
    ↓
LSL select / group
    ↓
Memory Region
    ↓
Final Address
```

对于 TC397 这类多核 MCU，这一步尤其重要，因为代码和数据可能需要进入：

- PFlash；
- DSPR；
- PSPR；
- LMU；
- cached / non-cached memory；
- 不同 Core 对应的专属区域。

所以一个静态库即使：

```text
API 没问题
ABI 没问题
Symbol 也能解析
```

仍然可能因为：

```text
Section 没有正确匹配 LSL
Memory Region 不够
Startup 没有初始化对应数据
```

而无法正确运行。

---

## 9. 为什么嵌入式静态库不能只交付一个 `.a`

假设我们作为 Producer，要把：

```text
libProduct.a
```

交给第三方。

真正完整的交付至少应该考虑下面几类信息。

### 9.1 Public Header

第三方需要知道：

- API 函数；
- struct / enum；
- callback；
- version；
- public typedef。

### 9.2 ABI 要求

例如：

- Target CPU / ISA；
- Compiler / compatible ABI；
- alignment；
- enum model；
- floating-point model；
- C/C++ ABI。

### 9.3 Link Dependencies

例如：

```text
libProduct.a
   ↓
runtime library
platform library
AUTOSAR BSW / RTE symbols
```

如果库依赖其他 library，需要明确告诉 Consumer。

### 9.4 Memory / LSL Contract

如果库定义了特殊 section：

```text
.data.xxx
.bss.xxx
.text.xxx
```

第三方可能还需要同步：

- LSL select；
- memory region；
- alignment；
- cached / non-cached 属性。

### 9.5 Startup / Runtime Contract

还可能涉及：

- `.data` copy；
- `.bss` clear；
- Init API；
- Task / Core；
- Heap / Stack；
- callback；
- RTE / MCAL / OS dependency。

因此：

> **真正交付的不是一个 `.a` 文件，而是一套二进制接口契约。**

---

## 10. Producer 和 Consumer 是同一条链的两端

可以用两个匿名化场景理解。

### Producer：把自己的模块做成库

```text
Product Source
      │
      │ cctc
      ▼
Objects
      │
      │ artc
      ▼
libProduct.a
      │
      ▼
交付第三方
```

### Consumer：接入供应商提供的库

```text
Supplier
   │
   ▼
libVendor.a + headers
   │
   ▼
当前工程
   │
   ├─ include path
   ├─ library path
   ├─ -lVendor
   ├─ runtime dependencies
   └─ LSL / startup
   │
   ▼
ltc
   │
   ▼
ELF
```

这两种场景实际上遵循同一个规则：

> Producer 在 Compile / Archive 阶段固定二进制边界，Consumer 在 Link 阶段完成最终解析和部署。

---

## 11. 最容易混淆的几个概念

### 11.1 `.o` 不是最终程序

它已经包含机器码，但仍然可能有：

- Undefined Symbol；
- Relocation；
- 未确定的最终地址。

### 11.2 `.a` 不是“已经链接好的模块”

它本质上是：

```text
Object 集合 + Symbol Index
```

最终 Link 仍然不可缺少。

### 11.3 同一个 MCU 不代表库一定兼容

除了 CPU，还必须看：

- ABI；
- compiler options；
- data model；
- floating-point model；
- alignment；
- runtime。

### 11.4 能找到库不代表集成完成

```text
找到 .a
  ↓
API 可编译
  ↓
Symbol 可解析
  ↓
Section 可放置
  ↓
Startup 正确
  ↓
Runtime 正确
```

任何一层出问题，都可能表现成完全不同的故障。

### 11.5 库文件大小不等于 ROM/RAM 占用

`.a` 里还可能包含：

- Debug Information；
- Symbol Table；
- String Table；
- Relocation；
- 未被最终抽取的 Object。

实际资源占用应该看：

> **最终 ELF / Map 中真正进入镜像的 ALLOC Section。**

---

## 12. 总结

一个 TC397 静态库从源码到最终 ECU 镜像，可以抽象成：

```text
.c
 │
 │ Compile
 │ 固定 ISA / ABI / Symbol / Section
 ▼
.o
 │
 │ Archive
 │ 组织 Object + 建立 Symbol Index
 ▼
.a
 │
 │ Link
 │ 抽取成员 + Symbol Resolution + Relocation
 ▼
LSL
 │
 │ Memory Placement
 ▼
ELF
 │
 ▼
HEX / ECU Runtime
```

真正需要记住的是三点：

> **第一，`.o` 可以保留 Undefined Symbol，因为最终解析发生在 Link 阶段。**

> **第二，`.a` 本质上是可重定位 Object 的归档，而不是已经完成链接的程序。**

> **第三，嵌入式静态库是否真正可用，不只取决于 API，还取决于 ABI、Runtime、Section、LSL、Startup 和最终执行环境。**

理解了 **Compile → Archive → Link** 的职责边界之后，很多工程问题都会变得更直观：

- 为什么同一个 TC397 的库仍可能不能直接使用；
- 为什么 `-lxxx` 找到了库却还会报 Undefined Symbol；
- 为什么库文件很大但 Flash 增量并不大；
- 为什么接入一个静态库还可能需要修改 LSL；
- 为什么一个真正可交付的静态库远不止一个 `.a` 文件。
