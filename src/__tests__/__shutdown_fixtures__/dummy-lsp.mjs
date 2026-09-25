import { writeFileSync } from "node:fs";

writeFileSync(process.argv[2], String(process.pid));

function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  for (;;) {
    const separator = buffer.indexOf("\r\n\r\n");
    if (separator === -1) return;

    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, separator).toString())?.[1]);
    const bodyStart = separator + 4;
    if (buffer.length < bodyStart + length) return;

    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString());
    buffer = buffer.subarray(bodyStart + length);

    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
    }
  }
});

setInterval(() => {}, 1000);
