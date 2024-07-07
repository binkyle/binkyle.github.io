import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

import { searchProPlugin } from "vuepress-plugin-search-pro";

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
    searchProPlugin({
      // 索引全部内容
      indexContent: true,
      // 为分类和标签添加索引
      customFields: [
        {
          getter: (page) => page.frontmatter.category,
          formatter: "分类：$content",
        },
        {
          getter: (page) => page.frontmatter.tag,
          formatter: "标签：$content",
        },
      ],
    }),
  ],

  // Enable it with pwa
  // shouldPrefetch: false,
});
