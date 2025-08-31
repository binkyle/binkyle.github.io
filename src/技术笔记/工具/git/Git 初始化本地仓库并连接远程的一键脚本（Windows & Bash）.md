---
title: Git 初始化本地仓库并连接远程的一键脚本（Windows & Bash）
date: 2025-09-01
tags:
  - Git
  - 脚本
  - Windows
  - Bash
  - 自动化
categories:
  - 开发工具
---

# Git 初始化本地仓库并连接远程的一键脚本（Windows & Bash）

本文给出两份**可直接运行**的一键脚本：  
- Windows：`git_init_connect.bat`（**零括号版**，专门避开 PowerShell/CMD 解析坑）  
- Linux/macOS：`git-init-connect.sh`（同逻辑 Bash 版）

两者都支持：  
- **有参=非交互**：直接传入 `<remote_url> [branch]` 全程自动  
- **无参=交互**：缺省参数时进入交互式输入  
- 自动 `git init` → 切分支/建分支 → 绑定/更新 `origin` → **首提交流程**（目录为空会自动生成 `README.md`）→ `push -u` 设置上游

---

## 快速开始

**Windows（推荐在 CMD 中运行）：**
```bat
git_init_connect.bat https://github.com/your/repo.git main
````

或在 **PowerShell** 中：

```powershell
cmd /c .\git_init_connect.bat https://github.com/your/repo.git main
```

**无参交互**（会提示输入远端与分支）：

```powershell
cmd /c .\git_init_connect.bat
```

**Linux / macOS：**

```bash
chmod +x git-init-connect.sh
./git-init-connect.sh https://github.com/your/repo.git main
# 或
./git-init-connect.sh   # 无参时进入交互
```

---

## 脚本清单

### ① Windows（CMD）稳定版：`git_init_connect.bat`


```bat
@echo off
setlocal EnableExtensions

REM ============================================
REM Git repo initializer & remote connector (Windows)
REM - Non-interactive when args are provided
REM - Interactive only when no args
REM - No parentheses used to avoid parser issues
REM ============================================

REM Check git availability (no parentheses)
where git >nul 2>&1
if errorlevel 1 goto NOGIT
goto HASGIT

:NOGIT
echo [ERROR] Git is not found in PATH. Please install Git.
exit /b 1

:HASGIT
REM Args and interactive fallback (no special chars in prompts)
set "REMOTE_URL=%~1"
set "BRANCH=%~2"

if "%REMOTE_URL%"=="" goto INTERACTIVE
if "%BRANCH%"=="" set "BRANCH=main"
goto RUN

:INTERACTIVE
echo Git repository initializer and remote connector
echo.
set /p REMOTE_URL=Enter remote URL (example https://github.com/user/repo.git or git@github.com:user/repo.git) 
if "%REMOTE_URL%"=="" echo [ERROR] Remote URL is required. & exit /b 1
set /p BRANCH=Enter branch name default main 
if "%BRANCH%"=="" set "BRANCH=main"

:RUN
echo.
echo ==> Branch  %BRANCH%
echo ==> Remote  %REMOTE_URL%
echo.

REM Init if needed (no parentheses)
if not exist .git goto DO_INIT
echo [INFO] Existing Git repository detected
goto BRANCH

:DO_INIT
echo [INFO] git init
git init
if errorlevel 1 goto FAIL

:BRANCH
echo [INFO] git checkout -B "%BRANCH%"
git checkout -B "%BRANCH%"
if errorlevel 1 goto FAIL

REM Stage everything
echo [INFO] git add -A
git add -A >nul 2>&1

REM Try commit; if empty, create README then commit
echo [INFO] commit if staged
git commit -m "chore: initial commit" >nul 2>&1
if errorlevel 1 goto MAYBE_README
goto REMOTE

:MAYBE_README
if exist README.md goto REMOTE
echo # Repository>README.md
echo Initialized>>README.md
git add README.md >nul 2>&1
git commit -m "chore: initial commit" >nul 2>&1

:REMOTE
REM Configure origin
git remote get-url origin >nul 2>&1
if errorlevel 1 goto ADD_ORIGIN
goto SET_URL

:ADD_ORIGIN
echo [INFO] git remote add origin
git remote add origin "%REMOTE_URL%"
if errorlevel 1 goto FAIL
goto PUSH

:SET_URL
echo [INFO] git remote set-url origin
git remote set-url origin "%REMOTE_URL%"
if errorlevel 1 goto FAIL

:PUSH
echo [INFO] git push -u origin "%BRANCH%"
git push -u origin "%BRANCH%"
if errorlevel 1 goto FAIL

echo.
echo [SUCCESS] Done. Upstream set to origin/%BRANCH%
exit /b 0

:FAIL
echo [ERROR] Failed. See messages above.
exit /b 1
```

> **编码建议**：保存为 **ANSI** 或 **UTF-8（无 BOM）**。
> **运行建议**：优先在 **CMD** 中运行；如在 PowerShell，使用 `cmd /c` 调用以避免解析差异。

---

### ② Bash 版：`git-init-connect.sh`

> **特点**：与上面 .bat 同逻辑；有参非交互、无参交互；自动完成初始化、首提交流程与上游设置。

```bash
#!/usr/bin/env bash
# ============================================
# Git repo initializer & remote connector (Bash)
# - Non-interactive when args are provided
# - Interactive only when no args
# ============================================

set -euo pipefail

# Check git
if ! command -v git >/dev/null 2>&1; then
  echo "[ERROR] Git is not installed or not in PATH." >&2
  exit 1
fi

REMOTE_URL="${1-}"
BRANCH="${2-}"

# Interactive only if no args
if [[ -z "${REMOTE_URL}" ]]; then
  echo "Git repository initializer and remote connector"
  echo
  read -rp "Enter remote URL (e.g. https://github.com/user/repo.git or git@github.com:user/repo.git): " REMOTE_URL
  if [[ -z "${REMOTE_URL}" ]]; then
    echo "[ERROR] Remote URL is required." >&2
    exit 1
  fi
  read -rp "Enter branch name [main]: " BRANCH
  BRANCH="${BRANCH:-main}"
else
  BRANCH="${BRANCH:-main}"
fi

echo
echo "==> Branch  : ${BRANCH}"
echo "==> Remote  : ${REMOTE_URL}"
echo

# Init or reuse repo
if [[ ! -d .git ]]; then
  echo "[INFO] git init"
  git init
else
  echo "[INFO] Existing Git repository detected"
fi

# Create/switch branch
echo "[INFO] git checkout -B ${BRANCH}"
git checkout -B "${BRANCH}"

# Stage
echo "[INFO] git add -A"
git add -A

# Commit or create README if nothing staged
if git diff --cached --quiet; then
  if [[ ! -f README.md ]]; then
    printf '# %s\nInitialized\n' "$(basename "$PWD")" > README.md
    git add README.md
  fi
fi

if ! git diff --cached --quiet; then
  echo "[INFO] git commit"
  git commit -m "chore: initial commit"
else
  echo "[INFO] Nothing to commit (working tree clean)."
fi

# Configure origin
if git remote get-url origin >/dev/null 2>&1; then
  echo "[INFO] git remote set-url origin"
  git remote set-url origin "${REMOTE_URL}"
else
  echo "[INFO] git remote add origin"
  git remote add origin "${REMOTE_URL}"
fi

# Push & set upstream
echo "[INFO] git push -u origin ${BRANCH}"
git push -u origin "${BRANCH}"

echo
echo "[SUCCESS] Done. Upstream set to origin/${BRANCH}"
```

## 常见问题（FAQ）

* **Q：远端是私有仓库，推送报 403/权限错误？**
  A：HTTPS 需配置 **PAT（个人访问令牌）**；SSH 需生成并添加公钥，先 `ssh -T git@github.com` 测通。

* **Q：默认分支想用 `master`？**
  A：运行时第二个参数传入即可：
  `git_init_connect.bat <remote_url> master` 或 `./git-init-connect.sh <remote_url> master`。

* **Q：目录为空导致无法首提交流程？**
  A：脚本已内置兜底：在空目录自动生成 `README.md`，完成首次提交再推送。

* **Q：已有 `origin`，只想更新远端地址？**
  A：脚本会自动检测，存在则执行 `git remote set-url origin <url>`。

---

## 可选增强（按需加入自己的脚本）

* **初始化用户名/邮箱**

  ```bash
  git config user.name "Your Name"
  git config user.email "you@example.com"
  ```
* **生成基础 `.gitignore`**

  ```bash
  printf '%s\n' \
    '.DS_Store' \
    'Thumbs.db' \
    '.idea/' \
    '.vscode/' \
    '__pycache__/' \
    '*.log' \
    > .gitignore
  git add .gitignore && git commit -m "chore: add .gitignore"
  ```
* **首个 tag**

  ```bash
  git tag -a v0.1.0 -m "first tag"
  git push --tags
  ```

---

## 结语

以上两份脚本覆盖了**初始化 → 建/切分支 → 绑定/更新远端 → 首次提交 → 推送设置上游**的常用流程，并针对 Windows 的典型坑（“此时不应有 :”、编码问题、PowerShell/CMD 差异）做了**工程化规避**。
复制即用，参数直达，交互友好，适合在新项目创建或仓库迁移时快速落地。


