# BIF Authoring Tools

This extension provides live diagnostics for BIF Markdown stories and keeps `.story-tools/analysis.json` current for the browser authoring view.

It discovers workspace folders containing `config.js`, reads the configured story folder, and watches that folder's page and asset files. Analysis uses the same shared publication service as `npm run dev`; story code is never executed during analysis.

Commands:

- **BIF: Refresh Story Diagnostics**
- **BIF: Show Story Summary**
- **BIF: Show Output**

The browser reads the publication to render its graph and Problems view. The extension does not generate or open a separate graph file.
