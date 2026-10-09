---
title: 嵌入式 Runtime Measurement 专题：从 CPU Load 到通用观测核心
icon: code
date: 2026-10-09T10:00:27Z
description: CPU Load 原理、C99 核心架构与 TC397 AUTOSAR 适配方法的连续专题，附可运行源码和测试。
category:
  - Autosar
tag:
  - Runtime Measurement
  - CPU Load
article: false
timeline: false
---

这个专题从中断抢占 Idle 时的负载误差出发，逐步说明运行时测量的时间归属、状态机和工程接入方法。

1. [原理篇：嵌入式 CPU Load 是如何计算的：从 Idle Task 到 ISR 抢占](./rtm_cpu_load_idle_isr.md)
2. [架构篇：设计一个轻量级嵌入式 Runtime Measurement 框架](./rtm_framework_architecture.md)
3. [实践篇：从 TC397 AUTOSAR 工程实践到可移植 RTM 框架](./rtm_tc397_autosar_practice.md)

[下载 embedded-runtime-observer v0.1.0 源码](/downloads/embedded-runtime-observer-0.1.0.tar.gz)。归档含 MIT 许可、中英文 README、C99 核心、5 个示例、37 个核心测试场景、Host 工具、取证脚本和 CI 配置。

快速复现：

```sh
tar -xzf embedded-runtime-observer-0.1.0.tar.gz
cd embedded-runtime-observer-0.1.0
make test
```

通用算法已做 Host 验证；TC397/MICROSAR 适配仍是 Experimental / Unverified。真实业务源码与硬件尚未在本轮环境中验证。当前先提供源码归档，独立 `binkyle/embedded-runtime-observer` 仓库待建立。
