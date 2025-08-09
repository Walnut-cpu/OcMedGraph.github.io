// /api/graph.js
import neo4j from "neo4j-driver";

// 从环境变量获取 Neo4j 配置
const dbUri = process.env.NEO4J_URI;
const dbUsername = process.env.NEO4J_USER;
const dbPassword = process.env.NEO4J_PASSWORD;

// 简单检查
if (!dbUri || !dbUsername || !dbPassword) {
  throw new Error("Neo4j 环境变量未配置完整");
}

// 创建 driver （serverless 环境可共用此 driver）
const driver = neo4j.driver(dbUri, neo4j.auth.basic(dbUsername, dbPassword));

function processResult(result) {
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
  return {
    nodes: Array.from(nodesMap.values()),
    edges
  };
}

// 这是 Vercel Serverless Function 的入口
export default async function handler(req, res) {
  // 根据不同路径和查询参数分发逻辑
  const { method, url, query } = req;

  // 解析 URL path，假设路由如 /api/graph?action=labels 或 /api/graph?action=initial ...
  // 或者也可用 req.url 里解析更复杂路径，你可以根据自己需求改

  // 这里用 query.action 来控制行为
  const action = query.action;

  if (method !== "GET") {
    res.status(405).json({ error: "只支持 GET 请求" });
    return;
  }

  const session = driver.session();

  try {
    if (action === "labels") {
      const result = await session.run(`CALL db.labels()`);
      const labels = result.records.map(r => r.get(0));
      res.status(200).json(labels);
      return;
    }

    if (action === "initial") {
      const result = await session.run(`MATCH (n)-[r]->(m) RETURN n, r, m`);
      const graph = processResult(result);
      res.status(200).json(graph);
      return;
    }

    if (action === "nodesByLabel") {
      const label = query.label;
      if (!label) {
        res.status(400).json({ error: "缺少 label 参数" });
        return;
      }
      const result = await session.run(`MATCH (n:\`${label}\`) RETURN n`);
      const nodes = result.records.map(r => {
        const n = r.get("n");
        return {
          id: n.identity.toString(),
          labels: n.labels,
          properties: n.properties
        };
      });
      res.status(200).json(nodes);
      return;
    }

    if (action === "search") {
      const q = query.query;
      if (!q) {
        res.status(400).json({ error: "缺少 query 参数" });
        return;
      }
      const result = await session.run(
        `
        MATCH (n)-[r]-(m)
        WHERE toLower(n.properties.name) CONTAINS toLower($query)
           OR toLower(m.properties.name) CONTAINS toLower($query)
        RETURN n, r, m
        `,
        { query: q }
      );
      const graph = processResult(result);
      res.status(200).json(graph);
      return;
    }

    if (action === "expand") {
      const nodeId = query.nodeId;
      if (!nodeId) {
        res.status(400).json({ error: "缺少 nodeId 参数" });
        return;
      }
      const result = await session.run(
        `
        MATCH (n)-[r]-(m)
        WHERE id(n) = toInteger($nodeId) OR id(m) = toInteger($nodeId)
        RETURN n, r, m
        `,
        { nodeId }
      );
      const graph = processResult(result);
      res.status(200).json(graph);
      return;
    }

    res.status(400).json({ error: "未知 action" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "服务器内部错误", detail: err.message });
  } finally {
    await session.close();
  }
}
