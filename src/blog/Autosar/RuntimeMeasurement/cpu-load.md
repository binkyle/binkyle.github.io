---
title: 嵌入式 CPU 负载测量：Task、Idle 与 ISR
icon: code
date: 2026-10-09T10:00:27Z
description: 以每核执行时间为主线，建立 Task、Idle、ISR 与调度空档的统一模型，说明中断嵌套、固定窗口和 CPU Load 的计算方法。
category:
  - Autosar
tag:
  - Runtime Measurement
  - CPU Load
  - ISR
  - RTOS
  - TC397
isOriginal: true
order: 1
redirectFrom:
  - /blog/Autosar/rtm_cpu_load_idle_isr.html
---

CPU 负载描述一个核在统计窗口内用于执行工作的时间比例。把任务调度与中断处理放到同一条时间线上，就能同时解释负载百分比、任务占用和 ISR 开销。

以 100 ms 为例：Task 执行 20 ms，ISR 执行 10 ms，Idle 执行 70 ms，CPU Load 为 30%。这里的关键是将每段物理时间分配给它的实际执行者，再在统一窗口内汇总。

本文是[运行时测量专题](./README.md)的第一篇，先建立时间模型。[第二篇](./framework.md)将模型实现为 C99 核心，[第三篇](./autosar-integration.md)介绍平台接入。

[栈资源观测](./stack-measurement.md)沿用明确对象、单位和有效性的思路，进一步记录 Task/ISR 的历史内存需求。

## 1. 统一的时间分类

在一个核上，当前执行者可以归入 Task、Idle、ISR，或者已明确标注的调度空档。四类采用相同的计时单位和统计范围：

```text
Total = Task + Idle + ISR + Kernel
Busy  = Total - Idle
CPU Load = Busy / Total × 100%
```

| 指标 | 统计对象 | 使用方式 |
|---|---|---|
| Task exclusive | 普通任务实际占用 CPU 的时间 | 计算任务占用率 |
| Idle | 空闲执行路径占用 CPU 的时间 | 计算窗口内空闲比例 |
| ISR exclusive | ISR 自身占用 CPU 的时间 | 汇总物理中断开销 |
| Kernel gap | 已插桩的调度空档 | 表达已识别的 OS 边界时间 |
| 函数 inclusive/exclusive | 所属 Task 或 ISR 内部的函数时间 | 分析上下文内部开销 |

前四类构成时间分区。函数指标位于这些分区内部；ISR inclusive 包含被嵌套中断覆盖的区间，因此适合观察一次中断调用的范围。物理 CPU 时间采用 exclusive 指标汇总。

Hook、读时钟与中断入口/出口的开销按实际采样边界归入相邻分类。接入时记录这些边界的覆盖范围，可以让负载结果始终具有明确含义。

## 2. Idle 作为调度背景

RTOS 通常在没有普通就绪任务时执行 Idle 路径，有任务就绪后再切入该任务。Idle 是持续可用的调度背景，因此可以长时间运行，也可以被中断短暂打断。

每个核应识别自己的 Idle 执行上下文。对于 AUTOSAR OS，接入层依据实际调度实现和 Hook 覆盖建立映射，包括内部 Idle 的进入与离开边界。

这种映射使 Idle 计时与普通任务采用同一规则：从进入执行上下文开始累计，到下一次执行者变化为止。周期采样继续结算当前上下文，因此长时间 Idle 也能稳定输出窗口统计。

## 3. 调度边界与任务执行片段

任务开始运行时记录 dispatch 边界，任务切出时结束这一段运行区间。被抢占的任务保留已有累计值；恢复运行后继续记录属于自己的 CPU 时间。

```c
/* 调度事件示意；时间戳由适配层提供。 */
rtm_task_switch(&core, now, task_id);
/* 切入空闲路径。 */
rtm_task_switch(&core, now, RTM_IDLE);
```

一次 Task Activation 可以包含多个 dispatch 区间。区间之间可能发生任务抢占、等待或中断，因此“调度片段数”与“任务激活次数”分别统计。需要 Runnable 或业务调用次数时，在其实际入口和出口使用独立测量点。

Extended Task 的 `WaitEvent` 在真正进入等待并让出执行权时形成调度切换；所需事件已经满足时，则继续原有执行上下文。

## 4. ISR 入口与执行上下文恢复

ISR 入口将计时归属切换到中断，ISR 出口恢复下层执行者。下面这条时间线给出完整计算：

| 时间 | 执行者 | 累计 |
|---|---|---:|
| 0–20 ms | Task | 20 ms |
| 20–50 ms | Idle | 30 ms |
| 50–60 ms | ISR | 10 ms |
| 60–100 ms | Idle | 40 ms |

最终 Idle 为 70 ms，Busy 为 30 ms，负载为 30%。进入 ISR 时，Idle 的第一个片段在 50 ms 结束；中断退出后，第二个 Idle 片段从 60 ms 开始。

中断还可以使其他任务就绪。这时先结束最外层 ISR，再在实际 dispatch 边界切到新任务。执行者变化由完整事件顺序描述，时间归属随之自然更新。

## 5. 嵌套 ISR 的两种时间

![嵌套 ISR 时间线、inclusive 与 exclusive 的归属](/assets/rtm/rtm_idle_isr_timeline.svg)

图中 A 在 10 ms 进入，20 ms 被 B 抢占，30 ms 恢复，50 ms 退出。两种指标分别表达：

| 指标 | 计算 | 结果 |
|---|---|---:|
| A inclusive | 50−10 | 40 ms |
| A exclusive | (20−10)+(50−30) | 30 ms |
| B inclusive/exclusive | 30−20 | 10 ms |
| 物理 ISR 时间 | A exclusive + B exclusive | 40 ms |

每个核维护活动 ISR 栈。栈顶拥有当前物理 CPU 时间；上层调用在嵌套期间保持活动，因此它的 inclusive 范围持续存在。进入中断压栈，退出中断弹栈后恢复下层状态。

在图示的纯 Idle/ISR 窗口中，ISR 共 40 ms，Idle 共 60 ms，负载为 40%。配套 `task_isr` 示例还加入后续 Task 区间，用于展示 ISR 退出后的任务切换；它采用相同的中断归属规则。

## 6. 固定窗口与周期采样

统计窗口提供稳定的观察尺度。例如窗口为 100 ms，Idle 持续到 250 ms，模型应记录两个完整窗口和当前窗口的 50 ms。

![周期采样与持续执行区间的窗口切分](/assets/rtm/rtm_window_boundaries.svg)

周期 poll 或 snapshot 把当前执行者累计到采样时刻，并在逻辑窗口边界切分时间。跨窗口后保留原执行上下文和调用栈，调用次数、min/max 仍按完整调用统计。

窗口长度与硬件计数器采样间隔分别配置。假设低 32 位计数器以 100 MHz 递增，完整回绕约 42.95 秒；采用更短周期采样，按无符号模减得到增量，再累计到 64 位统计量，就能表示 60 秒等长窗口。

配套核心要求实际采样间隔小于计数器半回绕范围，且不超过窗口长度。这个约束由平台周期源保证。实际频率由 STM 配置确定；调试暂停、低功耗停计和时钟变化后重新建立统计 epoch。

## 7. 运行最小示例

进入仓库的 `embedded-runtime-observer` 目录：

```sh
make test
./build/basic
```

输出：

```text
Task=20 Idle=70 ISR=10 Total=100 Load=30.0%
```

示例使用 Mock ticks 表达与首个数值案例相同的时间比例。完整事件流既验证时间分区，也验证中断入口、出口和窗口边界的共同作用。

CPU Load 表达窗口内的工作比例；每个任务和 ISR 的 exclusive 指标进一步解释这些工作来自哪里。平台接入时补齐执行边界与时钟配置，这套账本就可以用于任务预算和运行时观察。

## 8. 时间预算与栈空间裕度

CPU Load 与每个执行者的时间指标支持周期和执行预算，Stack Measurement 则支持内存容量与安全裕度规划。一个运行时间很短的调用仍可能使用较深栈帧；两类指标各自采集，再在报告层按照任务、核与物理栈映射关联。

配套模块的 Stack Observer 可独立运行，提供有效容量、历史峰值、剩余量和 Guard 证据。[堆栈使用量测量](./stack-measurement.md)从内存模型展开其算法与 AUTOSAR 查询路径，与本文的时间账本一起构成资源观察基线。

## 参考资料

- [AUTOSAR OS 规范](https://www.autosar.org/fileadmin/standards/R22-11/CP/AUTOSAR_SWS_OS.pdf)
- [Infineon AURIX TC3xx 文档入口](https://documentation.infineon.com/aurixtc3xx/docs/qmd1702366622648)
- [配套源码与完整统计契约](https://github.com/binkyle/autosar-module-lab/tree/main/embedded-runtime-observer)

下一篇：[轻量级 Runtime Measurement 框架设计](./framework.md)。

