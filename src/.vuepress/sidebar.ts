import { sidebar } from "vuepress-theme-hope";

export default sidebar({
  "/技术笔记/": [
    {
      text: "AUTOSAR",
      icon: "fa6-solid:car-side",
      prefix: "Autosar/",
      collapsible: true,
      children: "structure",
    },
    {
      text: "嵌入式系统",
      icon: "fa6-solid:microchip",
      prefix: "嵌入式系统/",
      collapsible: true,
      children: "structure",
    },
    {
      text: "算法",
      icon: "fa6-solid:square-root-variable",
      prefix: "算法/",
      collapsible: true,
      children: "structure",
    },
    {
      text: "人工智能",
      icon: "fa6-solid:robot",
      prefix: "人工智能/",
      collapsible: true,
      children: "structure",
    },
    {
      text: "工具",
      icon: "fa6-solid:screwdriver-wrench",
      prefix: "工具/",
      collapsible: true,
      children: "structure",
    },
    {
      text: "编程语言",
      icon: "fa6-solid:code",
      prefix: "编程语言/",
      collapsible: true,
      children: "structure",
    },
    {
      text: "设计模式",
      icon: "fa6-solid:diagram-project",
      prefix: "设计模式/",
      collapsible: true,
      children: "structure",
    },
  ],
  "/生活随想/": [
    {
      text: "生活随想",
      icon: "fa6-solid:feather-pointed",
      children: "structure",
    },
  ],
  "/关于我/": [
    {
      text: "关于我",
      icon: "fa6-solid:id-card-clip",
      children: [
        { text: "个人简介", icon: "fa6-solid:user", link: "intro" },
      ],
    },
  ],
});
