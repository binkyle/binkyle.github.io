---
title: AUTOSAR Com模块概述
date: 2025-06-20
order: 1
isOriginal: true
article: true
timeline: true
categories:
 - AUTOSAR
 - 通信模块
tags:
 - COM
 - AUTOSAR
 - Endianness
 - Signal
 - Byte Order
---

## 一、AUTOSAR Com 模块概述

AUTOSAR Com模块位于AUTOSAR分层架构的中间层，是用于处理ECU间信号通信的核心模块。它为用户（如RTE）提供以信号为导向的数据接口，支持信号的打包与解包、路由与过滤、传输控制等功能。

## 二、模块核心功能

AUTOSAR Com模块的主要功能包括但不限于：

* 提供基于信号的数据接口
* 信号打包到I-PDU以发送
* 接收并解包I-PDU
* 信号路由（信号网关）
* 通信模式管理（如启动/停止I-PDU组）
* 接收信号监控（超时机制）
* 信号过滤
* Endianness转换（字节序转换）
* 支持大数据类型和动态长度信号

## 三、字节序与位序

### 1. 字节序（Byte Order）

字节序定义了多字节数据在内存或通信中的字节顺序。

* **Big Endian**: 高字节在前，低字节在后。
* **Little Endian**: 低字节在前，高字节在后。

### 2. 位序（Bit Order）

位序定义了单个字节内部的位编号顺序。

* **Motorola (MSB-first)**: 最高有效位在左（bit7），最低有效位在右（bit0）。
* **Intel (LSB-first)**: 最低有效位在左（bit0），较少用于AUTOSAR。

AUTOSAR采用Motorola位序（MSB-first），即bit0在最右边。

## 四、信号打包解包流程

AUTOSAR Com模块通过以下流程处理信号：

### 发送流程

1. 用户调用`Com_SendSignal`接口，信号值写入内部缓存。
2. 根据配置的传输模式（如周期或事件触发）将信号打包成I-PDU。
3. 调用`PduR_ComTransmit`接口将I-PDU传递给PDU Router。
4. PDU Router再交由底层驱动发送出去。

### 接收流程

1. 底层驱动接收到数据后，通过`PduR_ComRxIndication`通知Com模块。
2. Com模块对数据进行解包，提取信号值。
3. 根据配置通知上层用户（如RTE）处理信号。

## 五、动态长度信号处理

动态长度信号的长度可以在运行时变化。AUTOSAR规定每个I-PDU中最多只能有一个动态长度信号，且必须位于I-PDU末尾。动态长度信号的类型被限制为UINT8数组类型。

## 六、信号过滤机制

AUTOSAR Com模块支持的信号过滤算法包括：

* ALWAYS
* NEVER
* MASKED\_NEW\_EQUALS\_X
* MASKED\_NEW\_DIFFERS\_X
* MASKED\_NEW\_DIFFERS\_MASKED\_OLD
* ONE\_EVERY\_N

这些过滤机制在接收端决定信号是否传递给应用。

## 七、信号网关功能

AUTOSAR Com提供信号网关功能，支持1\:n方式的信号与信号组转发，并提供静态配置路由关系。

## 八、I-PDU组管理

I-PDU组通过`Com_IpduGroupStart`和`Com_IpduGroupStop`进行管理，实现通信的动态启停，涉及初始化shadow buffer及filter等操作。

## 九、通知机制

Com模块提供即时（IMMEDIATE）和延迟（DEFERRED）两种通知模式，分别对应立即通知上层和延迟到下一次主函数调用时再通知上层。

## 十、错误分类与处理

AUTOSAR Com模块的错误分类包括开发错误、运行时错误、瞬态故障、生产错误和扩展生产错误等，确保通信可靠性。

## 十一、多核分布

为了负载均衡，Com模块支持多核分布。各通信网络（如CAN、FlexRay和Ethernet）的Com堆栈可以部署在不同核上，从而减少跨核通信和同步需求。

## 十二、主要API接口

AUTOSAR Com模块的主要API接口包括但不限于：

* Com\_Init
* Com\_DeInit
* Com\_SendSignal
* Com\_ReceiveSignal
* Com\_SendSignalGroup
* Com\_ReceiveSignalGroup
* Com\_IpduGroupStart
* Com\_IpduGroupStop

## 十三、配置参数

Com模块的配置参数涵盖通用参数（如ComGeneral）、信号与信号组配置、IPDU配置、通知和回调函数配置等。
