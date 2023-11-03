---
# 这是文章的标题
title: 使用vuePress搭建博客并部署到gitpages上
# 你可以自定义封面图片
cover: /assets/images/cover1.jpg
# 这是页面的图标
icon: file
# 这是侧边栏的顺序
order: 1
# 设置作者
author: Ms.Hope
# 设置写作时间
date: 2023-11-03
# 一个页面可以有多个分类
category:
  - 使用指南
# 一个页面可以有多个标签
tag:
  - VuePress
  - 使用指南
# 此页面会在文章列表置顶
sticky: true
# 此页面会出现在文章收藏中
star: true
# 你可以自定义页脚
footer: 这是测试显示的页脚
# 你可以自定义版权信息
copyright: 无版权
---

这里使用的是theme-hope主题，项目环境、构建、本地运行指令可参考下面这个链接。

<!-- more -->
## 项目构建

参考链接 [小白教程](https://theme-hope.vuejs.press/zh/cookbook/tutorial/)

## 部署到gitpages

若参考上面项目构建链接，此时本地git仓库已初始化

1.创建本地分支

  查看本地分支
```shell
git branch
```
  创建本地分支
```shell
git checkout -b master
```

2.连接远程分支

添加远程仓库的引用
```sh
git remote add origin https://github.com/yourusername/myrepo.git
```

3.提交本地分支到远程分支
```sh
git push origin <local_branch>:<remote_branch>
```
