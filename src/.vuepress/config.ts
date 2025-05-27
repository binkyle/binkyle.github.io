import { defineUserConfig } from "vuepress";

import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  lang: "zh-CN",
  title: "Bin",
  description: "个人随记",

  theme,

  // 和 PWA 一起启用
  // shouldPrefetch: false,
});
