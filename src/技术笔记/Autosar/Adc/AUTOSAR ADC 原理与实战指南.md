---
title: AUTOSAR ADC 原理与实战指南
date: 2025-07-01
order: 1
isOriginal: true
article: true
timeline: true
categories:
  - AUTOSAR
  - 嵌入式开发
  - 驱动开发
tags:
  - ADC
  - MCAL
  - EB tresos
  - ECU
  - 汽车电子
  - AUTOSAR标准
  - 模拟信号采集
  - 软件触发
  - 硬件抽象
---

## 第一章 ：概览

AUTOSAR 架构中，**ADC (Analog to Digital Converter)** 模块是最基础也是最重要的硬件抽象层之一，它将现实世界中的模拟信号转换为ECU可读取的数字值，是环境感知和内部调控系统的关键一环。

---

## 第二章 ：模块位置与组成

ADC 模块属于 BSW 底层中的 **MCAL (Microcontroller Abstraction Layer)** 层，为上层模块提供不依赖 MCU 硬件细节的方便仅接接口，一般和 IoHwAb 、 BSWM 、 DEM 等互动。

实际环境中举例：

* EB tresos 或 Vector DaVinci 中通过 **AdcGeneral / AdcHwUnit / AdcGroup / AdcChannel** 进行配置
* 和 IO 相关的实体通路 (如NTC、电动阀位、压力传感器) 连接

---

## 第三章 ：核心配置结构

### Adc\_ConfigType

总体配置结构，启动时传入 Adc\_Init()

```c
const Adc_ConfigType AdcConfig = {
  .GroupConfigPtr = &AdcGroupConfig,
  .HwUnitAssignment = {ADC_HWUNIT_0, ADC_HWUNIT_1},
  ...
};
```

### Adc\_GroupConfigType

每一个接收组量输入的配置：

```c
typedef struct {
  Adc_GroupType GroupId;
  Adc_TriggerSourceType TriggerSource;
  Adc_ConversionModeType ConversionMode;
  Adc_AccessModeType AccessMode;
  Adc_StreamBufferModeType BufferMode;
  Adc_PriorityType GroupPriority;
  Adc_ChannelType* ChannelList;
  Adc_ValueGroupType* ResultBufferPtr;
  void (*Notification)(void);
} Adc_GroupConfigType;
```

---

## 第四章 ：工作模式详解

| 分类   | 选项           | 说明             |
| ---- | ------------ | -------------- |
| 进入触发 | 软件触发 / 硬件触发  | PWM 或定时器为硬件触发源 |
| 转换模式 | 单次 / 连续      | 按需重复采样         |
| 结果存储 | 线性 / 环形缓冲    | 冲紧控制采样流程       |
| 读取模式 | 单次读取 / 流水线读取 | 可读取多段历史数据      |

---

## 第五章 ：标准 API 说明

AUTOSAR 定义了标准化接口用于控制 ADC 模块的生命周期与数据交互：

### `Adc_Init`

```c
void Adc_Init(const Adc_ConfigType* ConfigPtr);
```

> 作用：初始化 ADC 模块，加载配置参数。
> 注意：只能调用一次，通常在系统启动阶段调用。

---

### `Adc_DeInit`

```c
void Adc_DeInit(void);
```

> 作用：关闭 ADC 模块，释放资源。
> 注意：调用后模块不可再使用，需重新 Init 才能恢复。

---

### `Adc_StartGroupConversion`

```c
Std_ReturnType Adc_StartGroupConversion(Adc_GroupType Group);
```

> 作用：启动指定采样组的转换过程。
> 如果是硬件触发组，调用后等待外设触发；软件触发则立即开始。

---

### `Adc_StopGroupConversion`

```c
Std_ReturnType Adc_StopGroupConversion(Adc_GroupType Group);
```

> 作用：终止采样任务，通常用于中止连续转换模式或错误中断处理。

---

### `Adc_ReadGroup`

```c
Std_ReturnType Adc_ReadGroup(Adc_GroupType Group, Adc_ValueGroupType* DataBuffer);
```

> 作用：读取采样组的转换结果。
> 对于流采样模式，此函数读取最近一组有效值。

---

### `Adc_GetGroupStatus`

```c
Adc_StatusType Adc_GetGroupStatus(Adc_GroupType Group);
```

> 返回当前采样组的状态：

* `ADC_IDLE`
* `ADC_BUSY`
* `ADC_COMPLETED`
* `ADC_STREAM_COMPLETED`

---

### 示例流程：软件触发+同步采样

```c
Adc_Init(&AdcConfig);
Adc_StartGroupConversion(BATTERY_GROUP);
while (Adc_GetGroupStatus(BATTERY_GROUP) != ADC_STREAM_COMPLETED);
Adc_ReadGroup(BATTERY_GROUP, BatteryBuffer);
```

---

## 第六章 ：实际工程场景

### 1. BMS / 电池管理系统

* 单体电压、电流、NTC 温度
* 依赖 ADC 接口获取元件数据

### 2. 车辆成组部件

* CAN 、 LIN 通信线路电压监控
* 旋钮电位器输出线型电压

### 3. 安全性分析

* 双通道输入同步根控检查
* 压力传感器重复触发验证

---

## 第七章 ：开发细节 & 应用要点

* 硬件输入应对应 ADC Channel
* ADC 触发后输出动作是否需要 Notification
* DMA 如支持，需配合 MCU 配置
* 无 RTOS 环境下可通过轮询进行简单防锁
* Safety Level ASIL 下需考虑连续重复验证和疯检：

在功能安全等级（ASIL）要求下，ADC 模块需具备故障检测和冗余采样能力以满足 ISO 26262 标准。

* **连续重复验证**：对同一物理信号在短时间内进行多次采样，并对结果差值进行阈值判断，确保采样值稳定不跳变。

  * 例如：每 10ms 连续采样 2 次，若差值超过 ±5mV，则判定为异常。

* **通道冗余校验**：同一个传感器信号连接至两个 ADC 通道，分别采样并对比其一致性。

* **量程越界检测**：检测是否发生过压/欠压，识别传感器断路、短路、漂移等故障。

* **采样周期监控**：检测 ADC 是否按时完成采样任务，若延迟过大则触发采样失效错误。

* **交错触发一致性检查**：使用软件触发和硬件触发进行交替采样，对比两类结果的一致性。

* **开路与短路诊断**：针对电压值达到极值（如0V或5V）时进行进一步诊断分析。

这些机制可通过软件逻辑或硬件支持实现，并与 DEM、WDG、ASIL 警告机制联动，提升系统鲁棒性。

---
