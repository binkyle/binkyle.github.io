---
# 这是文章的标题
title: C语言extern关键字作用分析
# 你可以自定义封面图片
# cover: /assets/images/cover1.jpg
# 这是页面的图标
icon: file
# 这是侧边栏的顺序
order: 1
# 设置作者
# author: Ms.Hope
# 设置写作时间
date: 2023-12-09
# 一个页面可以有多个分类
category:
  - 编程语言
# 一个页面可以有多个标签
tag:
  - C语言
  - extern
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

本文主要介绍C语言中extern的作用分析

<!-- more -->
## 前提

首先理解声明和定义：

声明是告诉编译器有一个这样的变量或函数存在，定义是为变量分配内存空间或者实现函数本体(body)

::: tip
在c语言中声明和定义一个变量是同时进行的，但extern仅用于声明
:::

## extern作用

在C语言中，关键字`extern`用于声明一个变量或函数，以便告诉编译器它们的存在，但并不会分配实际的存储空间。具体来说，`extern`的作用有以下几点：

1. **变量声明**：当`extern`用于变量声明时，它告诉编译器该变量在其他文件中已经定义，因此在当前文件中不需要为其分配存储空间。这样做可以避免重复定义变量，而只是声明它的存在。
    
    ```c
    // 在一个文件中声明变量
    extern int x;
    
    ```
    
2. **函数声明**：类似地，`extern`也可以用于函数声明，以便告诉编译器该函数在其他文件中已经定义。
    
    ```c
    // 声明函数的存在
    extern void someFunction();
    
    ```
    
3. **全局变量**：在全局范围内使用`extern`可以使变量在当前文件中具有全局作用域，但实际的定义在其他文件中。这在大型项目中很有用，因为它允许多个文件共享相同的全局变量。
    
    ```c
    // 在一个文件中使用 extern 声明全局变量
    extern int globalVariable;
    
    ```
    

总之，`extern`关键字用于声明变量或函数的存在，但不会分配实际的存储空间。这使得程序可以跨多个文件共享变量和函数，同时避免了重复定义的问题。

## 案例： 使用extern模拟面向对象编程

在C语言中，使用`extern`关键字可以实现一定程度的面向对象编程。下面是一个详细的例子，展示了如何使用`extern`来模拟类和对象的概念。

首先，我们创建一个头文件`myclass.h`，其中定义了一个类`MyClass`和相关的方法和属性：

```c
// myclass.h

#ifndef MYCLASS_H
#define MYCLASS_H

typedef struct {
    int data;
    void (*printData)();
} MyClass;

extern MyClass myObject;

void MyClass_init();
void MyClass_printData();

#endif

```

然后，我们创建一个源文件`myclass.c`，实现了类的初始化和打印数据的方法：

```c
// myclass.c

#include <stdio.h>
#include "myclass.h"

MyClass myObject;

void MyClass_init() {
    myObject.data = 2023;
    myObject.printData = MyClass_printData;
}

void MyClass_printData() {
    printf("Data: %d\\n", myObject.data);
}

```

接下来，我们创建一个主文件`main.c`，在其中使用类和对象：

```c
// main.c

#include "myclass.h"

extern MyClass myObject;

int main() {
    MyClass_init();
    myObject.printData();

    return 0;
}

```

运行结果

![运行结果图](page1_1.png)

在这个例子中，我们使用`extern`关键字在`main.c`中引用了在`myclass.c`中定义的`myObject`对象。通过调用`MyClass_init()`方法初始化对象，并通过`myObject.printData()`调用对象的方法。

编译这些文件并运行程序，你将看到输出结果为`Data: 2023`，表示成功使用`extern`实现了面向对象编程的模拟。

需要注意的是，虽然使用`extern`可以模拟类和对象的概念，但C语言本身并不直接支持面向对象编程。这只是一种基于C语言的技巧或模式来实现一些面向对象的思想。

参考链接：
[Difference between Definition and Declaration - GeeksforGeeks](https://www.geeksforgeeks.org/difference-between-definition-and-declaration/)
::: tip
若本文对您有用，欢迎送个表情包或评论
;若有不对之处或建议，欢迎评论
:::
