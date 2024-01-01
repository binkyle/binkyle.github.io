---
# 这是文章的标题
title: Python虚拟环境配置及其工作原理
# 你可以自定义封面图片
# cover: /assets/images/cover1.jpg
# 这是页面的图标
icon: file
# 这是侧边栏的顺序
order: 1
# 设置作者
# author: Ms.Hope
# 设置写作时间
date: 2024-01-01
# 一个页面可以有多个分类
category:
  - 编程语言
# 一个页面可以有多个标签
tag:
  - Python
  - venv
# 此页面会在文章列表置顶
# sticky: true
# 此页面会出现在文章收藏中
star: true
isOriginal: true
article: true
timeline: true
# 你可以自定义页脚
# footer: 这是测试显示的页脚
# 你可以自定义版权信息
# copyright: 无版权
---

venv in python

<!-- more -->

## 工作原理

当Python解释器在虚拟环境中运行时，[sys.prefix](https://docs.python.org/3/library/sys.html#sys.prefix)和[sys.exec_prefix](https://docs.python.org/3/library/sys.html#sys.exec_prefix)指向虚拟环境的目录，而sys.prefix则指向虚拟环境的目录。[sys.base_prefix](https://docs.python.org/3/library/sys.html#sys.base_prefix)和 [sys.base_exec_prefix](https://docs.python.org/3/library/sys.html#sys.base_exec_prefix)指向用于创建环境的基本Python。检查sys.prefix != sys.base_prefix来确定当前解释器是否从虚拟环境中运行。

虚拟环境可以使用其二进制目录(bin on POSIX; Scripts on Windows)。这将把该目录添加到您的PATH中，以便运行python将调用环境的python解释器，并且您可以运行已安装的脚本而不必使用它们的完整路径。激活脚本的调用是特定于平台的(`<venv>`必须被包含虚拟环境的目录的路径所替换)

## 配置方法

在Windows/Linux上，你可以使用Python的内置工具`venv`来创建指定版本的虚拟环境。以下以Window环境为例创建指定版本虚拟环境的步骤：

1. 确保你已经安装了指定版本的Python解释器。[你可以在Python官方网站](https://www.python.org/downloads/windows/)上下载和安装所需的[Python版本](https://www.python.org/downloads/windows/%EF%BC%89%E4%B8%8A%E4%B8%8B%E8%BD%BD%E5%92%8C%E5%AE%89%E8%A3%85%E6%89%80%E9%9C%80%E7%9A%84Python%E7%89%88%E6%9C%AC%E3%80%82)

2. 打开命令提示符（CMD）或者PowerShell。

3. 导航到你希望创建虚拟环境的目录。例如，如果你想在`C:\\Projects`目录下创建虚拟环境，可以使用以下命令：

  ```shell
  cd C:\\Projects

  ```

4. 创建虚拟环境。使用`python`命令和`m venv`参数，后面跟着虚拟环境的名称和Python解释器的路径。例如，如果你想创建一个名为`myenv`的虚拟环境，并使用Python 3.7版本，可以使用以下命令：

```shell
python -m venv myenv

```

如果你的系统上同时安装了多个版本的Python，你可以指定要使用的Python解释器的完径。例如：

```shell
python -m venv --python=C:\\Python37\\python.exe myenv

```

5. 激活虚拟环境。在命令提示符或者PowerShell中，使用以下命令激活虚拟环境：

```shell
myenv\\Scripts\\activate

```

激活后，你将看到命令提示符或者PowerShell的提示符前面有`(myenv)`字样，表示你进入了虚拟环境。

现在，你已经成功创建了指定版本的虚拟环境，并且可以在该环境中安装和运行特定版本的Python程序。

## 参考链接

<https://docs.python.org/3/library/venv.html>

::: tip
若本文对您有用，欢迎送个表情包或评论
;若有不对之处或建议，欢迎评论
:::
