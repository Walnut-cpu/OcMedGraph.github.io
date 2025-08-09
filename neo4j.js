require("dotenv").config(); // 读取 .env 文件里的环境变量
const express = require("express");
const neo4j = require("neo4j-driver");
const path = require("path");

const app = express();
const port = process.env.PORT || 4000;

// Neo4j driver setup (从环境变量读取)
const driver = neo4j.driver(
  process.env.BOLT_URL, // e.g. bolt://localhost:7687
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD)
);

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// API endpoint to get full graph data
app.get("/api/graph", async (req, res) => {
  const session = driver.session();

  try {
    const result = await session.run(`
      MATCH (n)-[r]->(m)
      RETURN n, r, m
    `);

    const nodesMap = new Map();
    const edges = [];

    result.records.forEach(record => {
      const n = record.get("n");
      const m = record.get("m");
      const r = record.get("r");

      [n, m].forEach(node => {
        if (!nodesMap.has(node.identity.toString())) {
          nodesMap.set(node.identity.toString(), {
            id: node.identity.toString(),
            label: node.labels[0],
            properties: node.properties,
          });
        }
      });

      edges.push({
        from: n.identity.toString(),
        to: m.identity.toString(),
        label: r.type,
      });
    });

    res.json({
      nodes: Array.from(nodesMap.values()),
      edges,
    });
  } catch (error) {
    console.error("Error querying Neo4j:", error);
    res.status(500).send("Error fetching data from Neo4j");
  } finally {
    await session.close();
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
