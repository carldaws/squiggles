// Dummy LSP for the shutdown integration test.
// Writes its PID to argv[2] so the test can verify the process was reaped
// after squiggles exits. Answers initialize only, then hangs on everything
// (including shutdown) so the ONLY way to exit is squiggles's kill() — the
// path that used to be skipped when the EPIPE bug killed the parent mid-shutdown.
import process from "node:process";
import { writeFileSync } from "node:fs";

writeFileSync(process.argv[2], String(process.pid));

function send(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep === -1) break;
    const header = buf.slice(0, sep).toString();
    const m = /Content-Length: (\d+)/i.exec(header);
    if (!m) { buf = buf.slice(sep + 4); continue; }
    const len = parseInt(m[1], 10);
    if (buf.length < sep + 4 + len) break;
    const body = buf.slice(sep + 4, sep + 4 + len).toString();
    buf = buf.slice(sep + 4 + len);
    const msg = JSON.parse(body);
    if (msg.method === "initialize") {
      send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { textDocumentSync: 1 } } });
    }
  }
});
setInterval(() => {}, 1000);