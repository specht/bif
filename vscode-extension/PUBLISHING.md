# Publishing checklist

Publishing requires access to the verified `gymnasiumsteglitz` publisher and a
new extension version. Never store the Marketplace PAT in this repository.

```bash
node --version
npm install
npm run test
npm run package
code --install-extension bif-authoring-tools-0.1.0.vsix --force
code --profile "BIF Extension Test" /path/to/story
npx @vscode/vsce login gymnasiumsteglitz
npx @vscode/vsce publish
```

Alternatively, upload the generated VSIX manually through the Visual Studio
Marketplace publisher portal. Increment `version` before every release.
