---
title: 嵌入式运行时测量
icon: gauge
date: 2026-10-09T10:00:27Z
description: 从 Task、Idle 和 ISR 的时间模型出发，构建可移植的 C99 Runtime Measurement 核心，并完成 AUTOSAR 与 STM 的平台接入。
category:
  - Autosar
tag:
  - Runtime Measurement
  - CPU Load
article: false
timeline: false
order: 1
redirectFrom:
  - /blog/Autosar/rtm_runtime_measurement_series.html
---

运行时测量为嵌入式系统提供一份可解释的时间账本：核的时间分配给 Task、Idle、ISR 和调度空档，函数测量点进一步展示各执行上下文内部的开销。这套模型既支持日常 CPU 负载观察，也为任务预算、采样周期和性能优化提供依据。

本专题按“时间模型 → 核心设计 → 平台接入”组织。每篇文章都从明确的概念出发，配合时间线、数值实例和可运行代码展开。

| 阅读顺序 | 文章 | 主要内容 |
|---|---|---|
| 1. 时间模型 | [嵌入式 CPU 负载测量：Task、Idle 与 ISR](./cpu-load.md) | 时间分类、任务执行片段、中断嵌套和固定窗口 |
| 2. 核心设计 | [轻量级 Runtime Measurement 框架设计](./framework.md) | 显式事件、每核状态、函数栈、快照与 Trace |
| 3. 平台接入 | [TC397 与 AUTOSAR 的运行时测量接入](./autosar-integration.md) | STM、Hook 映射、周期采样、多核发布与验证流程 |

## 配套代码

[embedded-runtime-observer](https://github.com/binkyle/autosar-module-lab/tree/main/embedded-runtime-observer) 作为独立模块放在 `autosar-module-lab` 中，包含 C99 核心、中英文说明、五个示例、测试和移植文档。

```sh
git clone https://github.com/binkyle/autosar-module-lab.git
cd autosar-module-lab/embedded-runtime-observer
make test
./build/basic
```

基础示例输出 `Task=20 Idle=70 ISR=10 Total=100 Load=30.0%`。Host 模型已经验证；真实 TC397/MICROSAR 适配按第三篇中的流程完成目标构建和硬件对照。

也可以下载[冻结的 v0.1.0 源码归档](/downloads/embedded-runtime-observer-0.1.0.tar.gz)进行离线复现。当前分发与接入说明以仓库内文档为准。

