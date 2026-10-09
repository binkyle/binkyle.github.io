---
title: 跨核不是缓存问题：从 AUTOSAR COM Deferred EventCache 看事件与状态一致性
icon: code
date: 2026-10-09
category:
  - Autosar
tag:
  - AUTOSAR
  - COM
  - 多核
  - 并发编程
  - TriCore
isOriginal: true
article: true
timeline: true
---

多核嵌入式开发里有一种容易产生误判的现象：**共享变量放在 NonCached RAM，读写都是简单赋值，两边也都进入了 SchM Exclusive Area，但事件队列和业务状态仍可能不一致。**

这里不需要先假设硬件缓存出错。更值得追问的是：

> **“事件已发布”与“事件对应的数据已就绪”，是不是同一个不可分割的状态转换？**

本文以 AUTOSAR Classic COM 的一种 **Deferred Rx + EventCache** 实现为例，借助一个可构造的双核交错，讨论缓存可见性、原子性、内存顺序与跨核互斥之间的区别，以及事件驱动系统该怎样维护状态不变量。

文中的代码是根据实际函数关系抽象的**示意性伪代码**，不是 AUTOSAR 对所有 COM 实现的统一规定。具体项目还应遵循所使用组件的多核部署和并发访问约束。

<!-- more -->

## 1. Deferred Rx：接收与处理为什么要分开？

对于一条 Rx I-PDU，通信栈可能采用如下链路：

```text
Core0 / 接收上下文
  CAN Rx → CanIf → PduR / SecOC → Com_RxIndication()
                                        │
                                        ├─ 将 PDU 编号加入 EventCache
                                        ├─ 将报文复制到 Deferred Buffer
                                        └─ 设置 Pending Length

Core3 / 周期任务
  Com_MainFunctionRx()
       │
       ├─ 从 EventCache 取出 PDU 编号
       ├─ 检查 PDU Active 与 Pending Length
       ├─ 解析信号并写入 COM Signal Buffer
       └─ 退出临界区后分发 Notification → RTE
```

Deferred 的目的不是逐帧保存所有历史报文，而是将接收上下文中的工作量控制住，再由周期任务完成更重的解析与通知。

这里实际存在**三个不同的对象**：

| 对象 | 保存什么 | 解决什么问题 |
|---|---|---|
| `EventCache` | 待处理的 RxPduId | **调度**：先处理谁 |
| `RxDefPduBuffer` | 最近接收的报文字节 | **数据**：处理什么 |
| `HandleRxPduDeferred` / Pending Length | 0 表示无待处理，非 0 表示有待处理数据（有些实现以长度 +1 编码） | **状态**：是否需要处理 |

**事件队列不是数据缓冲；Pending Length 也不是队列中事件数量。** 三者必须遵守同一套状态协议。

## 2. 先理解生产者的事件合并策略

下面是一个简化的生产者模型：

```c
void DeferredRx_OnIndication(PduId id, const PduInfo *pdu)
{
    if (GetPendingLength(id) == 0u)
    {
        (void)EventCache_Put(id);
    }

    CopyToDeferredBuffer(id, pdu->data, pdu->length);
    SetPendingLength(id, pdu->length + 1u);
}
```

它想实现的是**同一 PDU 的事件合并**：

```text
第 1 帧到达：Length=0 → Put(PDU_X) → 复制第 1 帧 → Length>0
第 2 帧到达：Length>0 → 不 Put   → 复制第 2 帧 → Length>0
第 3 帧到达：Length>0 → 不 Put   → 复制第 3 帧 → Length>0
```

消费者随后只处理这个 PDU 的最新缓冲内容。对于追求最新状态的周期性信号，这种合并能减少队列规模。

这套优化隐含着一个契约：

> 生产者因 `Length != 0` 而不再入队，是因为它相信“之前已经有一条有效的待处理事件”，或者消费者正在以可靠方式处理它。

一旦这个契约被破坏，单独修改 Length 或 EventCache 都可能导致后续状态失配。

## 3. 消费者先 Get，随后才决定是否处理

简化后的消费者逻辑：

```c
bool IterateOverCache(EventCache *queue)
{
    bool fallbackRequired = false;
    unsigned int readLimit = GetReadLimit(queue);

    while (EventCache_Get(queue, &id) == E_OK)
    {
        if (IsRxPduActive(id) && GetPendingLength(id) > 0u)
        {
            ProcessDeferredPdu(id);
        }

        --readLimit;
        if (EventCache_IsFull(queue) || readLimit == 0u)
        {
            EventCache_Flush(queue);
            fallbackRequired = true;
            break;
        }
    }
    return fallbackRequired;
}
```

`EventCache_Get()` 在取出一个 RxPduId 后推进环形队列的 `ReadIdx`：**出队先发生，Active / Length 判断后发生**。

因此：

- Get 成功，不等于 PDU 已被处理；
- Active 为 FALSE，事件已经出队，却可能没有处理数据；
- Length 为 0，同样可能跳过 `ProcessDeferredPdu()`；
- 对上述两种“取出但跳过”的情况，这段逻辑**不会自动重新入队**。

事件消费与数据消费并不是同一个操作。

## 4. 用演绎推理构造跨核提前消费反例

先明确前提，不假设 DCache 有任何故障：

1. 生产者在 Core0，消费者在 Core3。
2. 两核都可以访问同一块共享 RAM。
3. 生产者顺序为 `Put → Copy → SetLength`。
4. 消费者顺序为 `Get → CheckLength → Process`。
5. 两边没有跨核互斥机制阻止这两个调用链同时执行。

初始状态：

```text
EventCache = 空
PendingLength[PDU_X] = 0
Active[PDU_X] = TRUE
```

构造如下执行序列：

| 时刻 | Core0：生产者 | Core3：消费者 |
|---|---|---|
| T1 | 检查 Length == 0 | — |
| T2 | `EventCache_Put(PDU_X)`，发布事件 | — |
| T3 | 尚未复制数据 | `EventCache_Get(PDU_X)`，事件出队 |
| T4 | — | 读取 Length == 0，因此跳过处理 |
| T5 | 复制新帧到 Deferred Buffer | — |
| T6 | `SetLength(PDU_X, N+1)` | — |

T6 结束后：

```text
EventCache 不含 PDU_X
PendingLength[PDU_X] > 0
消费者不在处理 PDU_X
```

这是一个**稳定状态下的事件—状态不一致**。

为什么它可能持续存在？下一帧的生产者仍按 `Length == 0` 决定是否 Put。由于 Length 已非零，生产者只覆盖缓冲和更新 Length，不再插入事件；消费者下一周期如果只查空 EventCache，也不会主动检查此 PDU。

这不是死锁，而是**工作已经准备好，却失去了被调度的依据**。队列和 Pending 状态各自看起来合法，组合起来却违背了设计意图。

注意这个证明的边界：它证明在上述前提下**存在一种可行交错**，不等于断言任意 ECU、任意 COM 版本都必然发生此交错。

## 5. 为什么 SchM Exclusive Area 没有挡住它？

容易误解的代码形式是：

```c
SchM_Enter_Com_COM_EXCLUSIVE_AREA_RX();
/* 操作共享状态 */
SchM_Exit_Com_COM_EXCLUSIVE_AREA_RX();
```

“双方进入了同名 Exclusive Area”并不能直接推出“双核互斥”。

必须继续检查 SchM 的实现。如果它被映射成：

```c
#define SchM_Enter_Com_COM_EXCLUSIVE_AREA_RX() SuspendAllInterrupts()
#define SchM_Exit_Com_COM_EXCLUSIVE_AREA_RX()  ResumeAllInterrupts()
```

那么它屏蔽的是**调用者所在 Core 的中断**。Core0 执行这段代码时，Core3 依然可以运行自己的任务和临界区。

AUTOSAR OS 对此有明确要求：`SuspendAllInterrupts` 只作用于调用核（`SWS_Os_00592`）。

```text
Core0                              Core3
SuspendAllInterrupts()             SuspendAllInterrupts()
  └─ 本核不被相关中断抢占          └─ 本核不被相关中断抢占

                  但两核仍可并行访问同一状态
```

**关本核中断是核内临界区，不自动等价于跨核锁。**

当然，`SchM_Enter_*` 的最终语义取决于具体生成配置：它也可能结合 OS Resource、Spinlock 或其他同步方法。不能只从宏名判断是否跨核安全。

## 6. NonCached、可见性、原子性和互斥是四个问题

以 AURIX TC3xx 为例，LMU 可以通过 cached / non-cached 地址窗口访问。把共享对象放入 NonCached LMU，有助于避免多个核各自保存陈旧 DCache 副本的问题。

但这并不会让多个操作变成一个事务：

| 维度 | 关注的问题 | NonCached 是否足够？ |
|---|---|---|
| 缓存可见性 | 是否读到旧 DCache 副本 | 有助于排除这类问题 |
| 单次访问原子性 | 单个对齐数据对象是否会撕裂 | 取决于访问宽度、指令及硬件，不由 NonCached 单独保证 |
| 内存顺序 | 数据写与“已发布”标志的先后是否受到约束 | 仍需满足平台的内存顺序要求 |
| 跨核互斥 | 多步状态转换能否被另一个核插入 | **不能**，需要额外同步或协议设计 |

更重要的是，**即使每次读写都严格按源码顺序执行，上面的反例也仍然成立**：Core3 不是在 Core0 写完 Length 后读到了旧值，而是在 Core0 **尚未写 Length 时**真实地读到了 0。

`DSYNC` 等同步屏障可以用于满足平台特定的数据访问完成顺序要求，但**不能让 `Put → Copy → SetLength` 自动成为不可分割的临界区**。

不要把三个不同结论混为一谈：

- 数据对其他核可见；
- 数据访问的先后顺序得到保证；
- 其他核无法在一组操作之间插入。

第三个要求，必须通过跨核互斥或精心设计的无锁协议满足。

## 7. 第二个窗口：消费者提前清零，再读取共享缓冲

再看一个典型的 Deferred 消费模型：

```c
void ProcessDeferredPdu(PduId id)
{
    size_t len = GetPendingLength(id) - 1u;
    const uint8_t *ptr = GetDeferredBufferAddress(id);

    ResetPendingLength(id);  /* 数据尚未解析 */
    ParsePdu(ptr, len);      /* 仍在读取共享 Buffer */
}
```

可能出现：

```text
Core3：Get(PDU_X)，Length > 0
Core3：记录 Buffer 指针与长度
Core3：ResetLength(PDU_X) = 0

Core0：新帧到达，读到 Length == 0
Core0：Put(PDU_X)
Core0：覆盖同一 Deferred Buffer

Core3：继续用原指针解析 Buffer
```

此时 Core3 读取的内容可能已经改变。如果拷贝与解析发生交叠，还可能观察到不完整的一帧。

这个问题与第 4 节并不相同：

| 竞争窗口 | 主要风险 |
|---|---|
| `Put` 后、`SetLength` 前被提前 `Get` | 事件丢失，Pending 变为孤儿状态 |
| `ResetLength` 后、`ParsePdu` 完成前被覆盖 Buffer | 数据生命周期冲突，解析内容可能不一致 |

前者破坏**调度状态**，后者破坏**数据所有权**。两者都可以在完全正常的共享 RAM 上发生。

## 8. EventCache 满时，为什么要 Full Scan？

很多事件队列采用“事件缓存优先，容量不足时全量扫描”的回退机制：

```text
EventCache 可用且未满
       └─ Get 已记录事件 → 检查 Active/Length → 处理

EventCache 未启用或判定容量不足
       └─ 扫描当前 MainFunction 管辖的所有 Rx PDU
          → 检查 Active/Length → 处理
```

Full Scan 并不需要“事件仍在队列里”，因此理论上能处理一部分“Length 非零、但入队失败”的情况。

但要注意三个边界：

1. **队列为空不代表需要 Full Scan。** 如果缓存迭代正常返回 FALSE，外层可能不扫描任何其他 PDU。
2. **`Put()` 失败也不代表本轮必然扫描。** 生产者尝试 Put 与消费者判断 Full 可能发生在不同时间。
3. **Full Scan 不一定清空 EventCache。** 是否 Flush 取决于具体实现，不能把扫描与队列复位当作同一件事。

因此，Full Scan 是处理策略，不等于一个能够自动修补所有状态失配的通用一致性机制。

## 9. 更形式化地表达：维护哪些状态不变量？

将某个 PDU 的状态抽象为：

- `L`：Pending Length 是否非零；
- `Q`：队列中是否存在该 PDU 的未消费事件；
- `C`：消费者是否已经取得事件且正负责处理；
- `W`：生产者是否正处于尚未完成发布的临时阶段。

在**没有操作进行中的稳定状态**，期望至少满足：

> `L > 0` 时，必须存在可信的后续处理依据：未消费事件、正在处理的消费者，或明确的全量扫描义务。

与此同时，还应满足：

> 消费者读取 Deferred Buffer 期间，生产者不能无约束地覆盖这块尚未释放所有权的数据。

第 4 节反例的最终状态是 `L > 0、Q = 0、C = 0`，又没有可保证执行的扫描路径；第 7 节则是消费者还在读时，生产者就获得了写入机会。

可以用**可线性化的状态转换**思考设计：发布一个待处理单元时，其他核看到的应该是“数据与调度状态共同有效”的结果，而不应先看到一个尚未具备数据的事件。

不过要特别强调：这要求设计**完整的发布/消费协议**；单纯把 `Put` 和 `SetLength` 的顺序交换，并不自动解决重复入队、覆盖数据和并发重置等问题。

## 10. 怎样从架构上解决？

这里不直接给出“加一把锁就万事大吉”的答案。不同方案的实时性成本不同。

### 10.1 方案 A：为相关状态转换建立真正的跨核互斥

让生产与消费在同一同步协议下修改队列、Pending 和缓冲所有权，必要时使用 AUTOSAR OS Spinlock 等平台允许的跨核同步原语。

优势是状态机容易理解与审计；代价是增加跨核等待、最坏执行时间和 ISR 上下文限制。尤其不要在高频接收 ISR 内持锁执行过长的复制与复杂处理。

**互斥边界必须覆盖完整状态转换**，不是只在 `Put()` 或 `Get()` 内分别加锁。

### 10.2 方案 B：将同一条 Deferred 状态机约束在一个 Core

接收侧通过适当的跨核通知、消息传递或 IOC，将完整输入交给指定 Core，由该 Core 独占修改 Deferred 队列、Pending 和缓冲状态。

优点是状态所有权清晰；需要权衡跨核传输、额外复制、任务调度延迟，以及原始 Rx 回调的任务/分区配置要求。

这不是简单地修改一个 MainFunction 的 Core 号。必须保证**对同一共享状态的其他写者**（例如 Group Start/Stop）也服从同一所有权规则。

### 10.3 方案 C：显式的 READY / CONSUMING 协议

更精细的设计可将“无数据”“正在写”“可消费”“正在消费”拆为不同状态，并以平台支持的原子操作、发布/获取顺序以及双缓冲或队列所有权来协调：

```text
EMPTY → WRITING → READY → CONSUMING → EMPTY
          │          │           │
       写入数据     发布完成     消费者取得所有权
```

消费者只能获取 `READY` 数据；生产者不得覆盖 `CONSUMING` 的缓冲。状态提交与队列发布必须在一个经过证明的协议中配合。

这类设计可以减少长时间跨核持锁，但实现与验证成本更高。必须明确单生产者/多生产者、重复帧合并、满队列和 Group 重置语义。

### 10.4 方案 D：把 EventCache 看作优化，而不是唯一的正确性依据

可以考虑让系统具备明确的补偿机制：如果事件登记失败，就记录待扫描状态；或周期性扫描 Pending，但必须解决队列事件与 Pending 标志可能重复消费、覆盖共享数据等问题。

**“定期扫一遍”可以改善可恢复性，却不能代替跨核状态同步。**

## 11. 设计评审中值得问的七个问题

1. `SchM_Enter_*` 最终映射到关中断、Resource、Spinlock，还是其他机制？是否真正跨核互斥？
2. 谁是 EventCache、Pending Length 和 Buffer 的唯一写者？是否还存在 Group Start/Stop 等额外写入路径？
3. EventCache `Put` 成功时，消费者看到的数据是否已经完整就绪？
4. `Get` 出队后，若 Active/Length 不满足条件，事件由谁负责补偿？
5. 消费者什么时候释放 Buffer 所有权？`ResetLength` 是否早于最后一次读取？
6. EventCache 满、Put 失败、Full Scan 触发及 Flush 的条件是否构成完整的恢复协议？
7. 共享数据的地址窗口、访问宽度、编译器优化与同步原语是否符合当前平台的多核使用约束？

这七个问题比简单检查“有没有 volatile”“是不是 NonCached”“是否进入了 SchM”更接近问题本质。

## 12. 总结：可见不等于一致，一致不等于互斥

这类问题可以浓缩为一个反例：

```text
Core0：发布事件 ─────────────── 写入数据并设置 Pending
                       ▲
Core3：           提前消费事件，读到 Pending=0
                       │
                       └─ 事件被移除，后续数据失去处理依据
```

逻辑结论很明确：

- **NonCached** 解决的是一类缓存访问问题，不是事务原子性。
- **SuspendAllInterrupts** 保护本核，不自动保护其他核。
- **EventCache** 负责调度，不自动保证数据已经完成发布。
- **Pending Length** 表示业务状态，不自动证明队列仍存在有效事件。
- **跨核正确性** 必须建立在可证明的状态协议、同步边界和数据所有权之上。

最值得记住的一句话是：

> **在并发系统里，“通知已经发出”不等于“被通知的数据已经准备好”。只有两者的关系得到同步协议保证，事件驱动才真正可靠。**

---

## 参考资料

- [AUTOSAR Classic Platform — Specification of Operating System（SWS_OS，`7.9.10，SWS_Os_00592）](https://www.autosar.org/fileadmin/standards/R21-11/CP/AUTOSAR_SWS_OS.pdf)：`SuspendAllInterrupts` 的作用核范围与多核 OS 语义。
- [Infineon — AURIX TC3xx Local Memory Unit（LMU）](https://documentation.infineon.com/aurixtc3xx/docs/dqx1703075640758)：LMU 的 cached / non-cached 访问机制。
