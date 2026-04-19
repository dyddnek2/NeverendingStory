import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { log, logError } from "../utils.js";
import { initializeProjectDirectory } from "../project-bootstrap.js";

export const initCommand = new Command("init")
  .description("Initialize an InkOS project (current directory by default)")
  .argument("[name]", "Project name (creates subdirectory). Omit to init current directory.")
  .option("--lang <language>", "Default writing language: ko (Korean), zh (Chinese), or en (English)", "ko")
  .action(async (name: string | undefined, opts: { lang?: string }) => {
    const projectDir = name ? resolve(process.cwd(), name) : process.cwd();

    try {
      await mkdir(projectDir, { recursive: true });
      await initializeProjectDirectory(projectDir, {
        language: (opts.lang === "en" || opts.lang === "zh" || opts.lang === "ko") ? opts.lang : "ko",
        overwriteSupportFiles: true,
      });

      log(`Project initialized at ${projectDir}`);
      log("");
      const language = (opts.lang ?? "ko");
      const exampleCreate = language === "en"
        ? "  inkos book create --title 'My Novel' --genre progression --platform royalroad --lang en"
        : language === "zh"
          ? "  inkos book create --title '我的小说' --genre xuanhuan --platform tomato"
          : "  inkos book create --title '내 소설' --genre 무협 --platform tomato";
      if (global) {
        log("Global LLM config detected. Ready to go!");
        log("");
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log(exampleCreate);
      } else {
        log("Next steps:");
        if (name) log(`  cd ${name}`);
        log("  # Option 1: Set global config (recommended, one-time):");
        log("  inkos config set-global --provider openai --base-url <your-api-url> --api-key <your-key> --model <your-model>");
        log("  # Option 2: Edit .env for this project only");
        log("");
        log(exampleCreate);
      }
      log("  inkos write next <book-id>");
    } catch (e) {
      logError(`Failed to initialize project: ${e}`);
      process.exit(1);
    }
  });
