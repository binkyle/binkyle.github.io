---
title: 从 TC397 AUTOSAR 工程实践到可移植 RTM 框架
icon: code
date: 2026-10-09T10:00:27Z
description: 用独立 Hook 和 Mock STM 案例说明 RTM 核心如何接入 AUTOSAR，区分算法验证、业务源码审查和 TC397 硬件验证。
category:
  - Autosar
tag:
  - TC397
  - AUTOSAR
  - STM
  - Runtime Measurement
  - 多核
isOriginal: true
article: true
timeline: true
---

把 CPU Load 公式写对之后，真正接入 ECU 工程仍要回答：Idle 是否经过 Hook？RTM Point 位于 ISR 主体还是 OS 包装层？哪个核正在读统计变量？STM 的频率和调试行为怎样配置？

本篇以 TC397 + AUTOSAR 的测量需求为背景，给出可运行的独立模型及移植方法。**本轮没有访问真实业务源码，也没有 TC397 编译器或硬件环境。下面的数值来自 Host 模型，真实适配明确标为 Experimental / Unverified。**

这是[专题](./rtm_runtime_measurement_series.md)的实践篇。前两篇解释[时间归属](./rtm_cpu_load_idle_isr.md)与[核心设计](./rtm_framework_architecture.md)。

<!-- more -->

## 1. 先把调查线索变成可核查问题

常见现有方案会在 Pre/PostTaskHook 中累积 Task 时间，再把每核 Idle 时间换算成 CPU Load；部分 ISR 通过 RTM 测量点进入统计。

这个思路可以工作，但“Task Hook 已经配置”和“所有中断都正确扣除了”不是同一件事。调查应沿两条链同时展开：

| 链路 | 应确认什么 |
|---|---|
| 调度链 | Task 切出、恢复、等待、终止，Idle 实际实现与 Hook 覆盖 |
| ISR/RTM 链 | Point 定义、真正调用者、入口/出口位置、Cat1/Cat2、嵌套深度 |
| 统计链 | 每个字段的写者、数组索引、周期结算、窗口截断与快照保护 |
| 时间源 | STM 时钟、低位/高位读取、回绕、各核时钟及启动 epoch |

例如“某抢占宏没有启用”“ISR Hook 索引可能错误”，只有查到本次版本的宏定义、构建条件和实际读写表达式，才可以写成工程事实。不能把一份任务书中的风险列表直接变成修复结论。

公开案例保留原理、独立模型和验证方法，不包含供应商实现或业务生成配置。

## 2. 把 Hook 映射成确定的事件

本次提供 `examples/autosar_concept.c`，用 Mock STM 模拟时间。它将已离开 Task 的调度空档记为 Kernel，再在 Pre 边界切入 Task 或 Idle：

```c
/* 自编模型；不是供应商正式 Hook 的签名。 */
static rtm_status_t mock_post_taskhook(rtm_port_t *p) {
    return rtm_port_event(p, RTM_EVENT_SWITCH, RTM_KERNEL, 0);
}

static rtm_status_t mock_pre_taskhook(rtm_port_t *p, rtm_id_t id) {
    return rtm_port_event(p, RTM_EVENT_SWITCH, id, 0);
}
```

这项映射成立需要一个前提：底层 Hook 的真实顺序与当前 ISR 状态已经核实。若 OS 在中断退出的包装阶段提前调用 Task Hook，应由 adapter 规范化，不能把 mock 顺序直接复制过去。

没有普通 Task 切换的 ISR 链，用 enter/exit 保存和恢复原执行者；唤醒新任务的链则在最外层 ISR 结束后记录 dispatch。IRQ、OS 包装和 Hook 的边界以采样点为准，未覆盖部分仍可能落入相邻执行分类。

## 3. 实际运行这个最小案例

下载[源码归档](/downloads/embedded-runtime-observer-0.1.0.tar.gz)，解压后运行：

```sh
make test
./build/autosar_concept
```

输出：

```text
Mock hooks: task=30 kernel=4 ISR=10 idle=56 load=44.0%
```

其中 Task=30、ISR=10、Kernel gap=4，因此 Busy=44。这里 Kernel 是模型中显式标注的空档，不表示已经测得所有 OS 内核执行时间。

还有两个有教学价值的结果：基础事件流输出 Task=20、Idle=70、ISR=10、Load=30%；嵌套案例输出 A inclusive=40、exclusive=30。这些值可脱离 AUTOSAR 复现，用于检查适配层是否提供了相同语义。

## 4. 为什么仅打开抢占处理仍可能不够？

让 ISR 抢占时暂停 Task/Idle 计时，只解决了其中一项时间归属问题。若同时存在以下条件，仍不能保证结果正确：

- 只有一个保存槽，第二层 ISR 覆盖第一层状态；
- Core ID、Task ID、RTM Point ID 在不同数组之间混用；
- 只在 Task 切换时结算，长时间 Idle 没有及时截断窗口；
- 插桩只覆盖 ISR 主体，入口/出口和 OS 调度没有明确归属；
- 读取统计总量时，与本核 ISR 或其他核并发写入。

这些是需要排除的条件，不是对当前业务实现的已确认缺陷。通用核心分别用调用栈、显式 ID、周期 poll、边界契约和复制式 snapshot 处理它们。

## 5. STM 接口怎样保持可移植？

第一版核心接受低位时间戳。`ports/stm_low32.c` 接收 BSP 提供的 TIM0 寄存器指针，不包含固定地址、SDK 头文件或未经确认的时钟配置：

```c
uint32_t rtm_stm_low32_read(void *timer) {
    const rtm_stm_low32_t *stm = timer;
    return *stm->tim0;
}
```

该读取策略已用 Mock 寄存器编译运行，真实 MMIO 的地址、对齐、权限、频率和读出时序仍由平台核实。它不是已经完成配置的 TC397 驱动。

如果改用 64 位 STM 读取，[Infineon 官方说明](https://community.infineon.com/t5/Knowledge-Base-Articles/How-to-synchronously-read-the-64-bit-counter-value-in-AURIX-STM/ta-p/772814)描述了低部读取触发 CAP 锁存高部的机制。接入时还应证明两次读取之间不会被其他读取者改写锁存值。当前低位方案通过及时采样避开对双读配对的依赖。

以假设的 100 MHz 为例，60 秒窗口对应 60 亿 ticks，超过 32 位范围。核心用 64 位累计处理窗口，同时按短周期读取低位计数；这两层宽度各自解决不同问题。不同 STM 或启动时刻不默认全局对齐，调试暂停与低功耗停计也需要重新建立测量 epoch。

## 6. 多核汇总怎样避免“读到一半”？

每个核使用独立上下文，Task/ISR 更新和 snapshot 都按同一短临界区契约执行。读时钟放在建立保护之后；64 位复制也在保护内。

汇总核接收拥有者发布的完整副本，并核查 IOC/消息发布的缓存与内存顺序。把数据放到 NonCached RAM 可以解决部分缓存可见性问题，却不能自动保证复合状态不可分割。

各核副本至少包含核标识、累计范围和窗口编号。若需要同时刻的全局负载，应额外建立共同时间基准与采样协调；单纯把“每核负载”相加不能得到有定义的全局指标。

## 7. 已完成的验证与工程边界

| 验证项 | 本次结果 |
|---|---|
| 单核/嵌套/窗口/回绕/配对错误 | 37 个核心场景通过 |
| 随机转换 | 10 万次，独立逐 tick oracle 符合分类累计 |
| 双核并发副本读取 | 20 万次受保护操作通过，ThreadSanitizer 无竞态报告 |
| Host 导出与只读取证脚本 | 4 个 Python 测试通过 |
| 默认/关闭 Trace/缩小容量 | 均运行通过 |
| 地址与未定义行为检查 | 通过；本地关闭环境不支持的 leak 检查 |
| 真实业务源码、TASKING 编译、TC397 硬件 | 未执行，不宣称通过 |

一次 Linux x86-64/GCC 13.3 的 poll 基准中，普通 Task 场景原始平均约 27.93 ns，8 层 ISR 与 8 层函数点场景约 39.38 ns，包含计时读数和 Host 噪声。这个结果只用于复现 Host 成本，不能换算为 TC397 WCET。snapshot 和中断屏蔽的最大时间需要在目标上单独测量。

源码采用 MIT 许可，包含中英文 README、构建文件、测试、可运行示例、完整统计契约和 CI 配置。当前通过专题页提供 v0.1.0 归档，独立 GitHub 仓库待建立；不能把目标仓库名称当作已经公开的地址。

## 8. 从模型到真正的目标验证

源码中的 `tools/collect_case_evidence.py` 能在本地只读收集相关调用点、宏和带哈希的局部证据，输出必须放在业务工程外。它不修改或生成业务文件，也不替代完整调用链审查。

下一轮应先确认真实配置与 Hook 覆盖，再用可控制的任务和中断负载对照独立测量。重点验证 Idle→ISR→Idle、Task→ISR→Task、Idle→ISR→Task、嵌套 ISR，以及跨窗口时没有切换的持续执行。最后测量 Hook 与 snapshot 自身的开销，决定周期、容量和报告路径。

这套顺序使框架的模型验证、具体软件适配和真实硬件验证各自有明确证据，也让不使用 Vector AUTOSAR 的开发者能采用同一个核心。
