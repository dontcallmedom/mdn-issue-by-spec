This repo is set to generate and publish [issues opened on the MDN Content repository](github.com/mdn/content/issues) grouped by the spec they relate to. These issues are made available as HTML, JSON and RSS on https://dontcallmedom.github.io/mdn-issue-by-spec/.

The link between issues and specifications is established via the linkage between MDN pages (listed in the issues) and specs maintained in [Browser Compat Data](https://github.com/mdn/browser-compat-data/), and the links between specs and orgs/groups via [browser-specs](https://github.com/w3c/browser-specs).

# Usage
Copy `config.json.dist` in `config.json` and set the `ghToken` key to a GitHub token.

```
npm install
node index.js
```
