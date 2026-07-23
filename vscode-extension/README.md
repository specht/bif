# BIF Authoring Tools

This extension provides live diagnostics for BIF Markdown stories and keeps `.story-tools/analysis.json` current for the browser authoring view.

It discovers workspace folders containing `config.js`, reads the configured story folder, and watches that folder's page and asset files. Analysis uses the same shared publication service as `npm run dev`; story code is never executed during analysis.

Commands:

- **BIF: Refresh Story Diagnostics**
- **BIF: Show Story Summary**
- **BIF: Show Output**

The browser reads the publication to render its graph and Problems view. The extension does not generate or open a separate graph file.

For maintainers, the authoritative publication schema version is in `tools/lib/analysis-schema.js`. Publications include diagnostic `publisher` metadata (`name`, package `version`, and a `source` of either `npm-watch` or `vscode-extension`); this metadata is deliberately excluded from semantic analysis identity. If the browser reports an older schema writer, update/reinstall the named tool or run `npm run dev` from the project root.

## Build and package locally

From the repository root, run:

```bash
cd vscode-extension
npm ci
npm run check-types
npm test
npm run package
```

`npm run package` compiles the extension, creates `vscode-extension/bif-authoring-tools-<version>.vsix` with the repository's local `@vscode/vsce`, and checks the archive contents. To inspect it manually, run `unzip -l bif-authoring-tools-<version>.vsix`.

Install the package and reload VS Code:

```bash
code --install-extension bif-authoring-tools-<version>.vsix
```

To replace an older installed build explicitly:

```bash
code --install-extension bif-authoring-tools-<version>.vsix --force
```

After reloading, verify the installed version in the Extensions view. If a pre-release used a different publisher or extension ID, uninstall that old build before testing this package.
