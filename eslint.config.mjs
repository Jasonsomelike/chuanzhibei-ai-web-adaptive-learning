// ESLint 9 扁平配置。Next 16 的 eslint-config-next 已导出扁平配置数组，直接展开。
import next from "eslint-config-next";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "screenshots/**", "research/**", "bench/**"],
  },
  ...next,
  {
    rules: {
      /*
       * 本项目大量状态来自 localStorage / window.location.search，只能挂载后读，
       * 读到的值必须经 setState 进 React。这是「同步外部系统」而不是派生状态，
       * 但规则无法区分，所以降为警告。真正该避免的是在 effect 里无条件 setState
       * 制造渲染循环，那种写法 review 时单独拦。
       */
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // 生成脚本与冒烟测试在 Node 里跑，允许 console
    files: ["scripts/**/*.ts", "bench/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
