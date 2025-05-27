import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

// import { searchProPlugin } from "vuepress-plugin-search-pro";
import { slimsearchPlugin } from '@vuepress/plugin-slimsearch';
import jieba from 'nodejieba';

export default defineUserConfig({
  // base: "/",

  // lang: "zh-CN",
  // title: "博客演示",
  // description: "vuepress-theme-hope 的博客演示",

  // theme,

  // // 和 PWA 一起启用
  // // shouldPrefetch: false,
  base: "/",
  // repo: "/",
  lang: "zh-CN",
  title: "Bin",
  description: "Bin的小站",
  
  theme,
  // theme: hopeTheme({
  //   repoDisplay: false,
  // }),

  plugins: [
    // searchProPlugin({
    //   // 索引全部内容
    //   indexContent: true,
    //   // 为分类和标签添加索引
    //   customFields: [
    //     {
    //       getter: (page) => page.frontmatter.category,
    //       formatter: "分类：$content",
    //     },
    //     {
    //       getter: (page) => page.frontmatter.tag,
    //       formatter: "标签：$content",
    //     },
    //   ],
    // }),
     slimsearchPlugin({
      maxDepth: 2, // 生产环境建议降低深度以减少索引量
      exclude: [
        '**/private/**', // 排除私有目录
        '**/*.draft.md', // 排除草稿文件
      ],
      allowEmpty: false,
      isSearchable: (page) => page.frontmatter.lang === 'zh-CN', // 仅索引中文页面
      getExtraFields: (page) => ({
        author: page.frontmatter.author || '', // 支持按作者搜索
      }),
      tokenize: (text) => jieba.cut(text, true), // 中文分词
      preload: true, // 预加载索引
      sortFunction: (query, results) => results.sort((a, b) => {
        // 优先匹配标题，其次按更新时间排序
        const aTitle = a.title.includes(query) ? -1 : 1;
        const bTitle = b.title.includes(query) ? -1 : 1;
        if (aTitle !== bTitle) return aTitle - bTitle;
        return new Date(b.frontmatter.lastUpdated || 0) - new Date(a.frontmatter.lastUpdated || 0);
      }),
    }),
  ],

  // Enable it with pwa
  // shouldPrefetch: false,
});
