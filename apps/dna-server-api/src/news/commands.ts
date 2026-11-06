import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type RunCommand = (command: string, args: string[]) => Promise<string>;
const execute = promisify(execFile);
export const runCommand: RunCommand = async (command, args) => {
  const { stdout } = await execute(command, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
};
