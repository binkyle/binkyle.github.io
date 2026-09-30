---
title: 从一次 SecOC IMMEDIATE→DEFERRED 修复看复杂嵌入式问题的排查方法
date: 2026-09-30
order: 1
isOriginal: true
article: true
timeline: true
categories:
  - AUTOSAR
  - 嵌入式系统
tags:
  - SecOC
  - COM
  - CSM
  - HSM
  - AUTOSAR
  - 多核
  - 实时系统
  - 故障排查
---

在车载嵌入式项目中，有一类问题非常容易把排查方向带偏：现象发生在通信接收侧，最终修复却改了发送侧配置；修改量很小，甚至只是一个枚举值；修改后问题确实消失，但继续沿源码、任务和硬件资源往下追，会发现实际机制和最初的“根因描述”并不完全一致。

本文以一次 **SecOC Tx 从 IMMEDIATE 调整为 DEFERRED** 的历史修复为背景，总结一套更通用的排查方法：

> **复杂实时系统的问题，不要只按“模块”排查，而要沿着执行上下文、共享资源和时序依赖去还原。**

## 1. 先分清 Direct 和 IMMEDIATE / DEFERRED

假设一组 CAN FD Tx PDU 配置为：

~~~text
COM:
  周期发送
  Direct = FALSE

SecOC:
  PduProcessing = IMMEDIATE
~~~

这里有两个很容易混淆的概念。

### 1.1 Direct 属于 COM 层

Direct 决定的是 **COM 什么时候发起一次 Tx request**。

~~~text
Signal 更新
   ↓
COM Buffer 更新
   ↓
Direct = FALSE
   ↓
不因为这次更新立即向下发送
   ↓
等待 Com_MainFunctionTx()
   ↓
PduR
   ↓
SecOC_Transmit()
~~~

所以 Direct=FALSE 控制的是发送请求的触发方式，而不是 SecOC 是否延迟处理。

如果 Direct=TRUE，在满足 Transfer Property、Tx Mode 等条件时，Signal 更新可以进一步触发 Direct transmission。

### 1.2 IMMEDIATE / DEFERRED 属于 SecOC 层

SecOC 的配置决定的是：

> **当 SecOC_Transmit() 已经被调用以后，认证和下层发送在哪个上下文执行。**

因此完全可以存在：

~~~text
Direct = FALSE
SecOC = IMMEDIATE
~~~

含义是：COM 仍按周期发起 Tx request，但一旦进入 SecOC_Transmit()，SecOC 会继续在当前调用上下文中同步处理。

## 2. IMMEDIATE 真正“立即”的是什么

历史故障版本的发送链可以抽象为：

~~~text
Core A
周期 COM Task
   ↓
Com_MainFunctionTx
   ↓
PduR
   ↓
SecOC_Transmit
   ↓
构建认证数据
   ↓
Csm_MacGenerate
   ↓
Crypto / HSM
   ↓
PduR_SecOCTransmit
   ↓
CanIf
~~~

关键点是：

> **IMMEDIATE 并不意味着“中断发送”，而是 SecOC 在调用者上下文中继续同步处理。**

如果调用 SecOC_Transmit() 的是 OS Task，那么认证、Crypto/HSM 和下层发送都会占用这个 Task 的运行时间。

这类问题的危险在于：表面只是一次发送 API，内部却可能同步经过一整段安全计算，从而把调用者 Task 的 WCET 显著放大。

因此排查不能停在 SecOC_Transmit()，而要继续向下追：

~~~text
SecOC
→ CSM
→ CryIf
→ Crypto Driver
→ HSM
~~~

## 3. SYNC Crypto 不等于“CPU 自己算完”

看到：

~~~text
CRYPTO_PROCESSING_SYNC
~~~

只能说明从调用者视角看，这个 API 返回时 Job 已完成，并不能说明底层如何完成。

底层可能是 CPU 直接计算，也可能是：

~~~text
CPU提交HSM请求
   ↓
等待HSM
   ↓
HSM返回结果
   ↓
API返回
~~~

等待方式又可能是 interrupt、polling、busy-wait、OS event、semaphore、mailbox 或 shared memory。不同机制对实时性的影响完全不同。

## 4. 一个关键发现：不是中断，而是 busy-wait

继续向 Crypto Driver 深挖，可以看到类似这样的同步等待：

~~~c
while (GetJobState(jobId) == PROCESSING)
{
    Ipc_ReceiveResponse(...);
}
~~~

同时配置为：

~~~text
HSM_INTERRUPT_MODE = OFF
~~~

这说明真正行为不是“提交 HSM 后等待 completion interrupt”，而是：

~~~text
提交 HSM
   ↓
当前 Task 不断轮询 IPC
   ↓
直到 HSM 写回结果
~~~

本质是 **Task context 中的同步 busy-wait**。

这也说明一个很重要的工程原则：缺陷单、提交说明中的“根因”应该先当作线索，而不是最终事实。最终事实要由配置、调用链、OS 映射、Driver 实现和运行时数据共同确认。

## 5. IMMEDIATE → DEFERRED 真正改变了什么

切换到 DEFERRED 后，前半段通常变成：

~~~text
Core A / COM Task
        ↓
SecOC_Transmit
        ↓
复制数据
设置 pending
        ↓
return
~~~

真正的认证和发送由另一个周期 MainFunction 执行：

~~~text
Core B / SecOC Task
        ↓
SecOC_MainFunctionTx
        ↓
Csm_MacGenerate
        ↓
HSM
        ↓
busy-wait response
        ↓
PduR / CanIf
~~~

因此这类修改的本质不是：

~~~text
“立即发送” → “晚一点发送”
~~~

而是：

~~~text
同步重处理
从一个执行上下文
迁移到另一个执行上下文
~~~

在多核系统里甚至可能是从一个 Core 迁到另一个 Core。这意味着它改变的是 **CPU 负载分布、Task WCET、调度关系和共享资源访问时序**。

## 6. 为什么不能只看总 CPU Load

假设 IMMEDIATE 和 DEFERRED 下 MAC 次数、HSM 请求数和报文数都没减少，为什么问题仍可能消失？

因为实时系统更关心的往往不是“总 CPU 负载多少”，而是：

~~~text
哪个Core
哪个Task
哪个优先级
在什么时间
被阻塞了多久
~~~

例如：

~~~text
Before:
Core2 / COM Task
   ↓
同步等待HSM
   ↓
关键通信路径被拖长

After:
Core2 / COM Task快速返回

Core0 / SecOC Task
   ↓
同步等待HSM
~~~

整个 ECU 的计算量可能基本没变，但关键实时路径已经变化。

因此面对“改成 Deferred 就好了”的问题，更准确的问题应该是：

> **原来的阻塞发生在哪个实时关键路径上？**

## 7. 高负载场景要优先找共享资源

如果问题只在大量 Rx 报文持续输入时出现，而 Tx PDU 本身仍是固定周期，那么：

~~~text
Rx报文增加
≠
Tx SecOC调用次数必然增加
~~~

这时应该优先检查 Rx 和 Tx 是否争用了共同资源，例如：

~~~text
Tx SecOC / CmacGenerate
                     → HSM / IPC
          /
Rx SecOC / CmacVerify
~~~

如果 Generate 与 Verify 共用同一个 HSM、CryIf Channel、IPC instance 或有限 job slot，那么高 Rx 负载就可能间接影响 Tx。

候选机制会变成：

~~~text
大量Rx
   ↓
大量SecOC Verify
   ↓
共享HSM资源竞争
   ↓
Tx Generate等待时间增加
   ↓
IMMEDIATE下调用Task busy-wait变长
   ↓
实时关键路径恶化
~~~

这比“Rx 多所以 Tx 也变多”更接近真实系统行为。

## 8. 历史问题必须回到历史版本分析

另一个常见陷阱是：修复已经是历史提交，但排查时拿当前 HEAD 去反推当时的机制。

随着工程演进，Task 所属 Core、周期、ISR affinity、priority、Crypto processing mode、HSM driver、CryIf channel、SecOC MainFunction、CAN Driver、ExclusiveArea 和 PDU 周期都可能变化。

因此建议至少建立三个时间点：

~~~text
T0：故障版本
T1：修复刚合入后的版本
T2：当前HEAD
~~~

根因分析的证据优先级应该是：

~~~text
T0 > T1 >>> T2
~~~

其中 T0 回答“为什么会坏”，T1 回答“修复到底改变了什么”，T2 只用于观察后续演化。

不一定需要 checkout，可以直接：

~~~bash
git show <commit^>:<path>
git show <commit>:<path>
git diff <commit^> <commit>
~~~

这样还能避免当前工作树和重新生成文件污染历史证据。

## 9. 小改动最适合做单变量审计

如果一个修复提交真正的逻辑变化只有：

~~~text
SecOCPduProcessing:
IMMEDIATE → DEFERRED
~~~

而其余都只是生成器派生结果，那么这是很好的控制变量。

建议先把 diff 分成：

~~~text
A. 真正逻辑配置变化
B. 生成器派生变化
C. 其它无关逻辑变化
~~~

只有 C = 0 时，才可以比较有信心地说：故障现象与这个配置变量存在强相关性。

但注意仍然只是相关性。修改后不复现，并不自动等于“已经证明根因就是这个配置”。

## 10. 静态分析什么时候应该停止

静态源码可以回答：

~~~text
谁调用谁
在哪个Core
在哪个Task
配置是什么
共享什么资源
等待机制是什么
修改迁移了什么
~~~

但它不能证明：

~~~text
故障发生前HSM到底慢了多少
Task到底被拖长了多少
哪个Rx报文首先超时
二者时间上是否相关
~~~

当静态链已经达到：

~~~text
大量Rx
 → HSM竞争（候选）
 → 同步等待变长（候选）
 → Task runtime增加（候选）
 → Rx timeout
~~~

就应该停止无限扫源码，转向动态测量。

## 11. 动态验证应该测什么

这类问题最有价值的往往不是大量日志，而是少量时间戳和计数器。

### Crypto / HSM

记录：

~~~text
T0: Csm_MacGenerate enter
T1: HSM request submit
T2: HSM response ready
T3: Csm_MacGenerate return
~~~

得到 HSM 等待时长和 CSM 同步阻塞时长。

### 关键 Task

采集：

~~~text
Com_MainFunctionTx runtime
SecOC_MainFunctionTx runtime
Task activation latency
最大执行时间
~~~

### Rx 侧

必须知道到底哪一条报文首先 lost、真实帧间隔是多少、最后一次 RxIndication 是什么时候、timeout 在什么时候置位。

### A/B Test

至少做：

~~~text
低负载 + IMMEDIATE
高负载 + IMMEDIATE
低负载 + DEFERRED
高负载 + DEFERRED
~~~

如果只切换这个变量，就能稳定复现/消除，再加上运行时曲线能够解释中间机制，根因才真正接近闭环。

## 12. 一套可复用的排查流程

以后再遇到类似问题，可以沿着下面这条路径：

~~~text
1. 定义故障现象
      ↓
2. 找到真正的软件判据
      ↓
3. 回到故障历史版本
      ↓
4. 建立完整调用链
      ↓
5. 标注 Core / Task / ISR / Priority / Period
      ↓
6. 继续追到底层等待和共享资源
      ↓
7. 找高负载下的竞争关系
      ↓
8. 审计修复提交是否单变量
      ↓
9. 建立 Before / After 执行上下文
      ↓
10. 用时间戳和计数器闭合因果链
~~~

其中最值得记住三点：

1. **不要按模块名排查。** 真正运行时可能是 Task → SecOC → CSM → HSM → IPC 的连续执行链。
2. **不要把 API 语义等同于执行机制。** IMMEDIATE ≠ ISR，SYNC ≠ 没有硬件异步过程，DEFERRED ≠ 单纯延迟发送，Direct=FALSE ≠ SecOC Deferred。
3. **不要把修复结果直接当根因证明。** “修改后不复现”首先只能证明变量与问题高度相关，真正的根因还需要机制证据、运行时证据和控制变量实验。

## 13. 总结

一次很小的配置修改，背后可能改变的是整个实时执行模型。

当 SecOC 从 IMMEDIATE 切换到 DEFERRED 时，真正应该问的不是“是不是把报文晚一点发了”，而是：

> **原来哪一段同步工作运行在哪个上下文？现在迁移到了哪里？**

再继续问：

> **这段工作依赖什么共享资源？高负载时谁和它竞争？哪个实时关键路径因此受影响？**

从这个角度看，复杂车载软件问题最有效的排查单位不是“模块”，而是：

~~~text
执行上下文
+
共享资源
+
时序依赖
~~~

只要把这三件事还原出来，很多看似跨模块、跨核、甚至“修复点与故障点完全不在一边”的问题，就会开始变得可解释。
