import{_ as i}from"./plugin-vue_export-helper-c27b6911.js";import{r as s,o as a,c as t,a as r,b as e,d as l,e as d,f as o}from"./app-1bb01195.js";const c={},u=e("p",null,"如何生成requirements依赖文件",-1),p=o(`<h2 id="ppireqs-安装" tabindex="-1"><a class="header-anchor" href="#ppireqs-安装" aria-hidden="true">#</a> ppireqs 安装</h2><div class="language-bash line-numbers-mode" data-ext="sh"><pre class="language-bash"><code>pip <span class="token function">install</span> pipreqs
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h2 id="使用" tabindex="-1"><a class="header-anchor" href="#使用" aria-hidden="true">#</a> 使用</h2><div class="language-text line-numbers-mode" data-ext="text"><pre class="language-text"><code>Usage:
    pipreqs [options] [&lt;path&gt;]

Arguments:
    &lt;path&gt;                The path to the directory containing the application files for which a requirements file
                          should be generated (defaults to the current working directory)

Options:
    --use-local           Use ONLY local package info instead of querying PyPI
    --pypi-server &lt;url&gt;   Use custom PyPi server
    --proxy &lt;url&gt;         Use Proxy, parameter will be passed to requests library. You can also just set the
                          environments parameter in your terminal:
                          $ export HTTP_PROXY=&quot;http://10.10.1.10:3128&quot;
                          $ export HTTPS_PROXY=&quot;https://10.10.1.10:1080&quot;
    --debug               Print debug information
    --ignore &lt;dirs&gt;...    Ignore extra directories, each separated by a comma
    --no-follow-links     Do not follow symbolic links in the project
    --encoding &lt;charset&gt;  Use encoding parameter for file open
    --savepath &lt;file&gt;     Save the list of requirements in the given file
    --print               Output the list of requirements in the standard output
    --force               Overwrite existing requirements.txt
    --diff &lt;file&gt;         Compare modules in requirements.txt to project imports
    --clean &lt;file&gt;        Clean up requirements.txt by removing modules that are not imported in project
    --mode &lt;scheme&gt;       Enables dynamic versioning with &lt;compat&gt;, &lt;gt&gt; or &lt;non-pin&gt; schemes
                          &lt;compat&gt; | e.g. Flask~=1.1.2
                          &lt;gt&gt;     | e.g. Flask&gt;=1.1.2
                          &lt;no-pin&gt; | e.g. Flask
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="使用案例" tabindex="-1"><a class="header-anchor" href="#使用案例" aria-hidden="true">#</a> 使用案例</h3><ol><li>生成requirements</li></ol><div class="language-bash line-numbers-mode" data-ext="sh"><pre class="language-bash"><code>pipreqs /home/project/location

</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><div class="language-bash line-numbers-mode" data-ext="sh"><pre class="language-bash"><code>Successfully saved requirements <span class="token function">file</span> <span class="token keyword">in</span> /home/project/location/requirements.txt
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><ol start="2"><li>更新requirements</li></ol><div class="language-bash line-numbers-mode" data-ext="sh"><pre class="language-bash"><code>pipreqs <span class="token parameter variable">--force</span> <span class="token punctuation">[</span>location<span class="token punctuation">]</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h2 id="参考链接" tabindex="-1"><a class="header-anchor" href="#参考链接" aria-hidden="true">#</a> 参考链接</h2>`,11),m={href:"https://pypi.org/project/pipreqs/",target:"_blank",rel:"noopener noreferrer"},v=e("div",{class:"hint-container tip"},[e("p",{class:"hint-container-title"},"提示"),e("p",null,"若本文对您有用，欢迎送个表情包或评论 ;若有不对之处或建议，欢迎评论")],-1);function h(b,g){const n=s("ExternalLinkIcon");return a(),t("div",null,[u,r(" more "),p,e("p",null,[e("a",m,[l("pipreqs"),d(n)])]),v])}const x=i(c,[["render",h],["__file","generate_requirments.html.vue"]]);export{x as default};
