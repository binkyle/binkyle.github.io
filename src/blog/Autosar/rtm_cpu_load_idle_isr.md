---
title: 嵌入式 CPU Load 是如何计算的：从 Idle Task 到 ISR 抢占
icon: code
date: 2026-10-09T10:00:27Z
description: 用具体时间线解释 Idle、Task 与 ISR 的归属，分析任务 Hook、中断嵌套、STM 回绕和统计窗口对 CPU Load 的影响。
category:
  - Autosar
tag:
  - Runtime Measurement
  - CPU Load
  - ISR
  - RTOS
  - TC397
isOriginal: true
article: true
timeline: true
---

假设一个核在 100 ms 内执行了 20 ms 普通任务、70 ms Idle 和 10 ms 中断。CPU Load 应该是 **30%**。但如果测量程序只在 Task Hook 中记录 Idle 的开始与结束，就可能把中断的 10 ms 也记成空闲，最后显示 **20%**。

公式没有错，错在“这段时间到底属于谁”。这也是嵌入式运行时测量最值得先弄清楚的问题。

本文是[嵌入式 Runtime Measurement 专题](./rtm_runtime_measurement_series.md)的原理篇。后续分别介绍[通用核心设计](./rtm_framework_architecture.md)和[TC397/AUTOSAR 适配方法](./rtm_tc397_autosar_practice.md)。

<!-- more -->

## 1. CPU Load 先有口径，再有公式

常用定义是：

`CPU Load = (统计总时间 − Idle 时间) / 统计总时间 × 100%`

它描述一个核有多少时间没有处于所定义的 Idle 状态。它不直接等于业务函数的累计时间，更不表示某个任务“有多复杂”。

要把这个量算清楚，需要区分以下对象：

| 对象 | 含义 | 能否直接相加？ |
|---|---|---|
| Idle | 核正在执行空闲路径的时间 | 可与互斥 CPU 分类相加 |
| Task exclusive | 普通任务实际拥有 CPU 的时间，扣除中断抢占 | 可与互斥分类相加 |
| ISR exclusive | ISR 本身运行的时间，扣除更深层中断 | 可与互斥分类相加 |
| Kernel gap | 已被插桩识别的调度空档 | 需先确认与其他分类不重叠 |
| 函数 inclusive | 函数所属上下文执行的时间，包含嵌套函数 | 与 Task/ISR 重叠 |
| Hook/测量开销 | 读时钟、更新状态等自身成本 | 默认通常落在边界相邻分类里 |

完整模拟事件流可以建立 `Total = Idle + Task + ISR + Kernel`。真实硬件若遗漏了某类中断，程序仍可能保持这个等式，却把遗漏中断记进 Idle。**等式成立证明算法内部守恒，不能单独证明插桩覆盖完整。**

## 2. Idle 为什么不需要周期激活？

在一般 RTOS 调度模型中，当没有可运行的普通任务时，核进入 Idle 执行路径；有就绪任务时，调度器选中它。Idle 是持续可用的执行背景，而不是“每隔一段时间激活一次才能统计空闲”的普通业务任务。

因此，核可能长时间停留在 Idle，只被中断短暂打断。如果统计程序只等待下一次 Idle 的任务切换才结算，就容易延迟得到空闲时间。

在具体 AUTOSAR OS 中，还要确认 Idle 是怎样实现的、是否经过应用的 Pre/PostTaskHook，以及每个核是否有独立 Idle 上下文。供应商内部 Idle 不能仅凭名称或假定的 Task ID 直接接入数组。

## 3. Task Hook 记录的是哪种边界？

可以把一对任务边界抽象为：

```c
/* 示意：具体 Hook 签名与合法调用以 OS 版本为准。 */
on_task_dispatch(task_id, now);
/* Task 执行；可能被抢占、阻塞或终止。 */
on_task_leave(task_id, now);
```

PreTaskHook/PostTaskHook 可以帮助识别任务执行区间。任务恢复执行时，重新记录当前片段的起点；被抢占之前已经执行的部分保留在自己的累计量中。

但一次 Task Activation 可以包含多次恢复、切换和中断。**Hook 次数、执行片段数、任务激活次数、Runnable 调用次数是不同计数。** 对 Extended Task，只有 `WaitEvent` 真正进入等待并让出执行权时，才形成对应执行切换；不能把每次 API 调用都算成一次离开任务。

还有一个关键边界：Task Hook 不能自动代替 ISR 入口/出口观测。若 ISR 进入后返回原任务，底层是否触发任务 Hook、怎样进入 OS 包装层，需要核查实际实现。

## 4. ISR 抢占 Idle，误差怎样出现？

考虑这个 100 ms 窗口：

| 时间 | 真正执行者 |
|---|---|
| 0–20 ms | Task |
| 20–50 ms | Idle |
| 50–60 ms | ISR |
| 60–100 ms | Idle |

正确结果：Idle=70 ms，Busy=20+10=30 ms，所以 Load=30%。

如果 Idle 的开始是 20 ms，直到 100 ms 才直接执行 `idle += end - begin`，且期间没有扣除中断，那么 Idle 会变成 80 ms，Load 就只有 20%。这是 **少计 10 个百分点**，不是“相对误差 10%”。

修正思路是在 ISR 入口结束当前 Idle 片段，ISR 出口再恢复 Idle。若中断唤醒了一个普通任务，则在实际调度边界转入那个任务；不能一直按“中断一定回原任务”计算。

## 5. 中断嵌套不能只保存一个开始时间

![嵌套中断的真实 CPU 时间线与不同归属](/assets/rtm/rtm_idle_isr_timeline.svg)

图中的核先 Idle，再执行 A，A 被 B 抢占后恢复，最终回 Idle：

| 指标 | 计算 | 结果 |
|---|---|---:|
| A inclusive | 50−10 | 40 ms |
| A exclusive | (20−10)+(50−30) | 30 ms |
| B exclusive/inclusive | 30−20 | 10 ms |
| 物理 ISR 时间 | 30+10 | 40 ms |

把 A inclusive 与 B inclusive 相加会得到 50 ms，重复计算了 B 的 10 ms。正确做法是让每个核保存活动 ISR 栈：exclusive 只累计栈顶，inclusive 累计到所有活动帧。

同样，普通 Task 被 ISR 抢占后，其 exclusive 时间必须暂停。给每层保存独立状态比用一个全局 `isr_start` 更可靠；只打开某个抢占处理宏，也不能证明索引、嵌套、窗口和插桩边界全部正确。

## 6. 窗口边界要主动结算

假设 Idle 一直运行到 250 ms，窗口长 100 ms。正确输出应是两个完整的 100 ms Idle 窗口，以及第三个 50 ms 的部分窗口。

![没有任务切换时，周期采样仍然结算固定窗口](/assets/rtm/rtm_window_boundaries.svg)

窗口不能等待下一次 Task 切换才结束。周期 poll 或 snapshot 应将“当前还在运行的上下文”累计到边界，然后继续同一执行状态。跨窗口不等于结束 Task/ISR 调用，所以 max/min/调用次数也不能随窗口切分而增加。

长窗口还隐藏了另一个条件：**统计窗口长度不等于硬件计时器可安全不采样的时间。**

例如只读 32 位计数器，假设它以 100 MHz 递增，完整回绕约 42.95 秒。一个 60 秒窗口不能简单只读头尾两次；应该在更短间隔采样，按无符号模减累计到 64 位总量。本专题的核心要求实际采样间隔小于半回绕范围，并由 port 保证。漏掉整个回绕再只剩很短差值时，两个低位样本本身不能检测这种混叠。

100 MHz 只是数值假设，实际 STM 频率要从工程配置确认，不能直接用 CPU 主频代替。

## 7. 一个可以直接运行的验证

本专题源码归档里的 `examples/basic.c` 提供 Task 20 + Idle 70 + ISR 10 的事件流。运行：

```sh
make test
./build/basic
```

实际输出：

```text
Task=20 Idle=70 ISR=10 Total=100 Load=30.0%
```

这是完整覆盖的 Host 模型，不能直接作为真实 ECU 的性能结果。移植时，需要先证明 Task、Idle、ISR、调度空档和时间源的边界，再相信显示出来的百分比。

源码与后续文章入口见[专题页](./rtm_runtime_measurement_series.md)。相关官方资料包括 [AUTOSAR OS 规范](https://www.autosar.org/fileadmin/standards/R22-11/CP/AUTOSAR_SWS_OS.pdf)、[Infineon TC3xx 手册入口](https://documentation.infineon.com/aurixtc3xx/docs/qmd1702366622648)；具体工程仍以其使用版本和配置为准。
