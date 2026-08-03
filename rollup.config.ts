import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import type { PluginContext } from "rollup";

const pluginDirectory = "com.gentleman.ai-deck.sdPlugin";
const outputDirectory = process.env.AI_DECK_OUTPUT_DIRECTORY ?? `${pluginDirectory}/bin`;

/**
 * The Claude Code plugin is distributed by cloning this repository, so its
 * bundled hook is committed rather than staged into the Stream Deck package.
 */
const claudeHookDirectory = "claude-code-plugin/hooks";
const codexHookDirectory = "codex-plugin/hooks";

const entries = [
  { input: "src/plugin.ts", file: "plugin.js", directory: outputDirectory, packaged: true },
  { input: "src/cli/adapter-emit.ts", file: "adapter-emit.js", directory: outputDirectory, packaged: true },
  { input: "src/adapters/opencode-plugin.ts", file: "opencode-plugin.js", directory: outputDirectory, packaged: true },
  { input: "src/adapters/claude-hook.ts", file: "claude-hook.mjs", directory: claudeHookDirectory, packaged: false },
  { input: "src/adapters/codex-hook.ts", file: "codex-hook.mjs", directory: codexHookDirectory, packaged: false },
] as const;

export default entries.map(({ input, file, directory, packaged }) => ({
  input,
  output: {
    file: `${directory}/${file}`,
    format: "es" as const,
  },
  plugins: [
    typescript({ compilerOptions: { outDir: directory }, tsconfig: "./tsconfig.build.json" }),
    nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
    commonjs(),
    {
      generateBundle(this: PluginContext) {
        if (!packaged) return;
        this.emitFile({
          fileName: "package.json",
          source: '{ "type": "module" }\n',
          type: "asset",
        });
      },
    },
  ],
}));
