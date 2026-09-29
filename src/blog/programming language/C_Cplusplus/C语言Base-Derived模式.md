---
title: C语言中的Base/Derived模式：用结构体组合实现继承、类型擦除与受控向下转型
icon: code
order: 8
date: 2026-09-29
category:
  - 编程语言
tag:
  - C语言
  - 嵌入式
  - 设计模式
  - AUTOSAR
isOriginal: true
article: true
timeline: true
---

C 语言没有 C++ 那样的 class、继承和虚函数，但在操作系统、驱动、AUTOSAR、Linux 内核等底层软件中，经常可以看到一种很成熟的写法：

> 把“基类结构体”嵌入“派生结构体”，再通过基类指针复用公共逻辑；需要具体能力时，再受控地恢复为派生类型。

这种模式可以理解为 **C 语言中的组合式继承（struct embedding）+ 类型擦除（type erasure）+ 运行时类型恢复**。

<!-- more -->

## 1. 最小模型

先看一个最简单的例子：

```c
typedef enum
{
    OBJ_SPINLOCK,
    OBJ_RESOURCE
} ObjectType;

typedef struct
{
    ObjectType type;
} BaseConfig;

typedef struct
{
    BaseConfig base;
    unsigned int order;
} SpinlockConfig;

typedef struct
{
    BaseConfig base;
    unsigned int ceiling;
} ResourceConfig;
```

这里：

```text
BaseConfig
    ▲
    │ 作为成员嵌入
    │
SpinlockConfig

BaseConfig
    ▲
    │
ResourceConfig
```

并不是 C++ 语法意义上的继承，但从设计目的上，它已经具备了继承的几个核心效果：

- 公共字段只定义一次；
- 公共算法只面向 Base 类型；
- Spinlock / Resource 可以保留各自特有字段；
- 必要时可以根据类型标签重新识别具体对象。

---

## 2. 为什么基类通常放在第一个成员

很多底层代码会刻意写成：

```c
typedef struct
{
    BaseConfig base;     /* offset 0 */
    unsigned int order;
} SpinlockConfig;
```

内存布局可以理解成：

```text
SpinlockConfig
+0x00  BaseConfig base
+0x04  order
...
```

这样一来：

```c
SpinlockConfig spin;
BaseConfig *base = &spin.base;
```

此时 `base` 指向派生对象开头。

### 需要区分两种操作

第一种：

```c
&spin.base
```

只是“取成员地址”，即使 `base` 不是第一个成员也完全合法。

第二种：

```c
SpinlockConfig *spin2 = (SpinlockConfig *)base;
```

这一步要想直接成立，就要求：

1. `base` 确实来自某个 `SpinlockConfig.base`；
2. `base` 位于派生对象 offset 0。

所以：

> **首成员布局最重要的价值，不是向上取基类地址，而是让基类指针可以零成本恢复成完整派生对象地址。**

如果基类不是首成员，就应该使用类似 Linux `container_of()` 的做法，根据 `offsetof()` 反推出外层对象，而不能直接强转。

---

## 3. 第一阶段：编译期搭桥

实际大型嵌入式软件往往不是只有一个结构体，而是进一步拆成：

```text
静态配置（ROM）
+
动态状态（RAM）
```

例如：

```c
typedef struct BaseStateTag BaseState;
typedef struct BaseConfigTag BaseConfig;

struct BaseStateTag
{
    const BaseConfig *next;
};

struct BaseConfigTag
{
    BaseState *dyn;
    ObjectType type;
};

typedef struct
{
    BaseState base;
    volatile unsigned int hw_lock;
} SpinlockState;

typedef struct
{
    BaseConfig base;
    unsigned int order;
} SpinlockConfig;
```

这里形成两套平行关系：

```text
配置对象：
SpinlockConfig
      ↓
BaseConfig

动态对象：
SpinlockState
      ↓
BaseState
```

然后通过静态初始化把它们连接：

```c
static SpinlockState g_spinlock_state;

static const SpinlockConfig g_spinlock_cfg =
{
    .base =
    {
        .dyn  = &g_spinlock_state.base,
        .type = OBJ_SPINLOCK
    },
    .order = 1
};
```

关键是：

```c
.dyn = &g_spinlock_state.base
```

这一步把一个完整的 `SpinlockState` 动态对象，以 `BaseState *` 的视角登记进公共配置。

它不是运行时发生的“神秘强转”，而是：

> **在静态初始化阶段建立“具体对象 → 公共基类视图”的关联，并由编译器/链接器固化。**

---

## 4. 第二阶段：运行时向上使用

假设系统有一个通用的锁管理接口：

```c
void LockListPush(BaseConfig **head, BaseConfig *lock);
void LockListPop(BaseConfig **head);
```

Spinlock 进入公共锁框架时，可以直接：

```c
LockListPush(&thread->locks, &spinlock->base);
```

这里发生的是：

```text
SpinlockConfig *
      ↓
&spinlock->base
      ↓
BaseConfig *
```

从设计语义上，这就是 **upcast（向上转型）**。

但实现上没有做危险的裸指针转换，而只是正常取得嵌入成员地址。

进入公共层之后，公共代码只知道：

```text
这是一个 BaseConfig
```

它不需要知道对象到底是：

```text
Spinlock
Resource
Mutex
Semaphore
...
```

这就是 **类型擦除**。

---

## 5. 类型擦除带来的代码复用

如果没有 Base 抽象，很容易写出：

```text
SpinlockListPush()
SpinlockListPop()

ResourceListPush()
ResourceListPop()

MutexListPush()
MutexListPop()
```

但这些对象往往都有大量相同行为：

- 是否已被占用；
- 是否已经挂入线程持锁链；
- 入栈；
- 出栈；
- 检查是否位于栈顶；
- 访问权限检查。

于是把这些能力放到 Base 层：

```text
Spinlock ─┐
Resource ─┼──→ Base Lock Framework
Mutex ────┘
```

公共算法只实现一次。

这正是这种模式在 OS 内核中非常常见的原因。

---

## 6. 第三阶段：从 Base 恢复 Derived

公共代码能处理 Base，但某些操作必须访问具体类型字段。

例如只有 Spinlock 才有：

```c
volatile unsigned int hw_lock;
unsigned int previous_priority;
```

此时需要从：

```text
BaseState *
```

恢复：

```text
SpinlockState *
```

如果 `BaseState` 是 `SpinlockState` 的第一个成员，并且当前指针确实来自该对象，那么可以：

```c
static SpinlockState *SpinlockGetState(const SpinlockConfig *cfg)
{
    BaseState *base = cfg->base.dyn;
    return (SpinlockState *)base;
}
```

这就是 **downcast（向下转型）**。

但与向上转不同，向下转天然更危险，因为 Base 指针可能实际来自别的派生类型。

因此它需要一个可靠前提：

```text
这个 Base 指针实际对应的对象确实是 SpinlockState。
```

大型框架通常用几种方式保证这一点：

- 函数参数本身已经是强类型的 `SpinlockConfig *`；
- 静态配置由生成器建立，不允许任意拼装；
- Base 中保留 `type` 标签；
- 通用代码在必要时检查 `type == OBJ_SPINLOCK`；
- 对这种结构体指针转换做明确的 MISRA 偏离说明。

---

## 7. Type 字段其实是一个轻量 RTTI

如果类型信息已经被擦除，例如线程链表中只保存：

```c
BaseConfig *
```

那么系统怎样知道节点实际上是什么？

最简单的方法就是在 Base 中留下：

```c
ObjectType type;
```

例如：

```c
if (lock->type == OBJ_SPINLOCK)
{
    ...
}
```

它可以理解成一种非常轻量的运行时类型信息：

```text
C++ RTTI 的简化版
或者
tagged object
```

它没有 C++ RTTI 的完整能力，但对嵌入式系统已经足够，而且运行时成本极低。

---

## 8. 为什么经常同时出现 Config / Dyn 二分

AUTOSAR OS、驱动和很多嵌入式框架还会进一步把对象拆成：

```text
Config
+
Dyn
```

例如：

```text
SpinlockConfig（ROM）
├── 权限
├── 类型
├── 顺序
├── 模式
└── Dyn ──────────────┐
                       ▼
SpinlockState（RAM）
├── 当前 owner
├── 链表 Next
├── 硬件锁字
└── 临时运行状态
```

原因很直接：

### Config 是“规则”

它通常：

- 初始化后不变化；
- 可以声明为 `const`；
- 放 ROM / Flash；
- 多个运行路径只读共享。

### Dyn 是“事实”

它表示：

- 当前锁有没有被占用；
- 当前 owner 是谁；
- 当前链表关系；
- 当前硬件锁值；
- 当前优先级快照。

这些数据必须放 RAM。

因此：

> **Base/Derived 解决“抽象与复用”，Config/Dyn 解决“常量规则与运行状态分离”。**

两种设计经常叠加出现。

---

## 9. 与侵入式链表结合

这套 Base/Derived 模式特别适合侵入式链表。

例如：

```c
struct BaseStateTag
{
    const BaseConfig *next;
};
```

每个派生对象内部自带链表节点：

```text
SpinlockState
└── BaseState
    └── next
```

于是无需额外分配：

```text
ListNode
```

直接把业务对象挂入链表。

典型优势：

- 无动态内存；
- 无额外 node；
- O(1) 插入/删除；
- 内存布局固定；
- WCET 更容易分析；
- 很适合 RTOS / AUTOSAR / 安全实时系统。

---

## 10. 一个典型的完整链路

可以把整个过程压缩为：

```text
             编译期 / 静态初始化

SpinlockState
      │
      │ &state.base
      ▼
 BaseState *
      │
      │ 写入
      ▼
SpinlockConfig.base.dyn


             运行时 / 向上使用

SpinlockConfig *
      │
      │ &cfg->base
      ▼
 BaseConfig *
      │
      ▼
通用 Lock API
      │
      ▼
侵入式持锁链


             需要具体能力时

BaseConfig *
      │
      │ dyn
      ▼
 BaseState *
      │
      │ 受控 downcast
      ▼
SpinlockState *
      │
      ▼
访问硬件锁字 / owner / priority
```

这就是：

> **编译期搭桥 → 运行时向上擦除类型 → 公共代码复用 → 必要时恢复具体类型。**

---

## 11. 这种模式适合哪些场景

### 场景一：操作系统内核对象

例如：

```text
Lock
├── Spinlock
├── Resource
└── Mutex
```

公共层负责：

- ownership；
- LIFO；
- access check；
- object lifecycle。

派生层负责具体同步机制。

### 场景二：驱动框架

例如：

```text
Device
├── CanDevice
├── EthDevice
└── UartDevice
```

公共层提供：

```c
Device *dev;
```

统一管理设备，而具体驱动继续拥有寄存器、DMA、队列等专属状态。

### 场景三：协议栈对象

例如：

```text
Connection
├── TcpConnection
├── UdpEndpoint
└── SomeIpSession
```

调度器只认公共连接对象，具体协议处理再恢复派生类型。

### 场景四：状态机

公共对象包含：

```text
state
id
next
callback
```

不同状态机对象嵌入公共头部，共享统一调度框架。

### 场景五：对象池

内存池可以统一保存：

```c
BaseObject *
```

不同模块从池中取得对象后，再根据 type/tag 进入各自逻辑。

### 场景六：事件系统 / 消息框架

所有事件拥有统一头：

```text
EventBase
├── type
├── timestamp
└── source
```

具体事件继续扩展 payload。

这类模式尤其适合：

> 对象种类较多，但生命周期、链表管理、权限管理、调度逻辑有大量共性的软件框架。

---

## 12. 什么时候不要用

这种模式虽然高效，但也有明显风险。

如果项目只是：

```text
两个简单结构体
+
没有公共算法
```

就没必要为了“像面向对象”而引入 Base/Derived。

尤其当出现：

- 多层继承；
- 大量裸强转；
- 类型标签到处分支；
- 派生类型关系经常变化；
- Base/Derived ABI 约束没人维护；

代码会迅速变得难以理解。

此时 C++ 的真正继承、多态，或者更直接的函数指针接口，往往更合适。

---

## 13. 几个必须遵守的工程规则

这类代码最容易出问题的是 downcast，因此至少应遵守以下约束：

1. **优先使用 `&derived.base` 向上投影，而不是直接裸强转。**
2. **如果要直接 `Base * → Derived *`，Base 应固定为首成员。**
3. **Base 指针必须确实来源于目标 Derived 对象。**
4. **需要混合类型时保留明确的 type/tag。**
5. **结构体布局属于 ABI 约束，不要随意调整成员顺序。**
6. **非首成员恢复外层对象时使用 `container_of/offsetof` 思路，而不是直接 cast。**
7. **安全项目中应对结构体指针转换建立明确的 MISRA 偏离依据。**

---

## 14. 与 C++ 继承的区别

二者虽然思想相似，但机制完全不同：

| C Base/Derived | C++ 继承 |
|---|---|
| 结构体成员嵌入 | 语言原生继承 |
| 手动向上取成员 | 编译器自动 upcast |
| 手动 downcast | static_cast / dynamic_cast |
| type enum 自己维护 | RTTI 可由语言提供 |
| 函数指针模拟虚函数 | virtual |
| ABI 约束人工维护 | 编译器负责对象模型 |
| 极低运行时成本 | 能力更丰富 |

因此不要把它理解成“C 也有真正的继承”。

更准确地说：

> **这是利用结构体布局和指针规则，在 C 中人为构造出一种继承式的软件架构。**

---

## 15. 总结

C 的 Base/Derived 模式真正解决的不是“模仿 C++”，而是底层软件里一个很实际的问题：

> **怎样让多种不同对象复用同一套公共基础设施，同时保持固定内存、低运行时开销和可预测行为。**

它通常由四个机制组成：

```text
结构体嵌入
    ↓
Base / Derived

静态初始化
    ↓
Config → Dyn 搭桥

&derived.base
    ↓
向上投影 + 类型擦除

Base * → Derived *
    ↓
受控向下恢复
```

再配合：

```text
type tag
侵入式链表
Config / Dyn 分离
静态内存
MISRA 约束
```

就形成了一套非常适合 RTOS、AUTOSAR、驱动和协议栈的“C 风格对象模型”。

::: tip
阅读这类底层源码时，可以优先找四个东西：**Base 成员是否位于 offset 0、Config 中是否保存 Dyn 基类指针、公共 API 是否只接受 Base、哪里存在 Base→Derived 的反向恢复。** 找到这四处，整个对象模型通常就能快速还原出来。
:::
