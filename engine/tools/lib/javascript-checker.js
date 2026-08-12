const acorn = require("acorn");

function normalizeAcornError(error) {
  const line = error.loc?.line;
  const column = error.loc?.column;
  const suffix = Number.isInteger(line) && Number.isInteger(column) ? ` (${line}:${column})` : "";
  return {
    message: suffix && error.message.endsWith(suffix) ? error.message.slice(0, -suffix.length) : error.message,
    line,
    column,
  };
}

function checkScript(source) {
  try {
    acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    });
    return null;
  } catch (error) {
    return normalizeAcornError(error);
  }
}

function checkExpression(source) {
  try {
    const program = acorn.parse(`(${source}\n)`, {
      ecmaVersion: "latest",
      sourceType: "script",
      locations: true,
    });
    if (program.body.length !== 1) throw new SyntaxError("Expected one expression");
    return null;
  } catch (error) {
    return normalizeAcornError(error);
  }
}

module.exports = { checkExpression, checkScript, normalizeAcornError };
