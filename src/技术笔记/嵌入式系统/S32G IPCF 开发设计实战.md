---
title: S32G IPCF 开发设计实战
date: 2025-09-24
order: 1
isOriginal: true
article: true
timeline: true
categories:
  - 嵌入式系统
  - S32G
tags:
  - IPCF
  - Shared Memory
  - MSCM MSI
  - GIC
  - NVIC
  - 零拷贝
---

> S32G 的 IPCF = **共享内存（数据面）** + **MSCM MSI（通知面）**。Linux 侧用 `ipc-shm` 驱动（UIO/CDEV），M7 侧用 RTOS/AUTOSAR 应用；通道用 **带标签联合**抽象 *Managed* / *Unmanaged* 两种互斥布局；严格执行 **屏障/缓存维护→更新指针→门铃** 的顺序，ISR 短小只做唤醒和清源。

## 一、目标与场景

* **目标**：低拷贝、低抖动、可观测、可扩展（多通道/多实例）。
* **典型场景**：A53（Linux 应用） ↔ M7（AUTOSAR/FreeRTOS 任务）做控制面与小批量数据互通；大数据（日志、抓包）也可经 *Unmanaged* 固定窗口直接零拷贝。

## 二、总体架构

* **数据面（Shared Memory）**：在双方可见的 SRAM/DDR carve-out 上布置 **ring/queue + buffer pool** 或 **固定窗口**；**应用直接读写共享区**。
* **通知面（MSCM MSI）**：跨核“门铃”用 **MSCM 的 core-to-core 中断**（GIC/NVIC 接收），Linux 侧驱动将之路由为 IRQ，触发 ISR→唤醒上半部/任务。NXP 的 `ipc-shm` 驱动专为此设计（含内核模块与示例）([GitHub][1])。
* **Linux 集成**：`ipc-shm` 作为 NXP Auto Linux BSP 的**树外模块**；还提供 **user-space 版**（UIO + 静态库），便于用户态直接 mmap 非缓存共享区并跑样例 ping-pong。([GitHub][1])

## 三、通道模型（Managed vs Unmanaged）

> 单一抽象 `ipc_shm_channel`，内部用 `enum + union` 做**变体类型**（互斥布局），运行时按 `type` 分发。

* **Managed（受管）**

  * 结构：**描述符队列（bd\_queue） + 多个 buffer pool**；一次消息 = 取块→填充→推入队列→门铃。
  * 适合：**变长消息**、高并发、需要**零拷贝**与缓冲复用的通用数据面。
* **Unmanaged（非受管）**

  * 结构：**固定共享窗口** + 计数器/门铃；协议自管，极简且低开销。
  * 适合：固定帧、控制面、小栈 RTOS 优先。

> NXP 的 Linux 驱动也采用单生产者/单消费者（SPSC）**无锁环形**，需要一个“**哨兵元素**”保持 `write` 与 `read` 间隔，避免写满歧义；并强调共享区**内核/用户态均以非缓存映射**，应用应**避免未对齐访问**。([GitHub][1])

## 四、内存一致性与缓存策略

跨核没有硬件缓存一致性（尤其 M7）：

1. **生产者**：写 payload → `wmb()` → 写入 `write` 指针 → 触发 MSI。
2. **消费者**：读 `write` 前 `rmb()`；处理完成后更新 `read`。
3. **M7 开 D-Cache**：共享区要么 MPU 标 **non-cacheable**，要么在收发点做 **clean/invalidate**。
4. **Linux 用户态**：通过 UIO 映射的共享区**已设为 non-cacheable**，并要求**按对齐**访问。([GitHub][1])

## 五、中断设计（GIC/NVIC + MSI）

* **门铃来源**：MSCM 的 core-to-core directed interrupt，S32G 各代 **有效 ID 范围不同**（如 S32xx 为 0..2、S32G3xx 为 0..11），TX/RX **必须用不同 ID**。([GitHub][1])
* **进入时机**：CPU 在**指令边界**检查 pending/门限/屏蔽并向量化。
* **EOI/清源顺序**：电平型务必**先清设备源再 EOI/DEACTIVATE**，否则会立即 re-pend，形成“中断风暴”。
* **门铃合并**：批处理多个描述符再一次门铃，减少中断负载。
* **退化兜底**：可关闭 TX 中断、改由远端周期 `poll_channels()` 轮询收包（驱动支持将 TX IRQ 设为 `IPC_IRQ_NONE`）。([GitHub][1])

## 六、Bring-up（A53 ↔ M7）

1. **划分共享区**：页/缓存线对齐；预估 ring 元数据 + N×buf + 余量。
2. **先起 M7**：初始化 IPCF 实例/通道（Managed/Unmanaged）、注册 `rx_cb`。
3. **Linux insmod**：插入 `ipc-shm`（CDEV 或 UIO）；或使用 `ipc-shm-us` 静态库自动插入模块。([GitHub][1])
4. **配置 MSI**：为 A53/M7 各分配 TX/RX 中断 ID，确认路由到目标核。([GitHub][1])
5. **echo 通道**：固定 128B 做环回/连通性验证（GoldVIP 教程里含 ping-pong 思路）。([NXP 半导体][2])
6. **单向洪泛**：测吞吐与门铃负载；观察 /proc/interrupts 与丢包计数。
7. **往返 ping**：量端到端延迟分布（p50/p90/p99）。
8. **压测+跌落**：故意顶满队列/关中断，验证背压/丢弃策略与恢复。
9. **打开 D-Cache**（M7）：补齐 cache 维护与屏障，再回归测试。
10. **长稳压**：>8h soak，记录超时/重传/重建实例等异常路径。

## 七、最小样例骨架（伪码）

**Linux（UIO 用户态）**

```c
// open + mmap 非缓存共享区
ipc = ipc_open_instance(M7_0);
ch  = ipc_open_channel(ipc, "echo", IPC_SHM_MANAGED);

char *buf = ipc_alloc(ch, len);
memcpy(buf, msg, len);
smp_wmb();               // 先保证数据可见
ipc_send(ch, buf, len);  // 内部更新 write 并触发门铃

// 在 poll/epoll 回调里批量收包
while (ipc_recv_ready(ch)) {
  void *buf; size_t sz;
  ipc_recv(ch, &buf, &sz);      // 读 ring->write 前会 rmb()
  handle(buf, sz);
  ipc_release(ch, buf);
}
```

**M7（FreeRTOS/AUTOSAR 任务）**

```c
ipcf_init();
ipc_open_channel(MNG, "echo", rx_cb);

void rx_cb(void *arg, uint8_t inst, int chan_id, void *buf, int size) {
  // 快速判因+清源：复制/处理→归还→可能触发反向发送
}
```

## 八、性能与可观测性

* **批处理**：ISR/任务每次处理多个 descriptor，降低门铃频率；
* **背压**：发送方支持可阻塞/不可阻塞两种策略；
* **指标**：tx/rx 计数、drop/overflow、重建次数、队列水位、门铃次数、延迟分位；
* **NUMA/亲和**：A53 绑中断与工作线程亲和，减少迁移抖动；
* **异常恢复**：心跳/计数停滞触发重握手与 ring 重建。

## 九、调试清单

* **中断面**：`/proc/interrupts`、`perf top` 看 `ipcf` ISR 占比；EOI 顺序错误会导致“中断风暴”。
* **数据面**：对齐与未对齐访问（UIO 提醒**避免未对齐**）；检查屏障是否齐备。([GitHub][1])
* **版本兼容**：A 核 Linux 驱动与 M 核固件需配套（BSP/驱动版本不匹配会加载失败）。([NXP Community][3])
---

### 参考链接

* `ipc-shm`（Linux IPCF 共享内存驱动，含配置要点：MSCM 中断 ID 范围、SPSC 无锁环、non-cacheable/对齐访问等）。([GitHub][1])
* `ipc-shm-us`（用户态 UIO 驱动与样例，说明非缓存映射与自动插入模块）。([GitHub][4])
* NXP 培训页：**IPCF Support on S32G-VNP-RDB2 Reference Design**（介绍、ping-pong demo）。([NXP 半导体][2])
* GoldVIP User Manual（GoldVIP 平台与样例背景）。([Manuals+][5])

> 总结：**“门铃 + 环形队列 + 屏障 + 先清源后 EOI”**。门铃叫醒、环形搬砖、屏障守序、清源为先。

[1]: https://github.com/nxp-auto-linux/ipc-shm "GitHub - nxp-auto-linux/ipc-shm: Linux Inter-process(or) Communication over shared memory drive"
[2]: https://www.nxp.com/design/design-center/training/TIP-IPCF-SUPPORT-ON-S32G-VNP-RDB2-REFERENCE-DESIGN "IPCF Support on S32G-VNP-RDB2 Reference Design | NXP Semiconductors"
[3]: https://community.nxp.com/t5/S32G/IPCF-Compatibility-Issue-on-S32G399A-with-BSP41-Invalid-Module/m-p/1990940?utm_source=chatgpt.com "Solved: IPCF Compatibility Issue on S32G399A with BSP41"
[4]: https://github.com/nxp-auto-linux/ipc-shm-us "GitHub - nxp-auto-linux/ipc-shm-us: IPCF Shared Memory User-space Driver"
[5]: https://manuals.plus/m/aa09a38dffd84759fdb9921cc5c1699de7b06e4037a29bf9c65c08d37c8ea7a1 "S32G Vehicle Integration Platform (GoldVIP) User Manual"
