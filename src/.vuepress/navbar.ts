import { navbar } from "vuepress-theme-hope";

export default navbar([
  {
    text: "首页",
    icon: "fa6-solid:house",
    link: "/",
  },
  {
    text: "技术笔记",
    icon: "fa6-solid:laptop-code",
    prefix: "/技术笔记/",
    children: [
      { text: "AUTOSAR", icon: "fa6-solid:car-side", link: "Autosar/" },
      { text: "嵌入式系统", icon: "fa6-solid:microchip", link: "嵌入式系统/" },
      { text: "算法", icon: "fa6-solid:square-root-variable", link: "算法/" },
      { text: "人工智能", icon: "fa6-solid:brain", link: "人工智能/" },
      { text: "工具", icon: "fa6-solid:screwdriver-wrench", link: "工具/" },
      { text: "编程语言", icon: "fa6-solid:code", link: "编程语言/" },
      { text: "设计模式", icon: "fa6-solid:diagram-project", link: "设计模式/" },
      { text: "机器人", icon: "fa6-solid:robot", link: "机器人/" },
    ],
  },
  {
    text: "生活随想",
    icon: "fa6-solid:feather-pointed",
    link: "/生活随想/",
  },
  {
    text: "时间线",
    icon: "fa6-solid:calendar-days",
    link: "/timeline/",
  },
  {
    text: "关于我",
    icon: "fa6-solid:user-astronaut",
    link: "/关于我/",
  },
]);
