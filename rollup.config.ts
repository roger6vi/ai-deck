import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import type { PluginContext } from "rollup";

const pluginDirectory = "com.gentleman.ai-deck.sdPlugin";
const outputDirectory = process.env.AI_DECK_OUTPUT_DIRECTORY ?? `${pluginDirectory}/bin`;

export default {
  input: "src/plugin.ts",
  output: {
    file: `${outputDirectory}/plugin.js`,
    format: "es",
  },
  plugins: [
    typescript({ compilerOptions: { outDir: outputDirectory }, tsconfig: "./tsconfig.build.json" }),
    nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
    commonjs(),
    {
      generateBundle(this: PluginContext) {
        this.emitFile({
          fileName: "package.json",
          source: '{ "type": "module" }\n',
          type: "asset",
        });
      },
    },
  ],
};
