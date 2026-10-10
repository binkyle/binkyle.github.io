---
title: TC397 与 AUTOSAR 的运行时测量接入
icon: code
date: 2026-10-09T10:00:27Z
description: 将 STM、Task Hook、ISR 边界和每核快照接入通用 Runtime Measurement 核心，形成可复现模型与分阶段的目标验证流程。
category:
  - Autosar
tag:
  - TC397
  - AUTOSAR
  - STM
  - Runtime Measurement
  - 多核
isOriginal: true
order: 3
redirectFrom:
  - /blog/Autosar/rtm_tc397_autosar_practice.html
---

通用测量核心与 ECU 工程之间的连接集中在平台适配层：它识别实际执行者，读取 STM 时间，形成串行事件，并把统计副本交给报告路径。

对于 TC397 与 AUTOSAR，可以按“Host 模型 → 时间源 → 调度和中断边界 → 周期采样 → 多核发布 → 目标验证”的顺序完成接入。各步骤分别建立一项明确的契约，组合后得到可解释的每核时间账本。

本文使用[配套模块](https://github.com/binkyle/autosar-module-lab/tree/main/embedded-runtime-observer)中的独立 Hook 模型讲解接口。C99 核心与 Mock 示例已通过 Host 验证；具体 MICROSAR/TASKING/TC397 接入处于 Experimental / Unverified，目标参数和实际 Hook 顺序由工程配置确定。

## 1. 建立可复现的 Host 基线

克隆仓库，进入模块目录：

```sh
git clone https://github.com/binkyle/autosar-module-lab.git
cd autosar-module-lab/embedded-runtime-observer
make test
./build/autosar_concept
```

输出：

```text
Mock hooks: task=30 kernel=4 ISR=10 idle=56 load=44.0%
```

这个模型显式记录 30 ticks Task、10 ticks ISR 和 4 ticks 调度空档，共 44 ticks Busy。Kernel 在这里表示已标注的 Post/Pre 之间空档。模型为真实适配提供一组稳定的输入和期望值。

模块还提供基础负载、嵌套 ISR、多核、Mock 寄存器、栈模拟和 OS 栈查询示例。接入过程中可以对照它们，逐项确认平台事件与核心语义一致。

## 2. 配置每核上下文和 ID 映射

每个逻辑核分配独立的 `rtm_core_t`，由该核执行事件更新和快照复制。适配层建立 Task ID、ISR/RTM Point ID 与观测 ID 的查表映射，并为 Idle 和已覆盖的调度空档使用专用标识。

| 平台信息 | 映射到核心 |
|---|---|
| 逻辑核 | 独立 core 对象与核标识 |
| 普通任务 | Task ID |
| 空闲执行路径 | `RTM_IDLE` |
| 已识别的调度空档 | `RTM_KERNEL` |
| ISR 入口/出口 | 匹配的 ISR ID |
| Runnable 或函数调用 | 独立 Point ID |

映射依据实际生成配置建立。它将硬件核编号、OS 对象 ID 和测量点编号各自的含义保留在平台层，核心接收统一的观测 ID。

## 3. 连接 STM 时间源

`ports/stm_low32.c` 接收 BSP 提供的 TIM0 低 32 位寄存器指针。读出策略保持简单：

```c
uint32_t rtm_stm_low32_read(void *timer) {
    const rtm_stm_low32_t *stm = timer;
    return *stm->tim0;
}
```

BSP 配置寄存器地址、访问权限、对齐、STM 时钟及 divider。读取发生在本核保护建立之后，与事件更新采用同一访问协议。`baremetal` 示例用 Mock 寄存器验证这一接口的构建和事件语义。

以假设的 100 MHz 为例，60 秒窗口需要累计 60 亿 ticks。核心用 64 位统计量表达窗口，同时用短周期读取低位计数器；例如 1 秒采样可以把低位增量持续扩展到长窗口。实际周期还要与配置的 `max_gap_ticks`、时钟条件和采样抖动共同核定。

采用完整 64 位 STM 读取时，可以依据 [Infineon 的 CAP 锁存机制说明](https://community.infineon.com/t5/Knowledge-Base-Articles/How-to-synchronously-read-the-64-bit-counter-value-in-AURIX-STM/ta-p/772814)实现配对读出，并建立覆盖嵌套与跨核读者的保护。时钟停计、调试暂停或频率变化后重新建立 epoch。

## 4. 将 Hook 转换为执行事件

配套 `autosar_concept.c` 用自编模型把 Post 边界切到 Kernel，把 Pre 边界切到目标 Task 或 Idle：

```c
/* 可运行的 Hook 模型；具体 OS 使用其正式接口。 */
static rtm_status_t mock_post_taskhook(rtm_port_t *p) {
    return rtm_port_event(p, RTM_EVENT_SWITCH, RTM_KERNEL, 0);
}

static rtm_status_t mock_pre_taskhook(rtm_port_t *p, rtm_id_t id) {
    return rtm_port_event(p, RTM_EVENT_SWITCH, id, 0);
}
```

真实接入先还原 Task dispatch、内部 Idle、ISR 包装层与调度出口的调用顺序，再在对应边界形成事件。若供应商 Hook 顺序与模型不同，由 adapter 将它转换成核心所接受的执行顺序。

ISR 入口保存下层上下文，出口按栈顶 ID 完成调用。最外层 ISR 退出后，再在实际任务调度边界提交 switch。模型因此同时覆盖“返回原任务”和“唤醒并切入新任务”两条路径。

现有 `Rtm_Start/Rtm_Stop` 测量点可以作为候选输入。根据每个 Point 的实际调用位置，将其映射为 ISR 或函数点，记录入口、出口以及 Cat1/Cat2 的覆盖范围。

## 5. 周期采样与报告路径

周期 poll 在每核执行，即使一直停留在 Idle，也会累计当前时间并结算固定窗口。事件更新路径处理当前执行状态，报告路径读取完成窗口和当前部分窗口。

Hook 内的工作集中在读时钟和更新状态。日志、格式转换、通信输出和文件生成放到低优先级报告任务或 Host 工具中，方便单独测量观察本身的成本。

平台保护覆盖所有参与观测的写者，并保存、恢复原有中断屏蔽状态。Cat1、Cat2 和 NMI 根据实际访问模型分别处理；完整覆盖范围与观测结果一起记录。

## 6. 多核统计的副本发布

拥有者核在保护内生成 snapshot，汇总核接收完整副本。副本包含核标识、统计范围、窗口编号和有效性信息，接收者据此解释每核负载。

IOC 或消息通道负责副本发布协议，包括缓存可见性、内存顺序和副本更新边界。NonCached 存储用于相应的缓存属性，同步协议保证复合状态的一致性。

各核可以独立起始和采样。需要同时刻的全局统计时，再建立共同时间基准与采样协调，并在相同范围内汇总工作比例。

## 7. 分阶段完成目标验证

| 阶段 | 核心工作 | 交付结果 |
|---|---|---|
| 配置核查 | STM 参数、核映射、Idle 路径、Hook 顺序与 Point 覆盖 | 平台事件和时间源契约 |
| 目标构建 | TASKING 编译、静态容量、结构体布局和访问权限 | 目标构建记录 |
| 功能对照 | 控制 Task 与 IRQ 负载，比较独立计时 | 时间分类与窗口结果 |
| 开销测量 | Hook、读时钟、snapshot 与最大屏蔽时间 | 观察预算与采样周期 |
| 长时间运行 | 回绕、持续 Idle、深层中断和输出消费 | 持续观察记录 |

功能对照覆盖 Idle→ISR→Idle、Task→ISR→Task、Idle→ISR→Task 和嵌套 ISR，分别核对 Idle、Task、ISR exclusive/inclusive。持续执行跨窗口时，验证完整窗口长度和调用计数保持一致。

源码中的 `tools/collect_case_evidence.py` 可以只读收集相关调用点、宏、行号和 SHA-256，作为平台核查的辅助材料。输出放在业务工程之外，源码摘录用于本地审查。公开教程使用独立模型和通用接口。

## 8. 选择观察预算

Host 默认布局每核 11,144 字节，缩小容量并关闭 Trace 后为 3,504 字节。Linux x86-64/GCC 13.3 的一次 poll 基准记录原始平均 27.93 ns；8 层 ISR 与 8 层函数点场景为 39.38 ns，包含计时开销和 Host 调度噪声。

目标预算依据真实 ABI、时钟和中断环境重测。将 Hook 成本、快照复制、采样周期和报告带宽一起纳入预算，就能选出适合该工程的容量和观察粒度。

## 9. 接入 OS 栈查询与共享区域

时间观测使用执行事件，栈观测使用 OS 提供的合法用量服务。在已调查的 MICROSAR 案例中，Task/ISR 查询返回历史已用字节；实际 API 原型、初始化条件与调用权限由生成配置和供应商手册确定。

Stack Observer 的 OS-managed descriptor 不持有栈内存地址，包装层负责查询与单位归一化。同一物理 ISR 栈的多个逻辑 ID 映射到同一对象，报告保留 core、region 和 shared 标记。

CDD/report task 可以轮询区域、更新峰值并发布副本。跨核 XSignal 的等待与进度条件单独核查，查询不直接使用时间 Hook 的中断屏蔽包装。目标验收进一步比较有效容量、OS 水位、报告成本和共享区域身份。

[堆栈使用量测量](./stack-measurement.md)提供完整算法、Guard 与 CSA 边界，以及可运行的 Host 结果。[框架设计](./framework.md)定义通用状态与统计契约，平台接入为时间和内存观测分别补齐真实来源，两者共同支撑长期资源观察。

