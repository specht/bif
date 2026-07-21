const path = require('node:path');
const chokidar = require('chokidar');
const { publishProjectAnalysis } = require('./publish-project-analysis');

function ignoredPath(projectRoot, candidate) {
  const relative = path.relative(projectRoot, candidate).split(path.sep).join('/');
  if (!relative) return false;
  return relative === '.story-tools' || relative.startsWith('.story-tools/')
    || relative === 'node_modules' || relative.startsWith('node_modules/')
    || relative === '.git' || relative.startsWith('.git/')
    || /(^|\/)(?:\.?#|#).*#$/.test(relative)
    || /~$/.test(relative);
}

async function startProjectAnalysisWatch(projectRoot, options = {}) {
  const publish = options.publish || publishProjectAnalysis;
  const debounceMs = options.debounceMs ?? 150;
  const onResult = options.onResult || (() => {});
  const onError = options.onError || (() => {});
  let timer = null;
  let running = null;
  let rerun = false;
  let closed = false;

  async function run() {
    if (closed) return;
    if (running) { rerun = true; return running; }
    running = (async () => {
      do {
        rerun = false;
        try { onResult(await publish(projectRoot)); }
        catch (error) { onError(error); }
      } while (rerun && !closed);
    })();
    try { await running; } finally { running = null; }
  }

  function schedule() {
    if (closed) return;
    if (running) { rerun = true; return; }
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void run(); }, debounceMs);
  }

  const initial = await publish(projectRoot);
  onResult(initial);
  const watcher = chokidar.watch(projectRoot, {
    ignoreInitial: true,
    ignored: candidate => ignoredPath(projectRoot, candidate),
    awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 20 },
  });
  for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) watcher.on(event, schedule);
  await new Promise((resolve, reject) => watcher.once('ready', resolve).once('error', reject));
  return {
    initial,
    schedule,
    async close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await watcher.close();
      await running;
    },
  };
}

module.exports = { ignoredPath, startProjectAnalysisWatch };
