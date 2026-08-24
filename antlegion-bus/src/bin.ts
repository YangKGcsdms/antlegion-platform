#!/usr/bin/env node
/**
 * alctl executable — wires a real httpTransport + a ClientV2 to runCli.
 *
 *   ANTLEGION_BUS_URL=http://localhost:28090 ANTLEGION_AUTHOR=me \
 *     node dist/bin.js publish demo.hello '{"msg":"hi"}'
 *
 * Identity: `--author <name>` on any command > ANTLEGION_AUTHOR > `<user>@<hostname>`.
 * Address:  `--bus <url>` on any command > ANTLEGION_BUS_URL > http://localhost:28090.
 */

import { ClientV2, httpTransport, defaultAuthor } from "./client.js";
import { runCli } from "./cli.js";

/**
 * `--bus` is read here rather than inside runCli because it decides the
 * transport, which runCli is handed. It is worth having as a flag at all
 * because the failure it prevents is silent: without it, a `--bus` typed out of
 * habit was an unknown flag, and the fact went to the default log instead.
 */
function busFlag(argv: string[]): string | undefined {
  const i = argv.indexOf("--bus");
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next != null && !next.startsWith("--") ? next : undefined;
}

const url = (busFlag(process.argv.slice(2)) ?? process.env.ANTLEGION_BUS_URL ?? "http://localhost:28090")
  .replace(/\/$/, "");
const author = process.env.ANTLEGION_AUTHOR ?? defaultAuthor();

const client = new ClientV2(httpTransport(url), author);

runCli(
  process.argv.slice(2),
  client,
  (line) => process.stdout.write(line + "\n"),
  (line) => process.stderr.write(line + "\n"),
)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`alctl fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
