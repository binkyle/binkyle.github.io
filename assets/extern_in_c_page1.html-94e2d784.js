import{_ as e}from"./plugin-vue_export-helper-c27b6911.js";import{r as t,o as c,c as i,a as p,b as n,d as s,e as o,f as l}from"./app-f3fb8442.js";const d="/assets/page1_1-6f747d17.png",r={},u=n("p",null,"本文主要介绍C语言中extern的作用分析",-1),v=l(`<h2 id="前提" tabindex="-1"><a class="header-anchor" href="#前提" aria-hidden="true">#</a> 前提</h2><p>首先理解声明和定义：</p><p>声明是告诉编译器有一个这样的变量或函数存在，定义是为变量分配内存空间或者实现函数本体(body)</p><div class="hint-container tip"><p class="hint-container-title">提示</p><p>在c语言中声明和定义一个变量是同时进行的，但extern仅用于声明</p></div><h2 id="extern作用" tabindex="-1"><a class="header-anchor" href="#extern作用" aria-hidden="true">#</a> extern作用</h2><p>在C语言中，关键字<code>extern</code>用于声明一个变量或函数，以便告诉编译器它们的存在，但并不会分配实际的存储空间。具体来说，<code>extern</code>的作用有以下几点：</p><ol><li><p><strong>变量声明</strong>：当<code>extern</code>用于变量声明时，它告诉编译器该变量在其他文件中已经定义，因此在当前文件中不需要为其分配存储空间。这样做可以避免重复定义变量，而只是声明它的存在。</p><div class="language-c line-numbers-mode" data-ext="c"><pre class="language-c"><code><span class="token comment">// 在一个文件中声明变量</span>
<span class="token keyword">extern</span> <span class="token keyword">int</span> x<span class="token punctuation">;</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></li><li><p><strong>函数声明</strong>：类似地，<code>extern</code>也可以用于函数声明，以便告诉编译器该函数在其他文件中已经定义。</p><div class="language-c line-numbers-mode" data-ext="c"><pre class="language-c"><code><span class="token comment">// 声明函数的存在</span>
<span class="token keyword">extern</span> <span class="token keyword">void</span> <span class="token function">someFunction</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></li><li><p><strong>全局变量</strong>：在全局范围内使用<code>extern</code>可以使变量在当前文件中具有全局作用域，但实际的定义在其他文件中。这在大型项目中很有用，因为它允许多个文件共享相同的全局变量。</p><div class="language-c line-numbers-mode" data-ext="c"><pre class="language-c"><code><span class="token comment">// 在一个文件中使用 extern 声明全局变量</span>
<span class="token keyword">extern</span> <span class="token keyword">int</span> globalVariable<span class="token punctuation">;</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></li></ol><p>总之，<code>extern</code>关键字用于声明变量或函数的存在，但不会分配实际的存储空间。这使得程序可以跨多个文件共享变量和函数，同时避免了重复定义的问题。</p><h2 id="案例-使用extern模拟面向对象编程" tabindex="-1"><a class="header-anchor" href="#案例-使用extern模拟面向对象编程" aria-hidden="true">#</a> 案例： 使用extern模拟面向对象编程</h2><p>在C语言中，使用<code>extern</code>关键字可以实现一定程度的面向对象编程。下面是一个详细的例子，展示了如何使用<code>extern</code>来模拟类和对象的概念。</p><p>首先，我们创建一个头文件<code>myclass.h</code>，其中定义了一个类<code>MyClass</code>和相关的方法和属性：</p><div class="language-c line-numbers-mode" data-ext="c"><pre class="language-c"><code><span class="token comment">// myclass.h</span>

<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">ifndef</span> <span class="token expression">MYCLASS_H</span></span>
<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">define</span> <span class="token macro-name">MYCLASS_H</span></span>

<span class="token keyword">typedef</span> <span class="token keyword">struct</span> <span class="token punctuation">{</span>
    <span class="token keyword">int</span> data<span class="token punctuation">;</span>
    <span class="token keyword">void</span> <span class="token punctuation">(</span><span class="token operator">*</span>printData<span class="token punctuation">)</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span> MyClass<span class="token punctuation">;</span>

<span class="token keyword">extern</span> MyClass myObject<span class="token punctuation">;</span>

<span class="token keyword">void</span> <span class="token function">MyClass_init</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token keyword">void</span> <span class="token function">MyClass_printData</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">endif</span></span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>然后，我们创建一个源文件<code>myclass.c</code>，实现了类的初始化和打印数据的方法：</p><div class="language-c line-numbers-mode" data-ext="c"><pre class="language-c"><code><span class="token comment">// myclass.c</span>

<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">include</span> <span class="token string">&lt;stdio.h&gt;</span></span>
<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">include</span> <span class="token string">&quot;myclass.h&quot;</span></span>

MyClass myObject<span class="token punctuation">;</span>

<span class="token keyword">void</span> <span class="token function">MyClass_init</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    myObject<span class="token punctuation">.</span>data <span class="token operator">=</span> <span class="token number">2023</span><span class="token punctuation">;</span>
    myObject<span class="token punctuation">.</span>printData <span class="token operator">=</span> MyClass_printData<span class="token punctuation">;</span>
<span class="token punctuation">}</span>

<span class="token keyword">void</span> <span class="token function">MyClass_printData</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token function">printf</span><span class="token punctuation">(</span><span class="token string">&quot;Data: %d\\\\n&quot;</span><span class="token punctuation">,</span> myObject<span class="token punctuation">.</span>data<span class="token punctuation">)</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>接下来，我们创建一个主文件<code>main.c</code>，在其中使用类和对象：</p><div class="language-c line-numbers-mode" data-ext="c"><pre class="language-c"><code><span class="token comment">// main.c</span>

<span class="token macro property"><span class="token directive-hash">#</span><span class="token directive keyword">include</span> <span class="token string">&quot;myclass.h&quot;</span></span>

<span class="token keyword">extern</span> MyClass myObject<span class="token punctuation">;</span>

<span class="token keyword">int</span> <span class="token function">main</span><span class="token punctuation">(</span><span class="token punctuation">)</span> <span class="token punctuation">{</span>
    <span class="token function">MyClass_init</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>
    myObject<span class="token punctuation">.</span><span class="token function">printData</span><span class="token punctuation">(</span><span class="token punctuation">)</span><span class="token punctuation">;</span>

    <span class="token keyword">return</span> <span class="token number">0</span><span class="token punctuation">;</span>
<span class="token punctuation">}</span>

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>运行结果</p><figure><img src="`+d+'" alt="运行结果图" tabindex="0" loading="lazy"><figcaption>运行结果图</figcaption></figure><p>在这个例子中，我们使用<code>extern</code>关键字在<code>main.c</code>中引用了在<code>myclass.c</code>中定义的<code>myObject</code>对象。通过调用<code>MyClass_init()</code>方法初始化对象，并通过<code>myObject.printData()</code>调用对象的方法。</p><p>编译这些文件并运行程序，你将看到输出结果为<code>Data: 2023</code>，表示成功使用<code>extern</code>实现了面向对象编程的模拟。</p><p>需要注意的是，虽然使用<code>extern</code>可以模拟类和对象的概念，但C语言本身并不直接支持面向对象编程。这只是一种基于C语言的技巧或模式来实现一些面向对象的思想。</p>',21),k={href:"https://www.geeksforgeeks.org/difference-between-definition-and-declaration/",target:"_blank",rel:"noopener noreferrer"},m=n("div",{class:"hint-container tip"},[n("p",{class:"hint-container-title"},"提示"),n("p",null,"若本文对您有用，欢迎送个表情包或评论 ;若有不对之处或建议，欢迎评论")],-1);function b(y,h){const a=t("ExternalLinkIcon");return c(),i("div",null,[u,p(" more "),v,n("p",null,[s("参考链接： "),n("a",k,[s("Difference between Definition and Declaration - GeeksforGeeks"),o(a)])]),m])}const f=e(r,[["render",b],["__file","extern_in_c_page1.html.vue"]]);export{f as default};
