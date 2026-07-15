import { writePrivateFile } from "./artifacts.ts";
import type { JobPaths } from "./types.ts";

/** Quote one value for a POSIX shell command line. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function completionMarker(jobId: string, exitCode = "%s"): string {
  return `__PI_HERDR_JOB_${jobId}_DONE_${exitCode}__`;
}

export function commandScript(command: string): string {
  return `#!/usr/bin/env bash\n${command.endsWith("\n") ? command : `${command}\n`}`;
}

export function runnerScript(options: { id: string; cwd: string; paths: JobPaths; startedAt: number }): string {
  const { id, cwd, paths, startedAt } = options;
  const q = shellQuote;
  // The raw command is deliberately absent from this script. It is written to
  // command.sh and invoked by path, keeping it out of herdr's command argument.
  return `#!/usr/bin/env bash
set +e

job_id=${q(id)}
result_file=${q(paths.resultFile)}
log_file=${q(paths.logFile)}
command_file=${q(paths.commandFile)}
started_at=${q(String(startedAt))}
finalized=0

finalize() {
  local job_exit="\${1:-$?}"
  if [ "$finalized" -eq 1 ]; then return; fi
  finalized=1
  local completed_at tmp
  completed_at=$(date +%s%3N 2>/dev/null || node -e 'console.log(Date.now())')
  tmp="\${result_file}.tmp.$$"
  umask 077
  printf '{"version":1,"id":"%s","exitCode":%s,"startedAt":%s,"completedAt":%s}\n' \
    "$job_id" "$job_exit" "$started_at" "$completed_at" > "$tmp"
  mv -f -- "$tmp" "$result_file"
  printf '\n${completionMarker(id)}\n' "$job_exit"
}

on_exit() {
  local job_exit=$?
  trap - EXIT
  finalize "$job_exit"
  exit "$job_exit"
}

on_signal() {
  trap - INT TERM
  trap - EXIT
  finalize 130
  exit 130
}

trap on_exit EXIT
trap on_signal INT TERM

cd -- ${q(cwd)} || exit 125
bash "$command_file" 2>&1 | tee -a "$log_file"
job_exit=\${PIPESTATUS[0]}
exit "$job_exit"
`;
}

export async function writeRunnerFiles(options: {
  id: string;
  command: string;
  cwd: string;
  paths: JobPaths;
  startedAt: number;
}): Promise<void> {
  await writePrivateFile(options.paths.commandFile, commandScript(options.command));
  await writePrivateFile(options.paths.runnerFile, runnerScript(options));
}

export function paneRunCommand(runnerFile: string): string {
  return `bash ${shellQuote(runnerFile)}`;
}
