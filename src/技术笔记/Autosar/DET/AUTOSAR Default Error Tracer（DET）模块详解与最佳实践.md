---
title: AUTOSAR Default Error Tracer（DET）模块详解与最佳实践
date: 2025-06-19
order: 1
isOriginal: true
article: true
timeline: true
categories:
  - AUTOSAR
tags:
  - DET
  - 开发错误追踪
  - 嵌入式软件
  - BSW
---

# AUTOSAR Default Error Tracer（DET）模块详解与最佳实践

> 基于 AUTOSAR R22-11 官方文档，总结 DET（Default Error Tracer）模块设计理念、标准用法及实战建议，适用于嵌入式和汽车软件开发者。

---

## 一、背景与动机

在汽车电子软件开发中，**开发期的接口参数错误、状态误用等问题极易被埋雷**。DET（Default Error Tracer）是 AUTOSAR 标准定义的**开发期错误检测与追踪机制**，用来：

- **捕捉并上报开发时所有 BSW 和部分应用模块的参数与调用错误**
- **为调试与单元测试阶段提供统一的错误钩子和报错链路**

::: warning
DET 仅供开发/验证使用，严禁量产启用！
:::

---

## 二、DET 的能力与应用场景

- **统一的开发错误上报接口**（如 `Det_ReportError`）
- **可配置多级钩子**，支持输出到串口、RAM、外部日志（如 DLT）
- **集成测试和调试阶段的快速错误定位利器**

### 场景举例

```c
if (input == NULL_PTR) {
    Det_ReportError(MODULE_ID_CAN, 0, CAN_API_INIT, DET_E_PARAM_POINTER);
    return E_NOT_OK;
}
````

* `ModuleId`：模块编号
* `ApiId`：API 接口编号
* `ErrorId`：错误类型

---

## 三、DET 模块架构与主要接口

### 1. 初始化与启动

* `void Det_Init(const Det_ConfigType* ConfigPtr)`
* `void Det_Start(void)` （可选，视工程配置决定是否启用）

### 2. 错误上报

* `Std_ReturnType Det_ReportError(uint16 ModuleId, uint8 InstanceId, uint8 ApiId, uint8 ErrorId)`

### 3. 版本信息

* `void Det_GetVersionInfo(Std_VersionInfoType* versioninfo)`

  * 传入空指针会上报 `DET_E_PARAM_POINTER`

---

## 四、错误钩子与日志转发

### 1. 多级钩子配置

* 可为 Det\_ReportError 配置 N 个钩子（Error Hook），全部依次调用
* 钩子函数签名与 Det\_ReportError 相同

### 2. 日志集成

* `DetForwardToDlt`：为 `true` 时会自动转发错误到 DLT（日志模块）

### 3. 配置示例（XML）

```xml
<DetGeneral>
  <DetForwardToDlt>true</DetForwardToDlt>
  <DetVersionInfoApi>true</DetVersionInfoApi>
</DetGeneral>
<DetNotification>
  <DetErrorHook>MyDetErrorHook1</DetErrorHook>
  <DetErrorHook>MyDetErrorHook2</DetErrorHook>
</DetNotification>
```

---

## 五、DET 错误类型与规范

* **只支持开发错误（Development Error）**
* **唯一 DET 自身错误码**：`DET_E_PARAM_POINTER`（用于 Det\_GetVersionInfo 空指针）

---

## 六、工程实践与常见问题

### 1. 最佳实践

* 开发阶段始终启用 DET，量产严格禁用
* 钩子逻辑简单高效，严禁阻塞与递归报错
* 推荐与 DLT、串口等联动，仅限调试时打开
* 严格规范 ModuleId、ApiId、ErrorId 的文档说明，便于定位

### 2. 反面案例

* 误将 DET 用于生产环境异常处理
* 钩子死循环或递归报错导致栈溢出

---

## 七、报错调用链与序列图

1. **有钩子**：Det\_ReportError → 顺序调用所有 Error Hook →（可选）转发到 DLT
2. **无钩子**：自身处理 →（可选）转发到 DLT，无额外动作

---

## 八、典型钩子函数模板

```c
void MyDetErrorHook(uint16 ModuleId, uint8 InstanceId, uint8 ApiId, uint8 ErrorId) {
    // 仅用于开发调试，建议串口/内存打印
    printf("[DET] Module:%u, Api:%u, Error:%u\n", ModuleId, ApiId, ErrorId);
    // 注意避免阻塞和递归调用！
}
```

---

## 九、参考资料

* [AUTOSAR SWS Default Error Tracer R22-11](https://www.autosar.org/fileadmin/standards/R22-11/CP/AUTOSAR_SWS_DefaultErrorTracer.pdf)
* AUTOSAR General Specification of Basic Software Modules
* AUTOSAR Diagnostics Requirements

---
