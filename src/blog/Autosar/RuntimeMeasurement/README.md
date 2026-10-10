---
title: 嵌入式运行时测量
icon: gauge
date: 2026-10-09T10:00:27Z
description: 以时间账本与栈空间水位连接 CPU Load、Task/ISR 执行、Stack Observer 和 AUTOSAR 平台接入，建立可复现的嵌入式资源观测方法。
category:
  - Autosar
tag:
  - Runtime Measurement
  - CPU Load
  - Stack
article: false
timeline: false
order: 1
redirectFrom:
  - /blog/Autosar/rtm_runtime_measurement_series.html
---

运行时测量把嵌入式系统的资源使用变成可解释的指标。时间账本将每核执行分配给 Task、Idle、ISR 和调度空档，函数点展示上下文内部开销；栈空间水位记录历史需求与剩余裕度。两类观测共同为执行预算、内存容量和采样节奏提供依据。

本专题按“时间模型 → 核心设计 → 平台接入 → 栈资源观测”组织。每篇文章都从明确的概念出发，配合时间线、内存布局、数值实例和可运行代码展开。

| 阅读顺序 | 文章 | 主要内容 |
|---|---|---|
| 1. 时间模型 | [嵌入式 CPU 负载测量：Task、Idle 与 ISR](./cpu-load.md) | 时间分类、任务执行片段、中断嵌套和固定窗口 |
| 2. 核心设计 | [轻量级 Runtime Measurement 框架设计](./framework.md) | 显式事件、每核状态、函数栈、快照与 Trace |
| 3. 平台接入 | [TC397 与 AUTOSAR 的运行时测量接入](./autosar-integration.md) | STM、Hook 映射、周期采样、多核发布与验证流程 |
| 4. 栈资源 | [嵌入式堆栈使用量测量：Stack Painting、High-Water Mark 与溢出监控](./stack-measurement.md) | 物理区域、有效容量、历史水位、Guard 与 OS 查询 |

## 配套代码

[embedded-runtime-observer](https://github.com/binkyle/autosar-module-lab/tree/main/embedded-runtime-observer) 作为独立模块放在 `autosar-module-lab` 中，v0.2.0 包含时间核心、可独立构建的 Stack Observer、中英文说明、七个示例、测试和移植文档。

```sh
git clone https://github.com/binkyle/autosar-module-lab.git
cd autosar-module-lab/embedded-runtime-observer
make test
./build/basic
./build/stack_simulator
```

时间示例输出 `Task=20 Idle=70 ISR=10 Total=100 Load=30.0%`。栈示例用虚拟数组展示 2048 B 容量、640 B 峰值、1408 B 剩余量和 31.25% 使用率。Host 模型已经验证；真实 TC397/MICROSAR 接入分别完成目标构建、查询权限与硬件对照。

也可以下载[v0.1.0 时间核心公开归档](/downloads/embedded-runtime-observer-0.1.0.tar.gz)进行离线复现。2026-10-10 更新了采集工具、测试和案例说明，移除了业务目录与专用匹配标识；时间核心保持 v0.1.0，该归档不包含 Stack Observer。v0.2.0 源码、验证和接入说明以仓库内文档为准。

公开归档 SHA-256：`fcb714abc12bdf3b1d14ec028d17ee77f8e50446d7197a9c15cd69ed6c85e889`。

