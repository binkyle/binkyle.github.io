---
# 这是文章的标题
title: Autosar解决方案概述
# 你可以自定义封面图片
# cover: /assets/images/cover1.jpg
# 这是页面的图标
icon: file
# 这是侧边栏的顺序
order: 1
# 设置作者
# author: Ms.Hope
# 设置写作时间
date: 2023-12-17
# 一个页面可以有多个分类
category:
  - Autosar
# 一个页面可以有多个标签
tag:
  - 概述
  - 解决方案
# 此页面会在文章列表置顶
# sticky: true
# 此页面会出现在文章收藏中
star: true
isOriginal: true
article: true
timeline: true
# 你可以自定义页脚
# footer: 这是测试显示的页脚
# 你可以自定义版权信息
# copyright: 无版权
---

本文主要讲解Autosar解决方案相关内容

<!-- more -->
## Autosar技术标准框架

AUTOSAR技术标准针对不同的需求提供了不同的解决方案，以涵盖汽车软件开发领域的各种应用场景

### Adaptive Platform(AP)

Adaptive Platform是AUTOSAR为开发安全相关的高算力ECU，如自动驾驶，而提供的解决方案

AP分层软件架构特点:
- 支持采用C++作为应用软件的编程语言
- 采用面向服务的架构（SOA）
- 支持多任务并行处理
- 尽可能重用已有标准
- 支持功能安全和信息安全
- 有计划的动态性，而非完全动态
- 支持基于敏捷的开发过程
![Alt text](image-6.png)
### Classic Platform(CP)

Classic Platform是AUTOSAR为开发硬实时、高安全性嵌入式系统，如电驱控制，而提供的解决方案

CP分层软件架构支持：
- 对硬件进行抽象，实现软硬解耦
- 对Runnable和Task进行调度（操作系统）
- 抽象部署在同一ECU或者不同ECU上的应用之间的通信，实现整车层面的虚拟功能总线
- 故障诊断及诊断服务
- 功能安全服务
- 今信息安全服务
![Alt text](image-4.png)

CP所定义的系统服务、存储、通信、硬件1/0和复杂驱动等各个基础软件技术栈，其作用类似于人体的神经系统。相对应地，控制器硬件可以理解为身体，而应用软件可以理解为大脑或灵魂。
![Alt text](image-5.png)
### Foundation(FO)

Foundation包含了AP和CP之间通用的内容以保证二者之间以及二者与非AUTOSAR系统之间的兼容性

原文如下：
![Alt text](image-1.png)
![Alt text](image-2.png)
<center>FO角色</center>


#### FO部分所定义的通用特性
  FO部分所定义的内容为“基础设施”，同时适用于CP和AP两种系统，以保证二者之间的兼容性。如通信协议、元模型、主干需求与术语、文件模板等。

### AP、CP、FO间的关系
![Alt text](image.png)

### CP 与 AP 的区别
|CP|AP|
|----|----|
|Based on OSEK|Based on POSIX|
|Execution of code directly from ROM|App is loaded from persistent memory into RAM|
|Same address space for all applications (MPU support for safety)|Each application has its own (virtual) address space (MMU support)|
|Optimized for signal-based communication (CAN, FlexRay)|Service-oriented communication|
|Fixed task configuration|Support of multiple (dynamic) scheduling strategies|
|Specification|Specification and code|
从CP到AP,实时性与安全性需求减少，算力需求增加

### 基于区域集中式EE架构的整车部署

![Alt text](image-3.png)
CP应用范围更广，AP与CP相辅相成，AP不会替代AP

## Autosar标准制定方式

### AUTOSAR年度关键节点

- 每年11月份集中发布FO、CP和AP标准
- AP演示代码在次年春季发布
- 每年上半年举办开放大会AOC
- 每年12月份组织标准发布会
- 年中组织全体工作组会议

![Alt text](image-7.png)

### 参考链接
[AUTOSAR_TR_FoundationReleaseOverview](https://www.autosar.org/fileadmin/standards/R20-11/FO/AUTOSAR_TR_FoundationReleaseOverview.pdf)
AUTOSAR中国官方培训课程
::: tip
若本文对您有用，欢迎送个表情包或评论
;若有不对之处或建议，欢迎评论
:::
