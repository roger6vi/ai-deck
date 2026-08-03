import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import type { PluginContext } from "rollup";

const pluginDirectory = "com.gentleman.ai-deck.sdPlugin";
const outputDirectory = process.env.AI_DECK_OUTPUT_DIRECTORY ?? `${pluginDirectory}/bin`;

const entries = [
  { input: "src/plugin.ts", file: "plugin.js" },
  { input: "src/cli/adapter-emit.ts", file: "adapter-emit.js" },
  { input: "src/adapters/opencode-plugin.ts", file: "opencode-plugin.js" },
  { input: "src/adapters/claude-hook.ts", file: "claude-hook.js" },
] as const;

export default entries.map(({ input, file }) => ({
  input,
  output: {
    file: `${outputDirectory}/${file}`,
    format: "es" as const,
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
}));
