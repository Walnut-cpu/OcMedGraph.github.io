require('dotenv').config(); // ✅ 先加载 .env 文件

const express = require("express");
const neo4j = require("neo4j-driver");
const path = require("path");

const app = express();
const port = 4000;

// 从环境变量中获取数据库配置
const dbUri = process.env.NEO4J_URI;
const dbUsername = process.env.NEO4J_USER;
const dbPassword = process.env.NEO4J_PASSWORD;

// 如果环境变量缺失，给出提示
if (!dbUri || !dbUsername || !dbPassword) {
  console.error("❌ Neo4j 数据库连接信息未配置完整，请检查 .env 文件");
  console.error("当前读取到的值：", { dbUri, dbUsername, dbPassword });
  process.exit(1); // 直接退出
}

// 创建 Neo4j 驱动
const driver = neo4j.driver(dbUri, neo4j.auth.basic(dbUsername, dbPassword));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  console.log("Serving index.html");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function processResult(result) {
  console.log(`Processing result: ${result.records.length} records`);
  const nodesMap = new Map();
  const edges = [];
  result.records.forEach(record => {
    const n = record.get("n");
    const m = record.get("m");
    const r = record.get("r");
    [n, m].forEach(node => {
      const id = node.identity.toString();
      if (!nodesMap.has(id)) {
        nodesMap.set(id, {
          id,
          labels: node.labels,
          properties: node.properties
        });
      }
    });
    edges.push({
      from: n.identity.toString(),
      to: m.identity.toString(),
      label: r.type
    });
  });
  console.log(`Processed nodes: ${nodesMap.size}, edges: ${edges.length}`);
  return {
    nodes: Array.from(nodesMap.values()),
    edges
  };
}

// 获取所有节点标签
app.get("/api/graph/labels", async (req, res) => {
  console.log("GET /api/graph/labels called");
  const session = driver.session();
  try {
    const result = await session.run(`CALL db.labels()`);
    const labels = result.records.map(r => r.get(0));
    console.log(`Labels fetched: ${labels.length}`);
    res.json(labels);
  } catch (err) {
    console.error("Error fetching labels:", err);
    res.status(500).send("获取标签失败");
  } finally {
    await session.close();
  }
});

// 初始加载全部节点关系
app.get("/api/graph/initial", async (req, res) => {
  console.log("GET /api/graph/initial called");
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n)-[r]->(m) RETURN n, r, m`
    );
    const { nodes, edges } = processResult(result);
    console.log(`Initial graph loaded: ${nodes.length} nodes, ${edges.length} edges`);
    res.json({ nodes, edges });
  } catch (err) {
    console.error("Error in /api/graph/initial:", err);
    res.status(500).send("查询失败");
  } finally {
    await session.close();
  }
});

// 按标签获取节点列表
app.get("/api/graph/nodesByLabel/:label", async (req, res) => {
  const label = req.params.label;
  console.log(`GET /api/graph/nodesByLabel/${label} called`);
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (n:\`${label}\`) RETURN n`
    );
    const nodes = result.records.map(r => {
      const n = r.get("n");
      return {
        id: n.identity.toString(),
        labels: n.labels,
        properties: n.properties
      };
    });
    console.log(`Nodes fetched for label '${label}': ${nodes.length}`);
    res.json(nodes);
  } catch (err) {
    console.error(`Error fetching nodes by label '${label}':`, err);
    res.status(500).send("查询失败");
  } finally {
    await session.close();
  }
});

// 搜索节点和相关关系
app.get("/api/graph/search", async (req, res) => {
  const query = req.query.query;
  console.log(`GET /api/graph/search called with query: '${query}'`);
  if (!query) {
    console.warn("No query parameter provided for search");
    return res.status(400).send("缺少查询参数");
  }
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (n)-[r]-(m)
      WHERE toLower(n.properties.name) CONTAINS toLower($query)
         OR toLower(m.properties.name) CONTAINS toLower($query)
      RETURN n, r, m
      `,
      { query }
    );
    const { nodes, edges } = processResult(result);
    console.log(`Search results: ${nodes.length} nodes, ${edges.length} edges`);
    res.json({ nodes, edges });
  } catch (err) {
    console.error("Error in /api/graph/search:", err);
    res.status(500).send("查询失败");
  } finally {
    await session.close();
  }
});

// 展开节点邻居
app.get("/api/graph/expand/:nodeId", async (req, res) => {
  const nodeId = req.params.nodeId;
  console.log(`GET /api/graph/expand/${nodeId} called`);
  const session = driver.session();
  try {
    const result = await session.run(
      `
      MATCH (n)-[r]-(m)
      WHERE id(n) = toInteger($nodeId) OR id(m) = toInteger($nodeId)
      RETURN n, r, m
      `,
      { nodeId }
    );
    const { nodes, edges } = processResult(result);
    console.log(`Expand node results: ${nodes.length} nodes, ${edges.length} edges`);
    res.json({ nodes, edges });
  } catch (err) {
    console.error(`Error in /api/graph/expand/${nodeId}:`, err);
    res.status(500).send("查询失败");
  } finally {
    await session.close();
  }
});

app.listen(port, () => {
  console.log(`✅ 服务器已启动：http://localhost:${port}`);
});
