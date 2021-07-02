This repo is set to generate and publish RSS feeds listing [issues opened on the MDN Content repository](github.com/mdn/content/issues): the issues are grouped in feeds based on the organization (e.g. W3C, WHATWG) that publish the specifications relevant to the issues, and in feeds based on the specific groups (e.g. W3C WebRTC Working Group, WHATWG HTML Workstream).

The link between issues and specifications is established via the linkage between MDN pages (listed in the issues) and specs maintained in [Browser Compat Data](https://github.com/mdn/browser-compat-data/), and the links between specs and orgs/groups via [browser-specs](https://github.com/w3c/browser-specs).

# Usage
Copy `config.json.dist` in `config.json` and set the `ghToken` key to a GitHub token.

```
npm install
node index.js
```
