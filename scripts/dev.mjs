import { spawn } from "node:child_process";

const useShell = process.platform === "win32";
const serverCommand = "npm run dev --workspace server";
const clientCommand = "npm run dev --workspace client";

let clientProcess = null;
let shuttingDown = false;

function prefixStream(stream, prefix, target) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      if (!line) {
        continue;
      }
      target.write(`${prefix} ${line}\n`);
    }
  });
}

function shutdown(serverProcess, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (clientProcess && !clientProcess.killed) {
    clientProcess.kill();
  }

  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }

  setTimeout(() => process.exit(exitCode), 200);
}

function startClient(serverProcess) {
  if (clientProcess) {
    return;
  }

  clientProcess = spawn(clientCommand, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: useShell,
  });

  prefixStream(clientProcess.stdout, "[1]", process.stdout);
  prefixStream(clientProcess.stderr, "[1]", process.stderr);

  clientProcess.on("exit", (code) => {
    shutdown(serverProcess, code ?? 0);
  });
}

const serverProcess = spawn(serverCommand, {
  stdio: ["inherit", "pipe", "pipe"],
  shell: useShell,
});

prefixStream(serverProcess.stderr, "[0]", process.stderr);

serverProcess.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[0] ${line}`)
      .join("\n") + (text.endsWith("\n") ? "\n" : "")
  );

  if (text.includes("Project Billing System API listening on port")) {
    startClient(serverProcess);
  }
});

serverProcess.on("exit", (code) => {
  shutdown(serverProcess, code ?? 0);
});

process.on("SIGINT", () => shutdown(serverProcess, 0));
process.on("SIGTERM", () => shutdown(serverProcess, 0));
