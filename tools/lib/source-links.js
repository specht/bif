function sourceLocation(source) {
  return `${source.file}:${source.line || 1}:${source.column || 1}`;
}

module.exports = { sourceLocation };
