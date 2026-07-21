const fs = require("node:fs/promises");
const path = require("node:path");
const acorn = require("acorn");

async function readProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, "config.js");
  const source = await fs.readFile(configPath, "utf8");
  const program = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
  });
  const values = {};

  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    if (!declaration || declaration.type !== "VariableDeclaration") continue;
    for (const item of declaration.declarations) {
      if (
        item.id.type === "Identifier" &&
        ["title", "path"].includes(item.id.name) &&
        item.init?.type === "Literal" &&
        typeof item.init.value === "string"
      ) {
        values[item.id.name] = item.init.value;
      }
    }
  }

  if (!values.path) {
    const error = new Error("config.js must export a literal string named path");
    error.loc = { line: 1, column: 0 };
    throw error;
  }
  return { title: values.title || "", pagesPath: values.path };
}

module.exports = { readProjectConfig };
