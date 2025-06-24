---
title: VectorCAST 原理与实战指南
date: 2025-06-25
order: 1
isOriginal: true
article: true
timeline: true
categories:
  - AUTOSAR
  - 嵌入式软件测试
  - 软件工程实践
  - 安全认证
tags:
  - VectorCAST
  - 单元测试
  - 覆盖率分析
  - SBF
  - MC/DC
  - Jenkins 集成
  - AUTOSAR Com 模块
  - C语言
  - 嵌入式开发
---

> 本文基于官方文档与实际使用经验，全面总结 VectorCAST 的原理、工作流程及在 C 语言单元测试中的实战技巧，适合车规、航电、医疗软件等高安全要求领域。

---

## 一、什么是 VectorCAST？

VectorCAST 是一套自动化单元测试与覆盖率分析工具，广泛用于嵌入式系统开发。它支持多种语言（C/C++/Ada）及高安全要求认证（如 ISO 26262、DO-178C）。

### 支持的核心模块：

| 模块                | 说明              |
| ----------------- | --------------- |
| VectorCAST/C      | C 语言单元测试        |
| VectorCAST/C++    | C++ 单元测试        |
| VectorCAST/QA     | 系统测试与回归测试整合     |
| VectorCAST/RSP    | 目标平台运行支持（如 ECU） |
| VectorCAST/Cover  | 覆盖率收集           |
| VectorCAST/Manage | 多测试环境统一管理       |

---

## 二、原理概览

### 1. 测试流程

1. 解析源代码，提取函数接口
2. 自动生成测试驱动、桩函数（SBF）与测试框架
3. 用户编写测试用例或使用 GUI 添加测试
4. 编译运行并生成结果与覆盖率报告

### 2. 覆盖率类型

| 类型        | 说明                        |
| --------- | ------------------------- |
| Statement | 行覆盖：每条语句是否执行              |
| Branch    | 分支覆盖：if/else 等分支的每个路径是否覆盖 |
| MC/DC     | 修改条件/判定覆盖：每个条件必须独立影响判定    |

> ✅ MC/DC 是航空、车规等高安全等级软件认证要求的标准覆盖率类型。

---

## 三、使用指南（C语言）

### 1. 创建测试环境

#### GUI 方式：

```bash
File > New Environment > Language: C
```

* 添加源文件（如 math.c）和头文件（math.h）
* 配置编译器选项或使用 Makefile
* 系统自动生成测试框架

#### 宏控制代码可见性：

若函数被宏包裹：

```c
#ifdef ENABLE_FEATURE
int foo() {...}
#endif
```

需要在编译参数中启用宏：

```bash
-DENABLE_FEATURE
```

位置：`Environment > Compilation Options`

### 2. 添加测试用例

* 在 GUI 中右键函数 > Add Test Case
* 输入参数、期望返回值
* 可添加断言与注释

### 3. 执行测试

* 点击 Run Test Cases
* 查看每个用例的通过/失败状态

### 4. 覆盖率查看

* 菜单：Code Coverage > Show Coverage
* 支持语句、分支、MC/DC 多种视图

---

## 四、SBF（Stub-Based Function）机制

SBF 是 VectorCAST 自动生成的桩函数，用于：

| 用途      | 示例                      |
| ------- | ----------------------- |
| 模拟依赖返回值 | read\_sensor() 始终返回 25  |
| 隔离外部模块  | malloc() 返回 NULL 模拟错误路径 |
| 捕获调用信息  | 检查函数是否被调用、调用次数          |

通过 GUI 或脚本可配置返回值与参数记录，帮助精准控制依赖行为。

---

## 五、Test Log Script 与调试技巧

### 常见错误：

```text
expected a field name from the record type ccast_xxx
```

#### 解决方法：

* 确认访问的字段是否拼写正确
* 使用 `parray record_var` 或 `array names record_var` 查看合法字段
* 示例：

```tcl
set result [testlog_get_call_result "foo"]
puts $result(return_value) ;# 正确访问字段
```

---

## 六、Metrics Report：质量评估报告

通过 Metrics Report 可视化查看：

* 测试覆盖率（Statement/Branch/MC/DC）
* 用例通过/失败情况
* 函数复杂度（Cyclomatic Complexity）
* 未执行或失败的测试用例过滤（toggle to display only failing and unexecuted testcases）

---

## 七、进阶实践建议

| 场景         | 建议                                 |
| ---------- | ---------------------------------- |
| 多版本代码（不同宏） | 建立多个测试环境分别验证                       |
| 安全认证项目     | 启用 MC/DC，保留完整报告轨迹                  |
| 自动化        | 使用 CLI 命令 `vcast` + CI 工具如 Jenkins |
| 集成测试       | 配合 VectorCAST/QA 使用真实集成路径          |

---

## 八、CLI 常用命令参考

```bash
# 创建环境
vcast create_env -e math_env -u math.c -h math.h -c gcc

# 添加测试用例
vcast add_test_case -e math_env -f add -i "a=1,b=2" -o "return=3"

# 执行测试
vcast run_tests -e math_env

# 导出覆盖率报告
vcast generate_metrics -e math_env -f report.html
```

---

## 九、AUTOSAR 案例接入

在测试 AUTOSAR BSW 模块（如 Com、Can、Dem）时：

1. 将待测 `.c/.h` 文件导入环境中，选择 Enable RTE Stub 配置
2. 使用 VectorCAST Stub 功能打桩 RTE 生成的接口函数（如 `Rte_Read_xxx`, `Rte_Call_xxx`）
3. 设置宏（如 `-DAUTOSAR_VERSION=403`, `-DRTE_CORE`）
4. 若涉及 ECU extract，可通过 VectorCAST/RSP 在目标板执行回归测试
5. 与配置工具（如 DaVinci Developer）配合生成头文件结构

---

## 十、Com 模块测试实战

Com 模块是 AUTOSAR 通信栈的重要组成部分，涉及信号传输、PDU 映射、回调函数等。

### 步骤示例：

1. **导入 Com 源码及配置头文件**

   * 如 `Com.c`, `Com.h`, `Com_Types.h`, `Com_Cfg.h`

2. **设置宏定义以激活对应配置**

   * 例如 `-DCOM_SIGNAL_COUNT=10 -DCOM_VERSION=403`

3. **Stub 掉外部依赖接口函数**

   * 如 `Com_SendSignal`, `PduR_ComTransmit`, `SchM_Enter_Com_...`
   * 配置返回值、调用次数断言

4. **测试目标函数示例**

   * `Com_SendSignal`：测试信号值写入是否正确
   * `Com_MainFunctionTx`：模拟周期调度，检查 PDU 是否被触发

5. **设计测试用例场景**

   * 正常路径：信号变化导致发送
   * 边界路径：信号未变化或缓冲满
   * 异常路径：RTE 或 PduR 返回错误

6. **覆盖率目标**：建议启用 MC/DC，重点覆盖判断逻辑、配置判定宏。

---

## 十一、多环境测试矩阵管理

使用 VectorCAST/Manage 管理多个环境（不同模块、不同宏开关）时：

1. 配置每个环境对应源文件、宏组合
2. 设置环境属性和组标签（如 `ASW`, `BSW`, `ASIL_D`, `Debug`）
3. 支持批量运行和批量报告导出
4. 通过 Coverage Aggregation 汇总多个环境的覆盖率

> 适用于功能矩阵较多的车规项目、平台库或配置切换测试。

---

## 十二、与 Jenkins 等 CI 工具集成

将 VectorCAST 融入 Jenkins 流水线：

1. 在构建脚本中调用 `vcast` CLI 进行环境创建、测试执行与报告导出
2. 使用 `JUnit XML` 插件或 HTML 报告插件展示测试结果
3. 可配置静态分析、代码覆盖、Metrics 报告导入到 Jenkins Dashboard
4. 支持与 Git、SVN 联动进行增量测试与回归验证

示例流水线片段（Shell）：

```bash
vcast create_env -e core_env -u core.c -h core.h -c gcc
vcast run_tests -e core_env
vcast generate_metrics -e core_env -f report.html
```

---

## 十三、总结

VectorCAST 是一个功能强大的 C 单元测试平台，尤其适用于高安全场景。掌握宏控制、SBF 桩机制、MC/DC 分析、Metrics 报告，以及日志脚本调试技巧，可显著提升测试质量和效率。
