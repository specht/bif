const acorn = require("acorn");

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
    return error;
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
    return error;
  }
}

module.exports = { checkExpression, checkScript };
