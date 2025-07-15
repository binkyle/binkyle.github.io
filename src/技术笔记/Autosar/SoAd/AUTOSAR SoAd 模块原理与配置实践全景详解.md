---
title: AUTOSAR SoAd 模块原理与配置实践全景详解
order: 1
date: 2025-07-16
categories:
  - AUTOSAR
  - Automotive Ethernet
tags:
  - SoAd
  - Socket Adapter
  - AUTOSAR Classic
  - TCP/IP
  - DoIP
  - SOME/IP
  - PduRouter
  - XCP over Ethernet
  - UDP
  - TCP
  - Configuration
  - Diagnostic
  - 网络通信
  - 多播广播
  - Vector DaVinci
  - EB tresos
  - PDU 路由
  - RoutingGroup
  - TP/IF 接口
isOriginal: true
article: true
timeline: true
---

## 1. SoAd 概述

Socket Adaptor (SoAd) 是 AUTOSAR 中负责基于 TCP/UDP 协议进行通信的基础软件模块。它充当在 AUTOSAR 静态通信（I-PDU）与动态 Socket 通信之间的适配层，实现对 TCP/IP Socket 的管理和 PDU 传输。SoAd 的主要功能包括：

* 将 Socket 连接映射到一个或多个 I-PDU（可选地带有 SoAd 自定义的 PDU 头，用于聚合多个 PDU）。
* 通过上层模块的请求或自动配置来打开/关闭 Socket 连接（API 调用 `SoAd_OpenSoCon`/`SoAd_CloseSoCon`），并在周期性 `SoAd_MainFunction` 中执行连接管理。
* 提供 Socket 恢复和断开策略，实现断线重连等功能。
* 定义消息接收过滤策略，指定通过 TCP 或 UDP 接收哪些远端报文。
* 支持 PDU 路由组概念，允许对一组 PDU 的路由进行使能/失能控制。
* 通过 IF-API（接口）和 TP-API（传输协议）向上层模块提供 PDU 的发送与接收，支持多种交付语义和粘包/拆包逻辑。
* 支持 PDU 扇出：一个 IF-PDU 可以被发送到多个 Socket 连接，或者一个接收报文可以拆分成多个 IF-PDU 分发给不同上层。

**SoAd 的应用场景：** 上层通信模块（如 PduR、DoIP、SOME/IP、XCP、SD、UDP NM 等）通过 SoAd 与 TCP/IP Stack 交互。这些模块通过 PDU Router 向 SoAd 发送要发送的 I-PDU（调用 SoAd\_IfTransmit 或 SoAd\_TpTransmit），或从 SoAd 接收数据（SoAd 调用上层的 RxIndication/TpRxIndication），完成数据收发。以 DoIP 为例，DoIP 模块会通过 SoAd 在 TCP 连接上传输诊断报文；SOME/IP 中的服务发现通常通过 UDP 组播完成，也由 SoAd 处理；XCP over Ethernet 使用 SoAd 的 UDP 或 TCP 连接发送标定数据等。

**SoAd 的局限性：** SoAd 将传统 Socket 通信适配为 AUTOSAR 静态方式，因此存在一些限制：

* **通信开销：** TCP/UDP 协议头约 60 字节，对于小 PDU 开销较大。为此 SoAd 支持可选的 PDU 头格式，将多个 PDU 聚合到一个 Socket 传输中。
* **地址和端口管理：** TCP/UDP 的端口号和 IP 地址由用户通过配置或上层模块（如 DHCP）设定，SoAd 本身不生成或分配这些值，但必须使用这些参数来完成 socket 的初始化与通信绑定。
* **协议检查：** SoAd 不会验证 SOME/IP 协议版本和接口版本（尽管规范建议应检查），仅会检查 Service/Method ID 的合法性，否则返回错误。
* **物理层：** SoAd 不定义物理层或链路速率，依赖底层网络接口完成数据传输。

综上，SoAd 将 AUTOSAR 的静态 PDU 路由与 TCP/IP 动态连接结合起来，使得传统基于 Sockets 的协议（如 DoIP、SOME/IP、XCP 等）能够在 AUTOSAR BSW 中以可配置的方式使用。

## 2. SoAd 与其他模块的依赖关系

从架构上看，SoAd 位于 PduR（PDU 路由）与 TcpIp（TCP/IP 协议栈）之间，如下图所示（图示参考 AUTOSAR 文档）：

* **上层模块：** SoAd 的上层通信模块包括 PduR、Diagnostics over IP (DoIP)、Service Discovery (SD)、UDP 网络管理 (UDP NM)、XCP 等。这些模块与 SoAd 交互时，会通过 PDU Router 将 I-PDU 传递给 SoAd（发送）或接收来自 SoAd 的数据。SoAd 针对不同上层的特性（IF 或 TP 接口）进行封装处理。
* **下层模块：** SoAd 与 `TcpIp` 模块紧密配合，`TcpIp` 负责底层的 socket API 调用（如绑定端口、监听、发送、接收等）。SoAd 通过对 `TcpIp` 的调用完成 Socket 打开/关闭、数据发送等操作。
* **辅助模块：** 以太网状态管理器（EthSM）用于控制 SoAd 的状态机，如当网络接口上线/下线时通知 SoAd。IDS 管理器（IdsM）可用于上报安全事件（例如不合法数据包等）。

从上层依赖角度看，SoAd 是多种基于以太网协议服务的桥梁，其与其他模块的关系可归纳为：**PduR、DoIP、SOME/IP、XCP、SD** 等上层通过 SoAd 与 TCP/IP 栈连接，SoAd 将这些模块的 PDU 路由到具体的 Socket。

## 3. SoAd 支持的通信场景

SoAd 支持 **TCP、UDP、广播、组播** 等多种以太网通信形式，下层 `TcpIp` 栈在实现层面上对这些通信方式进行处理，SoAd 根据配置决定如何使用它们：

* **TCP（面向连接）：** SoAd 在配置中指定使用 TCP 协议（在 `SoAdSocketProtocol` 选择 `SoAdSocketTcp`）。典型场景如 DoIP，诊断模块通过配置一个 TCP 端口（如 13400）与对端建立连接。SoAd 通过 `SoAdSocketConnection` 指定远端地址（IP/端口），并可根据 `SoAdSocketAutomaticSoConSetup` 参数决定是否自动建立。TCP 保证可靠性与有序传输，适合需要确认和完整性的协议。SoAd 的状态机会根据 TCP 连接的建立/断开触发回调。

* **UDP（无连接）：** SoAd 在配置中指定使用 UDP（`SoAdSocketUdp`）。UDP 通信无需连接，支持广播/组播。典型场景包括 SOME/IP 报文、SOME/IP 服务发现（SD）使用的组播地址、XCP over Ethernet（可用 UDP）等。UDP 传输不保证可靠性，适用于广播或非关键控制信息。SoAd 中常用参数：

  * `SoAdSocketnPduUdpTxBufferMin`：指定在一个 UDP 分组中聚合多 PDU 数据时的最小缓冲长度。如果开启聚合（例如多 PDU 打包），SoAd 将累积到此阈值或触发条件下才发送。
  * `SoAdSocketUdpAliveSupervisionTimeout`：用于模拟“连接”的超时时间。配置时表示在多长时间内未收到对端数据后，SoAd 将置该 UDP “连接”为下线状态。这对应用层管理节点在线性有帮助。
  * **广播/组播：** 若需要广播，可以将 `SoAdSocketRemoteAddress` 配置为广播地址（例如 255.255.255.255）并启用接受过滤。组播地址（如 SOME/IP SD 的 224.x.x.x）在配置中填写组播 IP 和端口，上层需在 `TcpIp` 模块中订阅该组播。SoAd 会把从组播到达的数据路由给相应的上层 PDU。

* **广播（Broadcast）：** 在 UDP 通信中，如需向局域网广播消息，将远端地址设置为全广播地址，同时配置 `SoAdSocketMsgAcceptanceFilterEnabled` 为 `TRUE`，以接受任何源地址的数据。广播常见于如 UDP 网络管理（UART-NM）或某些自定义协议。

* **组播（Multicast）：** SoAd 配置使用组播 IP（IPv4：224.0.0.0/4，IPv6：FF00::/8）和端口。典型如 SOME/IP 的服务发现，使用固定组播地址和端口。SoAd 并不直接管理底层组播路由，通常需要在 `TcpIp` 中设置网络接口组播订阅。SoAd 只负责将收到的组播数据包作为上行 PDU 处理，按配置转发给上层。

* **UDP 通信的特点：** SoAd 对 UDP 并不进行可靠性保证。如果需要检测远端是否在线，可借助 `SoAdSocketUdpAliveSupervisionTimeout`。此外，SoAd 支持多路复用，多个 SoAdPduRouteDest 可以指向同一个 UDP Socket 连接（通过设置不同的 `SoAdRoutingGroup` 来区分不同的上层应用）。

* **SoAd 重传与顺序：** 对于 UDP，SoAd 不会自动重发丢失数据、也不保证接收顺序。需要重传时上层需自行处理。TCP 则内建重传和顺序保证。SoAd 只负责在 TCP 连接中转发完整的 I-PDU。

## 4. SoAd 配置容器详解

AUTOSAR 的 ECU 配置（ECU Configuration）中，SoAd 模块的配置容器组织结构如图 6 所示：顶层容器为 `SoAdConfig`，其下包含多个 `SoAdSocketConnectionGroup`，以及可选的 `SoAdPduRoute`、`SoAdSocketRoute`、`SoAdRoutingGroup` 子容器。

```
SoAdConfig  
├─ SoAdSocketConnectionGroup (1..*)  
├─ SoAdPduRoute (0..*)  
├─ SoAdSocketRoute (0..*)  
└─ SoAdRoutingGroup (0..*)  
```

这些容器的作用分别是：`SoAdSocketConnectionGroup` 定义一组 Socket 连接及其公共参数；`SoAdSocketConnection` (子容器) 定义单个连接的具体信息；`SoAdSocketProtocol` 定义组内采用的传输协议（TCP 或 UDP）及相关参数；`SoAdPduRoute` 定义从上层到 Socket 的 PDU 路径；`SoAdPduRouteDest` 是发送目的地配置；`SoAdSocketRoute` 和 `SoAdSocketRouteDest` 则定义从 Socket 到上层的接收路径；`SoAdRoutingGroup` 定义 PDU 路由组以支持动态使能/失能。

下面逐个介绍关键容器和参数：

### 4.1 SoAdSocketConnectionGroup

`SoAdSocketConnectionGroup` 容器规定了一组 Socket 连接的共有配置。一个组内可以包含多个具体的 `SoAdSocketConnection`，它们共享下列参数：

* **SoAdPduHeaderEnable** (Boolean): 是否在每个传输报文前插入 SoAd 自定义 PDU 头（包含 PDU ID 和长度）。设置为 `TRUE` 时，SoAd 会在 Socket 发送的数据前加上头部，可用于分包、PDU 聚合等；为 `FALSE` 时不使用自定义头。
* **SoAdSocketAutomaticSoConSetup** (Boolean): 指定 Socket 连接是否自动建立。`TRUE` 表示在运行时根据地址配置自动打开连接；`FALSE` 表示需调用 `SoAd_OpenSoCon()` 手动触发建立。
* **SoAdSocketLocalAddressRef**: 本地 IP 地址的引用（符号名称），指定该组连接的本地网络接口。
* **SoAdSocketLocalPort**: 本地端口号，所有组内连接使用该本地端口（通常为 TCP/UDP 监听端口）。
* **SoAdSocketMsgAcceptanceFilterEnabled** (Boolean): 是否启用数据包过滤。若启用，SoAd 只接受符合配置 `SoAdSocketRemoteAddress` 的报文；若禁用则接受任意来源地址的数据。对于使用任意地址通配符（0.0.0.0）的情形，此项必须为 `TRUE`。
* **SoAdSocketPathMTUEnable**: 是否启用 Path MTU 发现（TCP/IP 层参数）。
* **SoAdSocketSoConModeChgNotification** (Boolean): 是否在连接状态改变时通知上层（调用 `<UpperLayer>_SoConModeChg` 回调）。设置为 `TRUE` 时，当 Socket 连接建立或断开时，SoAd 会调用上层 `SoConModeChg` 函数。
* **SoAdSocketTpRxBufferMin**: 当使用 TP-API 时，SoAd 在 Socket 上接收每个 PDU 至少要有的缓冲区大小（字节）。
* **其它高级参数**：包括 VLAN 优先级 (`SoAdSocketVlanPriority`)、DSCP 字段 (`SoAdSocketDifferentiatedServicesField`)、TCP 的 KeepAlive 超时、UDP 的 Alive 超时等。

*示例配置片段*：

```xml
<SoAdSocketConnectionGroup>
  <SoAdPduHeaderEnable>true</SoAdPduHeaderEnable>
  <SoAdSocketAutomaticSoConSetup>false</SoAdSocketAutomaticSoConSetup>
  <SoAdSocketSoConModeChgNotification>true</SoAdSocketSoConModeChgNotification>
  <SoAdSocketLocalAddressRef>LocalAddr_Eth0</SoAdSocketLocalAddressRef>
  <SoAdSocketLocalPort>13400</SoAdSocketLocalPort>
  ...
  <!-- 后续配置子元素 SoAdSocketConnection 等 -->
</SoAdSocketConnectionGroup>
```

### 4.2 SoAdSocketConnection

`SoAdSocketConnection` 子容器定义具体的 Socket 连接。每个连接都要指定：

* **SoAdSocketId** (SoConId): 该连接的唯一标识符，用于上层 API 调用（SoConId 类型）。
* **SoAdSocketRemoteAddress**: 一个子容器，用于指定远端地址信息，包括：

  * `SoAdSocketRemoteIpAddrRef`（远端 IP 地址引用）；
  * `SoAdSocketRemotePortNo`（远端端口号）。
    如果不在配置中定义此远端地址，应用程序可以在运行时调用 `SoAd_SetRemoteAddr()` 动态设置。

*示例配置片段*：

```xml
<SoAdSocketConnection>
  <SoAdSocketId>0</SoAdSocketId>
  <SoAdSocketRemoteAddress>
    <SoAdSocketRemoteIpAddrRef>RemoteAddr_TargetECU</SoAdSocketRemoteIpAddrRef>
    <SoAdSocketRemotePortNo>13400</SoAdSocketRemotePortNo>
  </SoAdSocketRemoteAddress>
</SoAdSocketConnection>
```

一个 `SoAdSocketConnectionGroup` 中可包含多个此类 `SoAdSocketConnection`，用于配置一个组内的多个连接（例如一个多路广播组或多个目标服务器）。

### 4.3 SoAdSocketProtocol（TCP/UDP 参数）

`SoAdSocketProtocol` 是一个选择容器，用以指定当前连接组使用的传输协议。其子选项为 `SoAdSocketTcp` 或 `SoAdSocketUdp`：

* **SoAdSocketTcp**：如果使用 TCP，该容器用于配置与 TCP 相关的参数（如 Listen、Connect 超时等，AUTOSAR SWS 中常规 TCP 参数由 `TcpIp` 模块管理，在 SoAd 配置中通常少量设置）。
* **SoAdSocketUdp**：如果使用 UDP，该容器可包含：

  * `SoAdSocketnPduUdpTxBufferMin`：指定 SoAd 缓冲多少数据后组成一个 UDP 报文发送（包含上层数据和可选的 PDU 头）。如果启用了多个 PDU 捆绑，此值决定何时触发发送。
  * `SoAdSocketUdpAliveSupervisionTimeout`：指定在多长秒内未收到远端数据后将该 UDP “连接”视为下线（超时时间）。如果此参数未配置，则关闭存活检测。
  * 其它可能的参数：多播组播地址（可能在 SoAdSocketConnection 中配置）、是否仅监听（`SoAdSocketUdpListenOnly`）、发送TTL/ToS 等。

示例：

```xml
<SoAdSocketProtocol>
  <SoAdSocketUdp>
    <SoAdSocketnPduUdpTxBufferMin>256</SoAdSocketnPduUdpTxBufferMin>
    <SoAdSocketUdpAliveSupervisionTimeout>30.0</SoAdSocketUdpAliveSupervisionTimeout>
  </SoAdSocketUdp>
</SoAdSocketProtocol>
```

### 4.4 SoAdPduRoute 与 SoAdPduRouteDest

`SoAdPduRoute` 容器定义从上层模块到 Socket 的发送路径（“PDU 路由”），即当上层请求发送某 IF/TP-PDU 时，SoAd 将其路由到哪个 Socket 连接。关键配置参数有：

* **SoAdTxPduId**：上层发送时使用的 PDU ID（来自 PduR 或 COM），SoAd 通过此 ID 查找配置的路由。
* **SoAdTxUpperLayerType**：指定上层接口类型，`IF` 表示使用接口 API 发送，`TP` 表示使用传输协议 API。
* **SoAdTxPduRef**：指向全局 PDU 对象的引用，表示要发送的 PDU 数据的定义。

每个 `SoAdPduRoute` 包含一个或多个 `SoAdPduRouteDest` 容器（允许 IF-PDU 的扇出）。`SoAdPduRouteDest` 指定具体的发送目标以及更多参数：

* **SoAdTxPduHeaderId**：如果启用了 PDU 头 (`SoAdPduHeaderEnable`)，则此值作为该 PDU 在网络上的标识。
* **SoAdTxRoutingGroupRef**：引用一个 `SoAdRoutingGroup`（可选），指明此路由所属的路由组，便于动态使能/禁用。
* **SoAdTxSocketConnOrSocketConnBundleRef**：选择一个具体的 `SoAdSocketConnection` 或 `SoAdSocketConnectionGroup`，指定该 PDU 应发送到哪个 Socket（如果不选择组内全部）。
* **SoAdTxUdpTriggerMode**：仅对 UDP 有效，指定触发模式：`TRIGGER_ALWAYS`（始终触发发送）、`TRIGGER_NEVER`（非触发模式，缓冲到达阈值时发送）。
* **SoAdTxUdpTriggerTimeout**：UDP 下触发模式的超时值，超过此时间会强制发送缓冲内容。

另外，`SoAdPduRoute` 本身有一个重要参数 `SoAdTxPduCollectionSemantics`，用于控制数据收集策略：

* `SOAD_COLLECT_QUEUED`：立即将上层提供的数据存储在 SoAd 缓冲区中。（默认模式）
* `SOAD_COLLECT_LAST_IS_BEST`：只有在即将发送时，通过触发传输 (`TriggerTransmit`) 获取最新数据，用于替代或更新之前缓冲的数据。此模式常用于使用 `SoAd_TriggerTransmit` 的场景。

*示例配置片段*：

```xml
<SoAdPduRoute>
  <SoAdTxPduId>Diag_DoIP_TxPdu</SoAdTxPduId>
  <SoAdTxUpperLayerType>TP</SoAdTxUpperLayerType>
  <SoAdTxPduRef>PduR_Diag_DoIP_Tx</SoAdTxPduRef>
  <SoAdPduRouteDest>
    <SoAdTxPduHeaderId>4660</SoAdTxPduHeaderId>
    <SoAdTxRoutingGroupRef>DefaultGroup</SoAdTxRoutingGroupRef>
    <SoAdTxSocketConnOrSocketConnBundleRef>SockConnGroup_DoIP</SoAdTxSocketConnOrSocketConnBundleRef>
    <SoAdTxUdpTriggerMode>TRIGGER_ALWAYS</SoAdTxUdpTriggerMode>
    <SoAdTxUdpTriggerTimeout>0.05</SoAdTxUdpTriggerTimeout>
  </SoAdPduRouteDest>
</SoAdPduRoute>
```

### 4.5 SoAdSocketRoute 与 SoAdSocketRouteDest

`SoAdSocketRoute` 容器定义从 Socket 到上层模块的接收路径（“Socket 路由”）。配置描述了当 Socket 接收到报文后，应将其传递给哪一个上层 PDU。主要配置项有：

* **SoAdSocketIdRef**：引用一个 `SoAdSocketConnection` 或组，表示此路由关联到哪个 Socket 连接。
* **SoAdSocketRouteDest**：每个路由可有一个或多个目的地条目（针对 IF-接口可以多个，多路径分发时使用不同的 `RoutingGroup` 区分）。`SoAdSocketRouteDest` 包含：

  * **SoAdRxPduId**：上层接收时使用的 PDU ID。SoAd 收到数据后会以此 ID 调用上层的 Rx Indication。
  * **SoAdRxUpperLayerType**：上层接口类型，`IF` 或 `TP`。例如 XCP 使用 TP 接口。
  * **SoAdRxPduRef**：引用全局 PDU 定义，指示接收数据要填充的 PDU。
  * **SoAdRxRoutingGroupRef**：引用一个路由组（可选），用于实现多个上层实例接收不同报文。
  * **SoAdRxPduHeaderId**（可选）：如果启用了 PDU 头，此处指示预期接收报文的头部 ID，用于过滤匹配。

上述配置含义如 AUTOSAR 规范所述：“**SoAdSocketRoute** 描述了从 TCP/UDP Socket 接收到的 PDU 到 SoAd 上层的路径”。“**SoAdSocketRouteDest** 描述了在接收到一个 Socket 报文后将其作为哪个上层 PDU 转发”。

*示例配置片段*：

```xml
<SoAdSocketRoute>
  <SoAdSocketIdRef>0</SoAdSocketIdRef>
  <SoAdSocketRouteDest>
    <SoAdRxPduId>DoIP_Rx_Pdu</SoAdRxPduId>
    <SoAdRxUpperLayerType>TP</SoAdRxUpperLayerType>
    <SoAdRxPduRef>PduR_DoIP_Rx</SoAdRxPduRef>
    <SoAdRxRoutingGroupRef>DefaultGroup</SoAdRxRoutingGroupRef>
    <SoAdRxPduHeaderId>4660</SoAdRxPduHeaderId>
  </SoAdSocketRouteDest>
</SoAdSocketRoute>
```

### 4.6 SoAdRoutingGroup

`SoAdRoutingGroup` 容器用于定义可动态使能/禁用的 PDU 路由组。一组路由组可关联在若干 `SoAdPduRouteDest` 或 `SoAdSocketRouteDest` 上，使得在运行时通过 API (`SoAd_IfRoutingGroupTransmit`) 实现分组 PDU 触发或跳过。`SoAdRoutingGroup` 的配置参数包括：

* **SoAdRoutingGroupId**：路由组唯一标识符。
* **SoAdRoutingGroupIsEnabledAtInit**：初始时该路由组是否使能（`TRUE` 或 `FALSE`）。
* **SoAdRoutingGroupTxTriggerable**：是否允许触发传输。若设置为 `TRUE`，则组内的 IF-PDU 在队列模式下可由触发 API 发送；如果 `FALSE`，则强制为立即模式。

*示例配置片段*：

```xml
<SoAdRoutingGroup>
  <SoAdRoutingGroupId>DefaultGroup</SoAdRoutingGroupId>
  <SoAdRoutingGroupIsEnabledAtInit>true</SoAdRoutingGroupIsEnabledAtInit>
  <SoAdRoutingGroupTxTriggerable>true</SoAdRoutingGroupTxTriggerable>
</SoAdRoutingGroup>
```

配置完成后，在运行时可通过 `SoAd_IfRoutingGroupTransmit(GroupId)` 触发该组下所有待发送 PDU。

## 5. SoAd 接口与通信流程

SoAd 对上层提供了两类 API：接口（IF）API 和传输协议（TP）API，分别对应上层模块直接发送 PDU（小于 MTU）和分段传输 PDU（大于 MTU）两种情况。关键接口如下：

* \**SoAd\_IfTransmit(PduIdType, const PduInfoType*)\*\*：上层模块（经由 PduR）调用此函数发送一个 IF-PDU。SoAd 根据 `PduId` 在配置中查找对应的 `SoAdPduRoute`，将 PDU 数据放入对应连接的发送队列，并尽可能立即调用 TCP/IP 层发送（或等候缓冲条件）。如果配置了 `SOAD_COLLECT_LAST_IS_BEST`，SoAd 可能延迟发送并在发送前通过 `TriggerTransmit` 获取最新数据。

* \**TriggerTransmit(PduIdType, PduInfoType*)\*\*：对于配置为触发模式的 IF-PDU，SoAd 在准备发送前调用上层的 `<Upper>_SoAd_IfTriggerTransmit`（通过 `SoAd_TriggerTransmit` API）来获取要发送的数据。上层需在此回调中填充 `PduInfoPtr->SduDataPtr` 和长度。这种机制可用于动态组包或计算校验。

* \**SoAd\_TpTransmit(PduIdType, const PduInfoType*)\*\*：上层调用该 TP-API 发送 TP-PDU。类似于 `IfTransmit`，但走分段流程，多用于大 PDU 或 XCP 等协议。SoAd 会分配缓冲并开始通过 `TcpIp_Send` 或类似调用按段发送数据。

* \**SoAd\_IfRxIndication(PduIdType, const PduInfoType*)\*\*：当 SoAd 从 Socket 接收到完整的 IF-PDU 后，调用上层（PduR）的接收确认函数，将数据传给上层。

* **SoAd\_IfTxConfirmation(PduIdType, Std\_ReturnType)**：如果配置了 Tx 确认回调（`SoAdIfTxConfirmation`），在 PDU 通过 IP 层发送成功后，SoAd 会调用上层的确认函数告知发送结果。

* **SoAd\_TpStartOfReception(PduIdType, const PduInfoType*, PduLengthType, PduLengthType*)\*\*：接收 TP-PDU 前调用，用于让上层（或者 PduR）为该 PDU 分配足够缓冲并返回可用缓冲大小。

* **SoAd\_TpCopyRxData(PduIdType, const PduInfoType*, PduLengthType*)\*\*：接收 TP-PDU 分段时逐次调用，将收到的数据复制给上层，并返回还需的缓冲量。

* **SoAd\_TpRxIndication(PduIdType, Std\_ReturnType)**：TP-PDU 完全接收后调用，告知上层传输结果。

* **SoAd\_TpCopyTxData(PduIdType, PduInfoType*, const RetryInfoType*, PduLengthType\*)\*\*：在发送 TP-PDU 时，被上层多次调用提供待发送的下一段数据。

* **SoAd\_TpTxConfirmation(PduIdType, Std\_ReturnType)**：TP-PDU 发送完成后调用上层的确认函数。

此外，SoAd 还提供与连接管理相关的 API：

* **SoAd\_OpenSoCon(SoConIdType)**：上层请求建立指定的 Socket 连接（如果 `AutomaticSoConSetup` 为 `FALSE`），SoAd 将在下一次主循环中处理。
* **SoAd\_CloseSoCon(SoConIdType, boolean KeepOpen)**：请求关闭连接。若 `KeepOpen==FALSE` 且未有其他保持请求，SoAd 在主循环中将关闭该 Socket，并最终把 SoCon 状态置为 `OFFLINE` 或重连状态。
* \**SoAd\_SetRemoteAddr(SoConIdType, const SoAd\_SocketAddressType*)\*\*：动态设置远端地址（必须在连接离线时调用）。
* \**SoAd\_GetSoConMode(SoConIdType, SoAd\_SoConModeType*)\*\*：查询连接当前状态（如 `OFFLINE`、`RECONNECT`、`ONLINE` 等）。
* **SoAd\_RequestIpAddrAssignment / SoAd\_ReleaseIpAddrAssignment / SoAd\_LocalIpAddrAssignmentChg**：与 DHCP 等动态 IP 分配相关的 API，用于在动态网络中更新本地地址。

**通信流程示例：**

1. **上行（发送）流程：** 上层（如 DoIP）构造 PduInfoType，调用 `SoAd_IfTransmit(txPduId, &pduInfo)`。SoAd 接收到请求后，根据配置找到对应的 `SoAdSocketConnection`，将数据放入队列。如果为及时发送模式，SoAd 会立即调用 `TcpIp_Tx` 发送；如果为 queued 模式，则等待发送条件或 `TriggerTransmit` 再发送。发送完成后，根据配置可能调用 `SoAd_IfTxConfirmation(txPduId, E_OK)` 通知上层。

2. **下行（接收）流程：** 当底层 `TcpIp` 模块在 Socket 接收到数据时，会通过接口将数据传给 SoAd。SoAd 根据配置判断属于哪个 `SoAdSocketRoute`，然后进一步分配给特定的 `SoAdSocketRouteDest`。对于 IF-PDU，SoAd 将完整数据打包为 `PduInfoType` 并调用 `SoAd_IfRxIndication(rxPduId, &pduInfo)` 通知上层；对于 TP-PDU，将调用 `<Upper>_SoAd_TpStartOfReception` 开始接收，然后反复调用 `<Upper>_SoAd_TpCopyRxData` 直到完成，最后调用 `<Upper>_SoAd_TpRxIndication`。

3. **连接状态回调：** 如果配置了 `SoAdSocketSoConModeChgNotification=true` 并使能了上层 SoCon 变更支持，当 Socket 建立或断开时，SoAd 在调用 Socket API 后会触发上层回调 `<Upper>_SoConModeChg(SoConId, Mode)`。上层可在此回调中获知连接状态（例如在线或离线）并进行相应处理。

## 6. 典型应用案例

以下结合具体协议给出 SoAd 配置思路和实践建议：

### 6.1 DoIP（Diagnostics over IP）

DoIP 基于 TCP 实现车载诊断通信。一般情况下，车端 (ECU) 在端口 **13400** 上监听，诊断测试仪 (Tester) 作为客户端连接。SoAd 配置要点：

* 在 `SoAdSocketConnectionGroup` 中使用 TCP 协议，设置 `SoAdSocketLocalPort=13400`（本地端口）。
* 配置至少一个 `SoAdSocketConnection`：本地端对应监听；可配置远端地址为测试仪的 IP 和 端口 13400，或用通配地址在程序运行时调用 `SoAd_OpenSoCon` 触发连接。
* 如果DoIP 使用自定义 PDU 头（AUTOSAR DoIP 规范中通常给出诊断消息的 PDU 头 ID），则在 `SoAdPduRouteDest` 中设置 `SoAdTxPduHeaderId`；接收端在 `SoAdSocketRouteDest` 中设置 `SoAdRxPduHeaderId` 进行过滤。
* DoIP 数据量相对较大，采用 TP-API（SoAdTxUpperLayerType=TP）。配置对应的 SoAdPduRoute, SoAdPduRouteDest，SoAdSocketRouteDest 来映射 DoIP 的诊断请求/响应 PDU。例如：

  ```xml
  <SoAdPduRoute>
    <SoAdTxPduId>DoIP_TxDiagReq</SoAdTxPduId>
    <SoAdTxUpperLayerType>TP</SoAdTxUpperLayerType>
    <SoAdTxPduRef>PduR_DoIP_DiagReq</SoAdTxPduRef>
    <SoAdPduRouteDest>...</SoAdPduRouteDest>
  </SoAdPduRoute>
  ```

  接收时类似配置 `<SoAdSocketRoute>` 将收到的报文路由到 PDU Router 的接收 PDU。

在调试时，可使用网络抓包（Wireshark）监控 IP:13400 上的 TCP 连接是否建立、诊断消息是否正常往返，辅助检查 SoAd 的状态回调和错误码（如 `SOAD_E_INV_PDUHEADER_ID` 等）是否被正确触发。

### 6.2 SOME/IP over UDP

SOME/IP 通常在车载以太网中使用 UDP（一些实现也支持 TCP）。服务发现 (Service Discovery, SD) 使用固定组播地址（例如 IPv4 `224.224.224.224:30550`）。SoAd 配置要点：

* 在 `SoAdSocketConnectionGroup` 中使用 UDP 协议；可配置本地多播地址和端口（在 `SoAdSocketConnection` 或 `SoAdSocketConnectionGroup` 中）以接收组播报文。
* 对于一般的 SOME/IP 报文（点对点），可能使用单播 UDP。配置一个或多个 `SoAdSocketConnection`，指定远端 IP/端口为对端 ECU 或测试仪。也可以使用通配远端地址并在运行时通过调用 `SoAd_OpenSoCon` 建立连接。
* 多播情况：直接在配置中引用组播 IP；下层 `TcpIp` 模块应为该接口加入该组播组。SoAd 会将接收到的组播报文视作普通上行消息进行路由。
* 由于 SOME/IP PDU 头（SERVICE、METHOD）未在 SoAd 中解析，SoAd 只负责按配置将接收到的 UDP payload 原封不动地当作一个 PDU，调用上层的 RxIndication。提示：SoAd 不校验 SOME/IP 协议版本和接口版本，只检验 Service/Method ID。
* 配置示例：

  ```xml
  <SoAdSocketConnectionGroup>
    <SoAdSocketLocalAddressRef>LocalAddr_Eth0</SoAdSocketLocalAddressRef>
    <SoAdSocketLocalPort>30490</SoAdSocketLocalPort> <!-- SOME/IP 默认端口 -->
    <SoAdSocketProtocol>
      <SoAdSocketUdp>
        <SoAdSocketnPduUdpTxBufferMin>128</SoAdSocketnPduUdpTxBufferMin>
      </SoAdSocketUdp>
    </SoAdSocketProtocol>
    <SoAdSocketConnection>
      <SoAdSocketId>0</SoAdSocketId>
      <!-- 多播地址 -->
      <SoAdSocketRemoteAddress>
        <SoAdSocketRemoteIpAddrRef>SOMEIP_MulticastGroup</SoAdSocketRemoteIpAddrRef>
        <SoAdSocketRemotePortNo>30550</SoAdSocketRemotePortNo>
      </SoAdSocketRemoteAddress>
    </SoAdSocketConnection>
  </SoAdSocketConnectionGroup>
  ```
* 对应的 `SoAdPduRoute` 和 `SoAdSocketRoute` 容器要映射相应的 PDU。SOME/IP 作为 IF-PDU 时，可以针对同一报文配置多个目的地（扇出）或者路由组。
* 调试建议：使用网络分析抓包检查组播是否收到（例如正确订阅了 224.x.x.x 地址），以及 SOME/IP 报文是否正常转发到 SoAd。注意检查 SoAd 开关标志和状态回调，确保 IP 和端口配置与模块一致。

### 6.3 XCP 多通道（UDP 和 TCP）

XCP（标定协议）可使用 UDP 或 TCP 作为传输协议，并常常需要同时支持多个通道（多路访问）。SoAd 配置要点：

* **多通道配置**：为每个 XCP 通道配置一个或多个 `SoAdSocketConnection`。例如，若 ECU 同时作为主从设备，需要一对 TCP 连接（端口 5555）给主机；或者使用多个 UDP 端口模拟多通道。每个连接在配置中使用唯一的 `SoAdSocketId`。
* **SoAdPduRoute 设置**：对每个 XCP 报文类型（命令/响应）都配置一个 `SoAdPduRoute`。如果使用 TCP，可设置为 TP-模式；使用 UDP 时也可使用 IF 或 TP。
* **路由组**：若多通道共用同一组 `SoAdPduRoute` （例如默认使能的同一 PDU），可以为不同连接配置不同的路由组，通过路由组使能来区分。
* **广播和多播**：XCP 不常使用组播，但若需要广播查询，可以设置 UDP 远端地址为广播（255.255.255.255）。此时应启用 `SoAdSocketMsgAcceptanceFilterEnabled`，并通过 `SoAd_OpenSoCon` 建立广播监听。

### 6.4 调试建议

* **抓包与日志**：使用 Wireshark 或向 `TcpIp` 添加 trace，可以观察到实际的以太网帧，检查 SoAd 是否正确打开/关闭连接，PDU 是否按预期分组和发送。
* **SoAd\_MainFunction**：SoAd 的操作多在周期性函数中执行。可增加计数或日志，确认 `SoAd_MainFunction` 是否循环调用且状态变更被执行。
* **错误码检查**：关注 SoAd 产生的开发错误（Det）或运行时错误。例如如果 PDU 头 ID 不匹配会产生 `SOAD_E_INV_PDUHEADER_ID`。
* **回调使用**：确认是否正确实现了上层回调接口，例如 `<Upper>_SoAd_IfTriggerTransmit`、`<Upper>_SoAd_TpCopyRxData`、`<Upper>_SoConModeChg` 等，并在配置中使能它们。
* **配置一致性**：确保 PduR、SoAd 和通信组件（如 COM、NMS）配置一致：PDU ID、长度、路由组 ID 等要对应，无误。

## 7. SoAd 配置工具支持

目前主流 ECU 配置工具如 Vector DaVinci Configurator Pro 和 EB tresos Studio 均支持 SoAd 模块配置。它们以图形界面呈现上述容器：

* 在 Vector DaVinci 中，SoAd 配置一般位于 Software Components 的 BSW 模块下**Socket Adaptor** 节点下。工具会展示 `SoAdSocketConnectionGroup`、`SoAdSocketConnection`、`SoAdSocketProtocol`、`SoAdPduRoute`、`SoAdSocketRoute`、`SoAdRoutingGroup` 等层级容器，并提供可视化填写各参数。每个参数都会有工具提示或说明。
* 在 EB tresos 中，SoAd 配置类似，在基础软件配置树中选择 SoAd 模块，可编辑相应容器的 ECU 参数。工具通常会列出每个容器的元素名称与描述供参考。

无论使用哪种工具，配置时务必确保：所有引用（如 IP 地址符号名称、PDU 名称、路由组 ID 等）在系统中均已定义；并且 Socket 相关设置（本地地址/端口、远端地址）与网络环境相符。工具配置完成后需生成 ECUC XML 文件，SoAd 驱动会根据此 XML 在运行时初始化。

## 8. 总结

SoAd 模块是 AUTOSAR 以太网通信的核心桥梁，负责将上层各种以太网协议映射到标准化的 Socket 通信。本文从原理、接口到配置细节全面介绍了 SoAd 的机制和使用方法，包括各种通信场景（TCP、UDP、广播、组播）以及典型上层协议（DoIP、SOME/IP、XCP 等）的配置案例。通过对 `SoAdSocketConnectionGroup`、`SoAdSocketConnection`、`SoAdPduRoute`、`SoAdSocketRoute`、`SoAdRoutingGroup` 等配置容器的深入解析，以及对关键参数（如 TriggerTransmit、TxPduCollectionSemantics、TxUdpTriggerMode 等）的说明，读者可以系统掌握 SoAd 的配置与调试。本文还结合了 Vector DaVinci 和 EB tresos 等工具的配置说明，并给出了实际工程中的建议（如数据打包、回调处理和调试）。以上内容参照了 AUTOSAR 官方 SWS（Socket Adaptor 规范）和 Vector/行业技术资料，可作为团队培训和技术知识库参考。

**参考资料：** AUTOSAR Socket Adaptor SWS 文档；AUTOSAR Today 博客；Vector 技术手册 (MICROSAR SoAd)。
