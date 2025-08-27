---
title: 深入理解 Git：rebase、fetch、pull 与对象模型
date: 2025-08-28
order: 1
isOriginal: true
article: true
timeline: true
categories:
  - 工具链
  - 版本控制
tags:
  - Git
  - Rebase
  - Pull
  - Fetch
  - 对象模型
  - Gerrit
---

# 深入理解 Git：rebase、fetch、pull 与对象模型

作为现代版本控制系统的代表，Git 的强大之处不仅体现在灵活的命令，也隐藏在背后的数据结构。本篇博客整理出几个常见但容易混淆的 Git 主题：rebase 的处理流程、git pull --rebase 与 git fetch/pull 的差异、单独 git fetch 的作用，以及 Git 对象的底层模型。

## 一、正确处理 rebase 中断

当你在命令行提示符中看到 |REBASE，表示当前分支正处于 rebase 进行中。常见的场景是：你在 rebase 过程中遇到了冲突，Git 会暂停到某个提交，让你手动解决冲突并决定下一步。处理方式通常有三种：

继续应用（git rebase --continue）：先用 git status 查看有哪些文件存在冲突，然后逐个手工解决，执行 git add <文件> 标记已解决，最后 git rebase --continue 让 Git 继续应用下一条提交。

跳过当前提交（git rebase --skip）：如果正在应用的提交内容在新基线上已经存在，或者该提交没有必要保留，可以跳过。它等价于手动删除这条变基中的提交。

终止 rebase（git rebase --abort）：如果发现这次变基不合适，可以放弃当前 rebase，恢复到变基之前的状态。

如果执行 git rebase --show-current-patch 时出现 fatal: bad revision 'REBASE_HEAD'，说明当前并没有处于“应用某一条补丁”的阶段——可能 rebase 已完成，或并未开始。此时可以用 git status 检查当前状态；若发现并无 rebase 进行，可安全地删除 .git/rebase-merge 或 .git/rebase-apply 的残留目录。

另一个常见提示是 patch contents already upstream：这意味着你在旧分支上的补丁内容已经出现在了新基线，Git 会自动丢弃这条提交，只保留新的基线版本。完成 rebase 后，为了保证远端历史一致，你通常需要使用 git push --force-with-lease 强制推送。

## 二、git pull --rebase 的原理

默认的 git pull 相当于 git fetch 加上一次 合并 (merge)：
```bash
git fetch origin            # 更新远端跟踪分支 origin/<branch>
git merge @{u}             # 把上游分支合并进当前分支
```

这样会生成一次合并提交，历史出现一个“分叉-合并”结构。如果你希望历史保持线性，更易于代码审查，则可以使用 git pull --rebase。它的过程等价于：
```bash
git fetch origin
# 找到当前分支相对于上游分支的分叉点（fork point）
# 将当前分支上独有的提交一个个取出(cherry-pick)到最新的上游之上
git rebase @{u}
```

图示如下：

    A -- B -- C        (origin/feature)
               \
                D -- E  (本地feature，还未推送)

 git pull --rebase 之后：

    A -- B -- C -- D' -- E'   (本地feature，新历史)


其中 D'、E' 的内容与原来的 D、E 相同，但父指针不同，导致提交 ID 改变。这就是所谓“改写历史”的 rebase 过程。完成 rebase 后再推送时，由于远端历史未包含这些新提交，必须使用 git push --force-with-lease 覆盖远端分支，保证不会覆盖掉他人新提交。若团队已有其他人基于旧历史开发，在执行改写历史前务必沟通，以免造成混乱。

另外，git pull --rebase=merges 可以在保留合并结构的同时对每个分支做 rebase；git config --global pull.rebase true 则能让 git pull 默认使用 rebase 策略。

## 三、git fetch 与 git pull 的区别
命令	行为	是否修改当前分支及工作区	适用场景
git fetch	从远端获取最新对象和引用，更新 `origin/<branch> `等跟踪分支	否，仅更新 .git/refs/remotes	想先了解远端变化再决定是否合并、查看差异、审阅代码
git pull	相当于 git fetch + 将上游合并到当前分支（默认合并或 rebase）	是，会改变 HEAD，可能产生冲突	要同步远端改动并继续开发时使用

因此，单独执行 git fetch 是完全安全的，不会影响当前分支和工作区，只会把远端的最新对象和引用拉到本地。当你想先看远端比自己领先了哪些提交、代码差异或更新记录时，可以顺序执行：
```bash
git fetch origin
# 查看别人比我多了哪些提交
git log --oneline --graph HEAD..origin/当前分支
# 查看具体改动
git diff HEAD..origin/当前分支
```

之后再选择 git merge origin/当前分支 或 git rebase origin/当前分支 将改动整合进来。如果想要检查远端某个分支的具体情况，可以把它检出到本地临时分支：
```bash
git fetch origin featureA:tmp/featureA
git checkout tmp/featureA
```

同时，加上 --prune 选项可以在 fetch 时清理本地那些远端已删除的分支：
```bash
git fetch --prune
# 全局配置自动 prune
git config --global fetch.prune true
```
## 四、单独 git fetch 的作用

单独的 git fetch 既不移动当前分支指针，也不修改工作区，只会把远端新增的对象和引用拉下来，并更新 refs/remotes/origin/*。其典型用途包括：

对比远端变化：配合 git log 和 git diff 查看远端分支比当前分支领先了什么内容，再决定合并策略。

安全地试验远端分支：通过 git fetch origin branchX:tmp/branchX 创建本地临时分支，查看或测试远端分支。

清理已删除分支：使用 --prune 删除本地已无对应远端的跟踪引用。

与浅克隆结合：使用 `--depth=<n> `等参数控制历史深度，随后再 --unshallow 取回完整历史。

简而言之，git fetch 是查看远端状态和准备工作的第一步，而是否整合远端改动则由后续的 merge/rebase 决定。

## 五、Git 的数据模型：不可变对象与可变引用

Git 的核心是一套内容寻址的存储系统，它通过不可变对象和可变引用来记录项目历史。这一点是理解 Git 命令行为的关键。

不可变对象

Git 中有四类基础对象，它们都使用 `<type> <size>\0<content>` 的内容进行哈希得到唯一 ID（历史上使用 SHA‑1，新仓库可选 SHA‑256），写入 .git/objects 并不可更改。四类对象包括：

blob：保存文件内容本身，不包含文件名。

tree：描述目录结构，由若干条目组成，每条包含模式、文件名和指向 blob 或子 tree 的对象 ID。

commit：一次提交的元数据，记录根 tree 的对象 ID、一个或多个父提交、作者和提交者信息、时间戳，以及提交信息等。它代表一次项目快照。

tag：给对象（通常是 commit）打标签的对象，包含目标对象 ID、目标类型、标签名、打标签者信息以及说明。

对象一旦写入便不可修改，想要改变其中内容只能生成新的对象。在 Git 中，提交实际上保存的是整个项目目录树的快照，而不是差异。

可变引用

与对象不可变形成对比的是，Git 的引用（refs）是可变的指针。常见的引用包括：

refs/heads/main：某个本地分支指向的 commit ID；分支前进其实就是移动这个指针。

refs/remotes/origin/main：远端跟踪分支。

refs/tags/v1.0：标记某个提交的标签。

HEAD：一个特殊的符号引用，通常指向当前分支，也可以在分离头指（detached HEAD）下直接指向某个 commit。

引用可以随时指向新的对象 ID，这使得分支操作变得非常廉价。比如 git reset --hard HEAD~1 只是把当前分支指针往回移动一格；而重写历史的 rebase 不会修改旧的提交对象，而是创造一串新的提交对象并移动引用指向它们。这也解释了为什么在完成 rebase 后需要使用 --force-with-lease 推送：你的分支引用指向了全新的 commit ID，必须用强制更新让远端引用同步。

对象结构示例

使用 git cat-file 可以查看对象内容。例如，查看某次提交：
```bash
# 查看对象类型
git cat-file -t <commit-id>

# 打印 commit 对象内容（包括 tree、parent 等信息）
git cat-file -p <commit-id>

# 查看当前提交包含的文件列表
git ls-tree -r HEAD
```

这些底层 plumbing 命令让我们得以窥视 Git 不是简单地存补丁，而是用对象和指针构建一条不可变的历史图（Merkle DAG）。

# 结语

Git 的强大来源于其底层的不可变对象与可变引用模型，以及围绕这些模型设计的一整套命令。
