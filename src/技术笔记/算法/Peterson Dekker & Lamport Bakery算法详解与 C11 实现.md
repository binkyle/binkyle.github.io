---
title: Peterson Dekker & Lamport Bakery算法详解与C实现
date: 2025-10-26
order: 1
isOriginal: true
article: true
timeline: true
category:
  - 并发编程
tag:
 - Peterson
 - Dekker
 - Lamport Bakery
---

## 0. 总览

* **Dekker**：历史上第一个仅靠读/写实现两线程互斥；特色是“**撤销意向**（withdraw intent）”避免活锁。
* **Peterson**：对 Dekker 的**精炼**版；仍是两线程，结构更简，证明更清晰。
* **Lamport Bakery**：面向 **N 线程** 的“**取号排队**”算法，提供 **FCFS（先来先服务）** 公平性。

> 工程上，这些算法主要用于**学习与验证**。生产环境更常用 CAS/FAA、Ticket/队列自旋锁或 OS 互斥量。

---

## 1. 共同前提与工程基线

* 只假设**原子读/写单字**；不使用 CAS 等原子 RMW。
* 为了抵御编译器与 CPU 重排，**务必使用 C11 原子**（`<stdatomic.h>`）并采用**强顺序**（`memory_order_seq_cst`）或经严格论证的 acq/rel 组合。
* 三者均为**忙等自旋**，适合**短临界区**；不适合包含阻塞或 I/O 的临界区。
* **崩溃不容忍**：若持锁线程崩溃且不清状态，其他线程可能永久等待。

---

## 2. Peterson（两线程）

### 2.1 直觉与机制

* 每个线程 `i∈{0,1}` 以 `flag[i]=true` 表示**我想进**；
* 把 `turn` 让给对方：同时竞争时，**被让先的那方等待**；
* 等待条件：`while (flag[j] && turn==j) {}`。

实现了：**互斥、无死锁、有界等待**。

### 2.2 伪代码（线程 i）

```text
flag[i] = true
turn = j
while (flag[j] && turn == j) { }
# 临界区
flag[i] = false
```

### 2.3 C11 参考实现（peterson.h）

```c
#pragma once
#include <stdatomic.h>
#include <stdbool.h>

typedef struct {
    _Atomic bool flag[2];
    _Atomic int  turn;
} peterson_lock_t;

static inline void peterson_init(peterson_lock_t *L) {
    atomic_store(&L->flag[0], false);
    atomic_store(&L->flag[1], false);
    atomic_store(&L->turn, 0);
}

static inline void peterson_lock(peterson_lock_t *L, int i) {
    int j = 1 - i;
    atomic_store_explicit(&L->flag[i], true, memory_order_seq_cst);
    atomic_store_explicit(&L->turn, j, memory_order_seq_cst);
    while (atomic_load_explicit(&L->flag[j], memory_order_seq_cst) &&
           atomic_load_explicit(&L->turn, memory_order_seq_cst) == j) {
        ; // spin
    }
}

static inline void peterson_unlock(peterson_lock_t *L, int i) {
    atomic_store_explicit(&L->flag[i], false, memory_order_seq_cst);
}
```

### 2.4 最小示例（demo_peterson.c）

```c
#include <stdio.h>
#include <pthread.h>
#include "peterson.h"

static peterson_lock_t L;
static int counter = 0;

void* worker(void* arg) {
    int id = (int)(size_t)arg;
    for (int k = 0; k < 100000; ++k) {
        peterson_lock(&L, id);
        counter++;              // 临界区
        peterson_unlock(&L, id);
    }
    return NULL;
}

int main(void) {
    peterson_init(&L);
    pthread_t t0, t1;
    pthread_create(&t0, NULL, worker, (void*)0);
    pthread_create(&t1, NULL, worker, (void*)1);
    pthread_join(t0, NULL);
    pthread_join(t1, NULL);
    printf("counter=%d (expect 200000)\n", counter);
    return 0;
}
```

---

## 3. Dekker（两线程）

### 3.1 直觉与机制

* 早于 Peterson 的首创性方案。
* 关键在“**撤销意向**”：当发现**轮到对方**（`turn==j`）且对方也想进时，先把 `flag[i]=false` 回避，等待轮到自己再**重新申请**，避免活锁。

### 3.2 伪代码（线程 i）

```text
flag[i] = true
while (flag[j]) {
    if (turn == j) {
        flag[i] = false
        while (turn == j) { }
        flag[i] = true
    }
}
# 临界区
turn = j
flag[i] = false
```

### 3.3 C11 参考实现（dekker.h）

```c
#pragma once
#include <stdatomic.h>
#include <stdbool.h>

typedef struct {
    _Atomic bool flag[2];
    _Atomic int  turn;
} dekker_lock_t;

static inline void dekker_init(dekker_lock_t *L) {
    atomic_store(&L->flag[0], false);
    atomic_store(&L->flag[1], false);
    atomic_store(&L->turn, 0);
}

static inline void dekker_lock(dekker_lock_t *L, int i) {
    int j = 1 - i;
    atomic_store_explicit(&L->flag[i], true, memory_order_seq_cst);
    while (atomic_load_explicit(&L->flag[j], memory_order_seq_cst)) {
        if (atomic_load_explicit(&L->turn, memory_order_seq_cst) == j) {
            atomic_store_explicit(&L->flag[i], false, memory_order_seq_cst);
            while (atomic_load_explicit(&L->turn, memory_order_seq_cst) == j) { ; }
            atomic_store_explicit(&L->flag[i], true, memory_order_seq_cst);
        }
    }
}

static inline void dekker_unlock(dekker_lock_t *L, int i) {
    atomic_store_explicit(&L->turn, 1 - i, memory_order_seq_cst);
    atomic_store_explicit(&L->flag[i], false, memory_order_seq_cst);
}
```

### 3.4 示例（demo_dekker.c）

```c
#include <stdio.h>
#include <pthread.h>
#include "dekker.h"

static dekker_lock_t L;
static int counter = 0;

void* worker(void* arg) {
    int id = (int)(size_t)arg;
    for (int k = 0; k < 100000; ++k) {
        dekker_lock(&L, id);
        counter++;              // 临界区
        dekker_unlock(&L, id);
    }
    return NULL;
}

int main(void) {
    dekker_init(&L);
    pthread_t t0, t1;
    pthread_create(&t0, NULL, worker, (void*)0);
    pthread_create(&t1, NULL, worker, (void*)1);
    pthread_join(t0, NULL);
    pthread_join(t1, NULL);
    printf("counter=%d (expect 200000)\n", counter);
    return 0;
}
```

---

## 4. Lamport Bakery（N 线程）

### 4.1 直觉与机制

* 模拟“**面包店取号**”：

  * `choosing[i]`：i 正在取号；
  * `number[i]`：i 的号（不竞争时为 0）；
* i 进入前先取号 `number[i]=max(number)+1`，再按**字典序** `(number[j], j)` 排队：**票小的先行，同票 ID 小的先行**。
* `choosing[]` 保证别人观察到的是**稳定的终值票**，避免读到“半途票”。

### 4.2 伪代码（线程 i）

```text
choosing[i] = true
number[i]   = 1 + max(number[0..N-1])
choosing[i] = false

for j in [0..N-1], j != i:
    while (choosing[j]) { }
    while (number[j] != 0 && (number[j], j) < (number[i], i)) { }

# 临界区
number[i] = 0
```

### 4.3 C11 参考实现（bakery.h）

```c
#pragma once
#include <stdatomic.h>
#include <stdbool.h>

#ifndef BAKERY_MAX_N
#define BAKERY_MAX_N 64
#endif

typedef struct {
    int N;
    _Atomic bool     choosing[BAKERY_MAX_N];
    _Atomic unsigned number  [BAKERY_MAX_N];
} bakery_lock_t;

static inline void bakery_init(bakery_lock_t *L, int N) {
    if (N < 1) N = 1;
    if (N > BAKERY_MAX_N) N = BAKERY_MAX_N;
    L->N = N;
    for (int i = 0; i < N; ++i) {
        atomic_store(&L->choosing[i], false);
        atomic_store(&L->number[i], 0u);
    }
}

static inline unsigned bakery_maxnum(const bakery_lock_t *L) {
    unsigned m = 0u;
    for (int i = 0; i < L->N; ++i) {
        unsigned v = atomic_load_explicit(&L->number[i], memory_order_seq_cst);
        if (v > m) m = v;
    }
    return m;
}

static inline void bakery_lock(bakery_lock_t *L, int i) {
    atomic_store_explicit(&L->choosing[i], true, memory_order_seq_cst);
    unsigned mynum = bakery_maxnum(L) + 1u;
    atomic_store_explicit(&L->number[i], mynum, memory_order_seq_cst);
    atomic_store_explicit(&L->choosing[i], false, memory_order_seq_cst);

    for (int j = 0; j < L->N; ++j) {
        if (j == i) continue;

        while (atomic_load_explicit(&L->choosing[j], memory_order_seq_cst)) { /* spin */ }

        for (;;) {
            unsigned nj = atomic_load_explicit(&L->number[j], memory_order_seq_cst);
            if (nj == 0u) break; // j 不竞争
            unsigned ni = atomic_load_explicit(&L->number[i], memory_order_seq_cst);

            if (nj > ni || (nj == ni && j > i)) break;  // 我优先
            // 否则 j 优先，继续等待
        }
    }
}

static inline void bakery_unlock(bakery_lock_t *L, int i) {
    atomic_store_explicit(&L->number[i], 0u, memory_order_seq_cst);
}
```

### 4.4 示例（demo_bakery.c）

```c
#include <stdio.h>
#include <pthread.h>
#include "bakery.h"

#ifndef N_THREADS
#define N_THREADS 8
#endif

static bakery_lock_t L;
static int counter = 0;

void* worker(void* arg) {
    int id = (int)(size_t)arg;
    for (int k = 0; k < 100000; ++k) {
        bakery_lock(&L, id);
        counter++;              // 临界区
        bakery_unlock(&L, id);
    }
    return NULL;
}

int main(void) {
    bakery_init(&L, N_THREADS);
    pthread_t th[N_THREADS];
    for (int i = 0; i < N_THREADS; ++i)
        pthread_create(&th[i], NULL, worker, (void*)(size_t)i);
    for (int i = 0; i < N_THREADS; ++i)
        pthread_join(th[i], NULL);
    printf("counter=%d (expect %d)\n", counter, 100000 * N_THREADS);
    return 0;
}
```

---

## 5. 正确性要点（直觉化不变量）

* **互斥（Safety）**

  * Peterson/Dekker：若两者同时在临界区，会推出 `turn==0` 与 `turn==1` 同时成立的矛盾。
  * Bakery：若 i、k 同时在内，则两者都认定对方“不在自己之前”，与字典序全序性冲突。

* **进展（无死锁）**

  * Peterson：同时竞争时，**最后写 `turn`** 的那方让出先手，另一方立即进入。
  * Dekker：“撤销意向→等待→再申请”保证至少一方前进。
  * Bakery：总有**字典序最小**者不被阻挡。

* **公平/有界等待**

  * 两线程（Peterson/Dekker）：交替进入，不会单方无限受阻。
  * N 线程（Bakery）：取号 `max+1` 与字典序比较实现 **FCFS**。

---

## 6. 内存模型与实际注意

1. **一定用 C11 原子**

   * 选 `memory_order_seq_cst` 最省心；不要用 `volatile` 代替原子。
2. **短临界区**

   * 自旋只适合很短的临界区；长临界、可能阻塞的路径请用互斥量或“自旋 + 让出（futex/park）”。
3. **崩溃不容忍**

   * 任何一方挂死不清状态，其他方可能永久等待；工程上需看门狗/超时/健康检查。
4. **Bakery 的票号溢出**

   * 选择更大位宽（`uint64_t`），或在系统空窗期重整；工程上常用 **Ticket Lock**（FAA）或 **CLH/MCS** 队列自旋锁替代。

---

## 7. 选择建议与对比

| 维度    | Peterson     | Dekker               | Bakery                    |
| ----- | ------------ | -------------------- | ------------------------- |
| 线程数   | 2            | 2                    | **N**                     |
| 核心手法  | 意向 + turn 礼让 | 意向 + turn + **撤销意向** | **取号排队**（字典序）             |
| 正确性证明 | 简洁清晰         | 展示“回避-再申请”避免活锁       | FCFS 公平性最强                |
| 复杂度   | O(1)         | O(1)                 | O(N) 检查                   |
| 工程实用  | 学习/实验        | 学习/历史                | 学习/实验；工程更推 Ticket/CLH/MCS |
| 崩溃容忍  | 差            | 差                    | 差                         |

---

## 8. 构建与运行

```bash
# Peterson
gcc -std=c11 -O2 demo_peterson.c -lpthread -o demo_peterson
./demo_peterson

# Dekker
gcc -std=c11 -O2 demo_dekker.c -lpthread -o demo_dekker
./demo_dekker

# Bakery
gcc -std=c11 -O2 demo_bakery.c -lpthread -o demo_bakery
./demo_bakery
```

---

## 9. 常见坑

* ❌ 用 `volatile` 代替 C11 原子（不保证跨核顺序/原子性）。
* ❌ 修改等待条件顺序或把写入顺序打乱（会破坏因果链）。
* ❌ 在自旋区做阻塞/I/O；
* ❌ Bakery 去掉 `choosing[]`；
* ❌ 忘记退出时清状态（`flag[i]=false` / `number[i]=0`）；
* ❌ 忽视票号溢出（长时运行）。
* 
---

