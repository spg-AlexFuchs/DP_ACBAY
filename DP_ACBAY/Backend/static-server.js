const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const frontendPath = path.join(__dirname, "..", "Frontend");

app.use(express.static(frontendPath));

// fallback to index.html for SPA-like behavior
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Frontend static server running on http://localhost:${PORT}`);
  console.log(`Serving files from ${frontendPath}`);
});
