---
title: GNU ld 链接脚本入门实践指南
date: 2025-06-18
order: 1
isOriginal: true
article: true
timeline: true
categories:
 - C
tags:
 - Link-File
---
## 目录
- 概览：链接器在构建系统中的角色
- 重要概念：输入节、输出节、程序头（段）、VMA/LMA
- 链接脚本骨架：`OUTPUT_*`、`ENTRY`、`PHDRS`、`MEMORY`、`SECTIONS`
- 段权限与装载：`PHDRS` 与 `:phdr` 绑定（RX/RW 划分）
- 物理内存映射（嵌入式）：`MEMORY`、`>REGION`、`AT>`、`REGION_ALIAS`
- 输入节选择与整理：通配、`KEEP`、`EXCLUDE_FILE`、`/DISCARD/`
- 常用表达式：`.`、`ALIGN`、`SIZEOF`、`ADDR`、`LOADADDR`
- 最小可跑示例（Linux）与验证方法（`readelf`/`objdump`）
- 最小可跑示例（ARM/裸机）与启动搬运符号
- 孤儿节与错误复现：`--orphan-handling=error`
- 调试与排错：map 文件、节/段检查清单
- 常见陷阱与最佳实践清单
- 术语速查表（glossary）
- 进一步阅读（官方文档入口）

---

## 概览：链接器在构建系统中的角色

编译器把每个 `.c/.S` 翻译为 `.o`（目标文件），这些对象含有若干 **输入节（input section）**，例如：`.text`（代码）、`.rodata`（只读常量）、`.data`（已初始化可写数据）、`.bss`（未初始化数据）。

**链接器（ld）** 将所有 `.o` 和 `.a` 归并：
- 解析未定义符号，做重定位；
- 将若干输入节聚合成 **输出节（output section）**；
- 生成 **程序头（Program Headers / Segments）**，告诉加载器如何把文件片段映射进内存并设置权限。

当你不写 linker script 时，ld 使用 **默认脚本**，其规则对多数普通程序足够；当你需要更强控制（嵌入式布局、特殊段、性能/安全需求）时，就需要自定义脚本。

---

## 重要概念：输入节、输出节、程序头、VMA/LMA

- **输入节（input section）**：编译器/汇编器放入 `.o` 的节，如 `.text`、`.data`、自定义 `.MY_NOINIT`。你可用 `__attribute__((section(".foo")))` 指定它。
- **输出节（output section）**：链接脚本 `SECTIONS { ... }` 定义的目标节，如输出 `.text`、`.data`、`.bss`、自定义段。
- **程序头（Program Header / Segment, `PT_*`）**：加载器按“段”装载文件片段，并按 `p_flags` 设定权限：
  - `PF_X=0x1`（可执行）、`PF_W=0x2`（可写）、`PF_R=0x4`（可读）。
  - 常见组合：RX=0x5、RW=0x6。
- **VMA / LMA**：
  - **VMA（运行地址）**：节在运行时的地址。
  - **LMA（加载地址）**：节的初始内容从文件装载到内存的位置。嵌入式常见 `.data`：LMA 在 FLASH、VMA 在 RAM，启动时从 LMA 复制到 VMA。

---

## 链接脚本骨架

```ld
OUTPUT_FORMAT("elf64-x86-64")   /* 目标格式 */
ENTRY(_start)                     /* 入口符号 */

/* 1) 定义两个 PT_LOAD：text=RX、data=RW */
PHDRS {
  text PT_LOAD FILEHDR PHDRS FLAGS(0x5);  /* PF_R|PF_X：可读可执行，含文件头与程序头表 */
  data PT_LOAD            FLAGS(0x6);     /* PF_R|PF_W：可读可写 */
}

/* 2) 组织输出节并绑定到相应段 */
SECTIONS {
  . = SIZEOF_HEADERS;

  /* 代码与只读常量 → RX 段 */
  .text : {
    *(.text .text.*)
    *(.rodata .rodata.*)
  } :text

  /* 页对齐后切换到 RW 段，避免跨段 */
  . = ALIGN(CONSTANT(MAXPAGESIZE));

  /* 可写数据 → RW 段 */
  .data : { *(.data .data.*) } :data
  .bss  (NOLOAD) : { *(.bss .bss.*) *(COMMON) } :data

  /* 自定义 no-init 段（文件不占体积、运行期占内存） */
  .MY_NOINIT (NOLOAD) : ALIGN(32) {
    KEEP(*(.MY_NOINIT))
  } :data

  /* 丢弃不需要的节（减少噪音与潜在 orphan） */
  /DISCARD/ : { *(.comment) *(.note.GNU-stack) *(.debug*) }
}
````

---

## 段权限与装载：`PHDRS` 与 `:phdr` 绑定

* `PT_LOAD` 段的 `p_flags` 控制装载后内存页权限：

  * `text` 段：`FLAGS(0x5)` → RX（不可写）；
  * `data` 段：`FLAGS(0x6)` → RW（不可执行）。
* 在 `SECTIONS` 中用 `:text`/`:data` 明确把输出节挂到对应段，避免**把可写变量误放进 RX** 导致运行时写崩。

---

## 物理内存映射（嵌入式）：`MEMORY`、`>REGION`、`AT>`、`REGION_ALIAS`

嵌入式需要与芯片手册对齐地址窗口：

```ld
MEMORY {
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 2M
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 512K
}
REGION_ALIAS("ROM", FLASH)
REGION_ALIAS("RAM_RW", RAM)

PHDRS { text PT_LOAD FLAGS(0x5); data PT_LOAD FLAGS(0x6); }

SECTIONS {
  .text : { *(.isr_vector) *(.text*) *(.rodata*) } > ROM  :text

  /* .data 的镜像放在 ROM，运行地址在 RAM */
  .data : AT>ROM {
    _sdata = .; *(.data .data.*) _edata = .;
  } > RAM_RW :data
  _sidata = LOADADDR(.data);

  .bss (NOLOAD) : {
    _sbss = .; *(.bss .bss.*) *(COMMON) ; _ebss = .;
  } > RAM_RW :data

  .MY_NOINIT (NOLOAD) : ALIGN(32) { KEEP(*(.MY_NOINIT)) } > RAM_RW :data
}
```

* 烧录器根据 **LMA** 写入 FLASH；启动代码用 `_sidata/_sdata/_edata` 复制 `.data`，用 `_sbss/_ebss` 清零 `.bss`。
* `REGION_ALIAS` 让你只改一处就能把 “ROM” 从 FLASH 切到 ITCM/不同 Bank。

---

## 输入节选择与整理

* `*(.text .text.*)`：所有输入文件的 `.text` 与子节。
* `EXCLUDE_FILE(file.o) *(.rodata*)`：排除特定对象的输入节。
* `KEEP(*(.isr_vector))`：配合 `--gc-sections` 保留关键节。
* `/DISCARD/ : { *(.comment) *(.debug*) *(.note.GNU-stack) }`：丢弃无关节，减少 orphan 风险。
* `SORT_BY_NAME()` / `SORT_BY_ALIGNMENT()`：对输入节排序。

---

## 常用表达式

* `.`：位置计数器（location counter）。
* `ALIGN(n)`：地址对齐；`SUBALIGN(n)`：子节对齐。
* `SIZEOF(.sec)`、`ADDR(.sec)`、`LOADADDR(.sec)`：节的大小、VMA、LMA。
* `ORIGIN(RAM)`、`LENGTH(FLASH)`：取 `MEMORY` 中定义的参数。
* `DEFINED(sym)`：判断符号是否存在。

---

## 最小可跑示例（Linux）

**link.ld（精简）：**

```ld
OUTPUT_FORMAT("elf64-x86-64")
ENTRY(_start)
PHDRS { text PT_LOAD FILEHDR PHDRS FLAGS(0x5); data PT_LOAD FLAGS(0x6); }
SECTIONS {
  . = SIZEOF_HEADERS;
  .text : { *(.text .text.*) *(.rodata .rodata.*) } :text
  . = ALIGN(CONSTANT(MAXPAGESIZE));
  .data : { *(.data .data.*) } :data
  .bss (NOLOAD) : { *(.bss .bss.*) *(COMMON) } :data
  .MY_NOINIT (NOLOAD) : ALIGN(32) { KEEP(*(.MY_NOINIT)) } :data
  /DISCARD/ : { *(.comment) *(.note.GNU-stack) *(.debug*) }
}
```

**\_start（不依赖 libc，直接 syscall）：**

```c
__attribute__((section(".MY_NOINIT"))) volatile unsigned g_counter;
static inline long sys_write(int fd, const void* buf, unsigned long len){
  long r; __asm__ volatile("syscall": "=a"(r): "a"(1),"D"(fd),"S"(buf),"d"(len):"rcx","r11","memory"); return r;
}
__attribute__((noreturn)) static inline void sys_exit(int code){
  __asm__ volatile("syscall"::"a"(60),"D"(code):"rcx","r11","memory"); __builtin_unreachable();
}
__attribute__((noreturn)) void _start(void){
  g_counter = 0xDEADBEEF;
  const char msg[]="Hello ld!\n"; sys_write(1,msg,sizeof(msg)-1); sys_exit(0);
}
```

**验证：**

```bash
readelf -l a.out   # 两个 LOAD：一个 R E，一个 R W
readelf -S a.out   # .MY_NOINIT 为 NOBITS，绑定到 data 段
```

---

## 最小可跑示例（ARM/裸机）

* `MEMORY` 给出 FLASH/RAM；
* `.text > ROM`；
* `.data : AT>ROM > RAM`；
* `NOLOAD` 的 `.bss`、自定义 `.MY_NOINIT` 放 RAM；
* 启动代码复制 `.data`、清零 `.bss`。

---

## 孤儿节与错误复现

* 开启：`-Wl,--orphan-handling=error`，任何未被 `SECTIONS` 明确接纳的输入节都报错。
* 常见孤儿：`.note.gnu.property`、`.eh_frame*`、`.comment`、`.note.GNU-stack`、`.debug*` 等。解决：

  * 明确放入某输出节；或
  * `/DISCARD/` 丢弃；或
  * 通过编译/链接选项抑制生成（如 `-fno-asynchronous-unwind-tables`、`-Wl,--build-id=none`）。

---

## 调试与排错清单

1. **权限崩溃（写 RX）**：检查 `.data/.bss/自定义` 是否都挂到 `:data`（RW）。
2. **段跨界/对齐**：两个 PT\_LOAD 之间 `ALIGN(MAXPAGESIZE)`。
3. **镜像体积异常**：确认 `NOLOAD` 的段没有意外进了文件；检查 `AT>`/LMA。
4. **符号初始化异常**：核对 `_sidata/_sdata/_edata` 与启动代码。
5. **节被回收**：开了 `--gc-sections` 记得 `KEEP()`。
6. **孤儿节**：用 `--orphan-handling=error` 强制你补齐映射。
7. **工具核查**：`readelf -l/-S`、`objdump -h/-p`、map 文件。

---

## 最佳实践清单

* 明确两个（或三个）PT\_LOAD：RX（.text）、RO（可选 .rodata）、RW（.data/.bss/自定义）。
* 在 `SECTIONS` 中显式 `:text/:data` 绑定，禁止隐式划分。
* 嵌入式用 `MEMORY` 与 `AT>` 正确处理 FLASH/RAM 与 LMA/VMA。
* 需要 `--gc-sections` 时，对关键节使用 `KEEP()`。
* 用 `/DISCARD/` 清理无用节，降低 orphan 与体积噪音。
* 在两个 PT\_LOAD 之间做页对齐。
* 保留 map 文件并养成阅读习惯。

---

## 术语速查（glossary）

* **Section（节）**：链接单位，如 `.text/.data/.bss`。
* **Output section（输出节）**：脚本定义的目标节。
* **Program Header / Segment（程序头/段）**：加载器装载的页范围，含权限位。
* **PT\_LOAD**：可装载段类型。
* **PF\_R/PF\_W/PF\_X**：段权限位。
* **VMA/LMA**：运行地址/加载地址。
* **NOLOAD/NOBITS**：段不占文件体积。
* **KEEP**：阻止节在 `--gc-sections` 下被回收。
* **REGION\_ALIAS**：给 `MEMORY` 区起别名。

---

## 进一步阅读（官方入口）

* GNU ld 官方手册《Linker Scripts》章节：SECTIONS、MEMORY、PHDRS、表达式与内建函数等。
* ELF gABI：Program Header、p\_flags、PT\_\* 类型。
* Arm / Keil Scatter、IAR ICF：嵌入式平台的等价语法。

