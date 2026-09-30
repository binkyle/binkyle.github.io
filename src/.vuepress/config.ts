import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  lang: "zh-CN",
  title: "孤星旅记",
  description: "云间笔记",

  theme,

  // 关闭全站页面脚本预取，避免文章页一次性 prefetch 大量路由 chunk，
  // 在文章数量较多时显著拖慢首屏加载。
  shouldPrefetch: false,
});
