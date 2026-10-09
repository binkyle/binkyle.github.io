---
title: 轻量级 Runtime Measurement 框架设计
icon: code
date: 2026-10-09T10:00:27Z
description: 将运行时的执行者变化实现为显式事件，使用每核状态、ISR 栈、函数测量点与复制式快照构建可移植的 C99 测量核心。
category:
  - Autosar
tag:
  - Runtime Measurement
  - C语言
  - 软件架构
  - 多核
  - ISR
isOriginal: true
order: 2
redirectFrom:
  - /blog/Autosar/rtm_framework_architecture.html
---

运行时测量可以分成三个职责：平台产生执行事件，核心维护时间归属，报告路径输出统计结果。显式的分工使同一个算法可以在 PC、裸机和 RTOS 环境中运行。

`embedded-runtime-observer` 采用 C99 和静态内存实现这一模型。Task、Idle、ISR、调度空档和函数点共用明确的事件边界，在线统计与可选 Trace 各自保留输出状态。

本文承接[时间模型](./cpu-load.md)，沿着事件进入核心后的处理过程介绍框架设计。

## 1. 事件驱动的分层结构

![Runtime Measurement 的平台、事件、统计与报告分层](/assets/rtm/rtm_architecture.svg)

平台层提供 Timer、核 ID、任务映射、Hook 和临界区。核心接受显式时间戳：

```c
rtm_task_switch(&core, now, task_id);
rtm_isr_enter(&core, now, isr_id);
rtm_isr_exit(&core, now, isr_id);
rtm_point_begin(&core, now, point_id);
rtm_point_end(&core, now, point_id);
```

每次事件先把旧执行上下文累计到 `now`，再更新状态。旧执行者拥有边界之前的时间，新执行者从边界开始运行。这个顺序让时间分区与状态转换保持一致。

Mock Clock 可以将输入固定为 10、20、30、50 等数值，独立验证结果。硬件读时钟、OS 接口和统计输出由各自适配层完成，核心接口保持稳定。

## 2. 每核执行上下文与 ISR 栈

每个核拥有独立的 `rtm_core_t`。Task、Idle 或 Kernel 是底层执行者，ISR 调用栈保留中断期间的嵌套关系。

| 事件 | 时间结算 | 状态更新 |
|---|---|---|
| Task/Idle 切换 | 累计旧执行者 | 选定新执行者 |
| ISR enter | 结束下层当前片段 | 压入新的 ISR 帧 |
| 嵌套 ISR enter | 结算上层 exclusive 片段 | 嵌套帧成为栈顶 |
| ISR exit | 结算栈顶并完成调用 | 弹栈、恢复下层 |
| poll/snapshot | 累计当前执行者 | 保持原执行状态 |

ISR exclusive 计入栈顶，inclusive 累计到全部活动 ISR 帧。即使同一 ID 重入，每次调用也保留自己的帧。

最外层 ISR 退出后，底层执行者先恢复。若调度器随后选中另一任务，再提交 task-switch 事件。接入层根据真实 OS 边界形成这个事件顺序。

## 3. 函数测量点的上下文归属

函数点在所属 Task 或 ISR 内部计时。每个 Task、Idle、Kernel 和 ISR 调用分别维护自己的函数栈，支持嵌套和同 ID 递归。

Task A 调用 P，随后被 ISR 抢占，而 ISR 也调用 P，两次调用分别保存在自己的上下文中。Task A 的栈保持暂停，中断退出后继续计时；任务阻塞或切换到其他任务时采用同样规则。

函数 inclusive 包含所属上下文中的嵌套函数，exclusive 表达函数本身的 CPU 时间。两者都排除其他任务、中断抢占和阻塞时间。需要观察端到端等待时延时，另设 wall-time 测量点。

调用结束必须匹配当前上下文的栈顶。配对错误、非法 ID 和深度溢出进入明确的故障状态，保留诊断；在已知执行者和有效时钟下 reset，开始新的观察 epoch。

## 4. 统计口径与固定窗口

累计时间包含已采样的活跃区间，min/max/average 描述已经完成的调用或 dispatch 区间。平均 exclusive 时间使用“已完成区间的 exclusive 总量 / 完成次数”，保持分子与分母一致。

窗口使用 64 位长度，输入时间戳可以使用低 32 位计数器。周期采样将活跃 Task、ISR 和函数帧的时间分配到相邻窗口，同时保留完整调用状态。

配置满足 `max_gap_ticks <= window_ticks`，且小于计数器半回绕范围。一条事件最多切分为两个累计片段、关闭一个窗口，Hook 内的工作量由此获得明确上限。

核心保存当前部分窗口和最近完成窗口。报告路径根据窗口编号读取并保留历史；各窗口采用半开区间，边界时刻的新事件作用于后一个窗口。

## 5. 串行访问与复制式快照

平台层按以下顺序执行一次观察操作：

1. 保存并建立覆盖全部本核写者的保护状态；
2. 读取硬件时间；
3. 更新核心或复制 snapshot；
4. 恢复先前的保护状态。

保护覆盖事件、快照和 Trace 读取。时间戳在保护建立后获取，保证同一对象收到的事件时间有序。快照在同一保护内完成，使 32 位机器上的 64 位累计值也具有一致读出语义。

各核独立对象允许并行观察；跨核报告由拥有者生成完整副本，再通过 IOC 或消息路径发布。消息协议负责缓存可见性和发布顺序。各核 snapshot 携带自己的 epoch 与窗口范围，需要同步全局统计时再建立共同时间基准和采样协调。

## 6. 在线统计与 Trace 输出

在线指标和 Trace 共享事件边界，但保留各自的存储状态。固定容量 FIFO 满时记录丢失次数，并丢弃新 Trace 事件；核心继续累计在线指标。

`RTM_TRACE_CAPACITY=0` 可以关闭事件缓冲。需要保留事件顺序时，Host 工具按字段导出 CSV，并生成 Chrome/Perfetto 即时事件 JSON。它适合检查事件顺序与丢失情况；完整 span 还原、跨核时钟对齐和二进制格式按消费端需求扩展。

## 7. 成熟组件的协作方式

| 组件 | 可承担的职责 |
|---|---|
| [TraceRecorder](https://github.com/percepio/TraceRecorderSource) | 已有 RTOS 事件采集与 ISR 嵌套模型 |
| [barectf](https://barectf.org/docs/barectf/3.1/platform/api.html) | CTF 编码生成与平台输出接口 |
| [Zephyr Tracing](https://docs.zephyrproject.org/latest/services/tracing/index.html) | 系统事件与输出 backend 的分层 |
| [Trace Compass](https://github.com/eclipse-tracecompass/org.eclipse.tracecompass) / [Perfetto](https://perfetto.dev/docs/instrumentation/track-events) | Host 分析、时间线展示与结果消费 |
| [SystemView](https://www.segger.com/products/development-tools/systemview/) | 目标事件和 Host 分析工具的整合 |

本模块实现执行状态、时间分类、静态统计、固定窗口和可选事件缓冲。已有工具可以承接它们擅长的格式、传输和分析工作，具体接入遵循对应许可证与平台条件。

## 8. 静态容量与可复现验证

默认 Host 布局每核 11,144 字节。将 Task、ISR、Point 容量各设为 8，深度设为 4，并关闭 Trace 后，每核为 3,504 字节。相同配置宏应用于所有编译单元，目标 ABI 的结构体大小另行测量。

核心事件处理成本与编译时限制的 ISR/函数深度相关，snapshot/reset 成本与静态容量相关。容量与最大保护时间可以依据实际任务数量和嵌套需求选择。

37 个核心场景覆盖执行切换、嵌套、重入、窗口、计数器回绕和异常配对；其中随机场景用独立逐 tick oracle 核对 10 万次转换。两个模拟核和两个快照读者完成 20 万次串行化操作，验证单对象访问协议。

```sh
cd autosar-module-lab/embedded-runtime-observer
make test
```

[完整源码](https://github.com/binkyle/autosar-module-lab/tree/main/embedded-runtime-observer)提供事件 API、统计契约、移植说明和 Host 工具。下一篇把这些接口连接到[TC397 与 AUTOSAR 的运行时测量路径](./autosar-integration.md)。

