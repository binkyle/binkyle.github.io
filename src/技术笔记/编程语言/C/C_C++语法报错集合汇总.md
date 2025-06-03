---
# 这是文章的标题
title: C/C++语法报错集合汇总
# 你可以自定义封面图片
# cover: /assets/images/cover1.jpg
# 这是页面的图标
icon: file
# 这是侧边栏的顺序
order: 1
# 设置作者
# 设置写作时间
date: 2023-12-20
# 一个页面可以有多个分类
category:
  - 编程语言
# 一个页面可以有多个标签
tag:
  - C
  - C++
  - 报错
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

本文主要汇总C/C++语法报错问题

<!-- more -->
## 在C++类中vector声明，报错 “expected parameter declarator”
```C
class A{
private:
    vector<int> nums(5);
};
```
错误原因是：编译器无法区分该语句是成员变量声明还是成员函数声明。


