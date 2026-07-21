import process from "node:process";
import { isReachable, startViteDevServer, withTimeout } from "./lib/managed-vite-server.mjs";

const port = process.env.SERVER_LIFECYCLE_PORT ?? "4197";
const baseUrl = `http://127.0.0.1:${port}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitUntilClosed(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isReachable(baseUrl))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`The managed Vite server remained reachable at ${baseUrl}.`);
}

async function run() {
  await withTimeout(new Promise(() => {}), 25, "Intentional deadline").then(
    () => { throw new Error("An unresolved operation ignored its deadline."); },
    (error) => assert(error.message.includes("Intentional deadline timed out"), `Unexpected deadline error: ${error.message}`),
  );

  const normal = await startViteDevServer({ baseUrl });
  assert(normal.owned, "The lifecycle smoke test did not own its Vite server.");
  assert(await isReachable(baseUrl), "The managed Vite server did not become reachable.");

  await startViteDevServer({ baseUrl }).then(
    () => { throw new Error("An unexpected existing server was silently reused."); },
    (error) => assert(error.message.includes("Refusing to reuse"), `Unexpected collision error: ${error.message}`),
  );

  const reused = await startViteDevServer({ baseUrl, reuseExisting: true });
  assert(!reused.owned, "An explicitly reused server was reported as owned.");
  await reused.close();
  assert(await isReachable(baseUrl), "Closing a reused handle stopped a server it did not own.");

  await normal.close();
  await normal.close();
  await waitUntilClosed();

  const exceptional = await startViteDevServer({ baseUrl });
  let observed = false;
  try {
    throw new Error("intentional lifecycle failure");
  } catch (error) {
    observed = error.message === "intentional lifecycle failure";
  } finally {
    await exceptional.close();
  }
  assert(observed, "The intentional failure path was not observed.");
  await waitUntilClosed();

  process.stdout.write(`${JSON.stringify({
    ok: true,
    normalShutdown: true,
    exceptionalShutdown: true,
    deadlineEnforced: true,
    collisionRejected: true,
    explicitReusePreserved: true,
  })}\n`);
}

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
