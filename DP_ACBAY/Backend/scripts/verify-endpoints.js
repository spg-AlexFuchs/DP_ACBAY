const { execSync } = require("child_process");
const http = require("http");

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const txt = Buffer.concat(chunks).toString("utf8");
          const json = JSON.parse(txt);
          resolve({ status: res.statusCode, json });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    if (opts.timeout) req.setTimeout(opts.timeout, () => req.abort());
  });
}

async function run() {
  console.log("=== Verify script ===");
  try {
    console.log("Running importer: node services/import/import-excel.js");
    execSync("node services/import/import-excel.js", {
      stdio: "inherit",
      cwd: __dirname + "/..",
    });
  } catch (err) {
    console.error(
      "Importer failed or not present. You can run it manually. Continuing to endpoint checks...",
      err.message || err,
    );
  }

  const base = "http://localhost:3000";
  const endpoints = [
    "/surveys/public",
    "/emission-factors",
    "/public/aggregations",
  ];

  for (const ep of endpoints) {
    const url = base + ep;
    process.stdout.write(`Checking ${url} ... `);
    try {
      const r = await fetchJson(url, { timeout: 5000 });
      console.log(`OK (${r.status})`);
      if (Array.isArray(r.json)) {
        console.log(`  items: ${r.json.length}`);
      } else if (r.json && typeof r.json === "object") {
        console.log(`  keys: ${Object.keys(r.json).join(", ")}`);
      }
    } catch (err) {
      console.log(`FAILED - ${err.message || err}`);
    }
  }

  console.log("=== Verify finished ===");
}

run().catch((e) => {
  console.error("Script error:", e);
  process.exit(1);
});
