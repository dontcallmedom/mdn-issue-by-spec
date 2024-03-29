"use strict";

const fs = require("fs");
const path = require("path");

const octokit = require("./lib/octokit");
const { JSDOM } = require("jsdom");
const bcd = require('@mdn/browser-compat-data');
const browserSpecs = require("browser-specs");
const {Feed} = require("feed");
const GfmEscape = require('gfm-escape');

const gfmEscaper = new GfmEscape();

const toSlug = title => title.replace(/([A-Z])/g, s => s.toLowerCase())
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_');


const arrayify = x => Array.isArray(x) ? x : [x];

const issueQuery = `
  query ($cursor: String){
    repository(owner: "mdn", name: "content") {
      issues(first: 100, after: $cursor, states: [OPEN]) {
        nodes {
          title
          bodyHTML
          createdAt
          number
          url
          author {
            login
            url
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const mdnURLMatcher = new RegExp("(https:\/\/developer\.mozilla\.org\/en-US/docs/Web/.*)[)\s]?", "g");

async function *listMDNContentIssues() {
  for (let cursor = null; ;) {
    const res = await octokit.graphql(issueQuery, {cursor});
    for (const issue of res.repository.issues.nodes) {
      yield issue;
    }
    if (res.repository.issues.pageInfo.hasNextPage) {
      cursor = res.repository.issues.pageInfo.endCursor;
    } else {
      break;
    }
  }
}

function mapPagesToSpec(bcd) {
  const map = {};
  for(let area of Object.values(bcd)) {
    for (let data of Object.values(area)) {
      if (data?.__compat?.mdn_url) {
        map[data.__compat.mdn_url] = arrayify(data.__compat.spec_url);
      }
      for (let subdata of Object.values(data)) {
        if (subdata?.__compat?.mdn_url) {
          map[subdata.__compat.mdn_url] = arrayify(subdata.__compat.spec_url);
        }
      }
    }
  }
  return map;
}

function findRelatedMDNPages(issue) {
  const dom = new JSDOM(issue.bodyHTML);
  let pages = [];
  [...dom.window.document.querySelectorAll('a[href]')].forEach(n => {
    if (n.href && n.href.startsWith("https://developer.mozilla.org/en-US/docs/Web/")) {
      pages.push(n.href.split('/').slice(6).join('/').split('#')[0]);
    }
  });
  return pages;
}

function generateMarkdown(scope, issues) {
  return `# ${scope}-relevant MDN issues

[Issues filed on MDN Web Docs](https://github.com/mdn/content/issues) related to pages attached to technologies developed by ${scope}. [![RSS feed for ${scope}-relevant issues](https://www.w3.org/QA/2007/04/feed_icon)](${path}.rss)

${issues.map(issue => `* [${gfmEscaper.escape(issue.title)}](${issue.url}) (${issue.createdAt})
  `).join("\n")}
`;
}

function generateFeed(scope, path, issues) {
  const feed = new Feed({
    title: `${scope}-relevant MDN issues`,
    description: `Issue filed on MDN Web Docs related to pages attached to technologies developed by ${scope}`,
    link: `https://dontcallmedom.github.io/mdn-issue-by-spec/${path}.rss`,
    updated: new Date(issues.map(i => i.createdAt).sort().pop()),
    language: "en",
    author: {
      name: "mdn-issue-by-spec",
      link: "https://github.com/dontcallmedom/mdn-issue-by-spec"
    }
  });
  issues.forEach(issue => {
    feed.addItem({
      title: issue.title,
      id: issue.url,
      link: issue.url,
      content: issue.bodyHTML,
      author: [
        {name: issue.author?.login, link: issue.author?.url}
      ],
      date: new Date(issue.createdAt)
    });
  });
  return feed;
}

async function mapIssuesToSpecs() {
  let pageMap = mapPagesToSpec(bcd);
  let pages = {};
  let specs = {};
  let unknownPages = [];
  let noMatch = {};
  for await (const issue of  listMDNContentIssues()) {
    const relatedPages = findRelatedMDNPages(issue);
    if (relatedPages.length === 0) {
      unknownPages.push(issue);
    }
    relatedPages.forEach(p => {
      pages[p] = pages[p] ?? [];
      if (!pages[p].find(i => i.number === issue.number)) {
        pages[p].push(issue);
      }
    });
  }
  Object.keys(pages).forEach(p => {
    const page_url = Object.keys(pageMap).find(url => url.toLowerCase().endsWith(p.toLowerCase()));
    if (!page_url) {
      noMatch[p] = pages[p];
      return;
    }
    const spec_urls = pageMap[page_url];
    if (!spec_urls || !spec_urls.length) {
      console.error(`No matching entry for ${page_url} found in BCD`);
      return;
    }
    for (let spec_url of spec_urls) {
      if (!spec_url) {
        console.error(`No matching spec URL for ${page_url} found in BCD`);
        return;
      }
      const spec = browserSpecs.find(s => spec_url.startsWith(s.url) || spec_url.startsWith(s.series.nightlyUrl)  || spec_url.startsWith(s.nightly.url));
      if (!spec) {
        console.error(`No matching spec for ${spec_url} from ${p} found in browser-specs`);
        return;
      }
      specs[spec.shortname] = specs[spec.shortname] ?? spec;
      specs[spec.shortname].issues = specs[spec.shortname].issues ?? [];
      specs[spec.shortname].issues = specs[spec.shortname].issues.concat(pages[p]);
    }
  });

  fs.writeFileSync("unknownpages.json", JSON.stringify(unknownPages, null, 2));
  fs.writeFileSync("nomatch.json", JSON.stringify(noMatch, null, 2));
  return specs;
}

(async function() {
  fs.mkdirSync(path.join(__dirname, 'public'), {recursive: true});
  const specToIssues = await mapIssuesToSpecs();
  // group issues by org and by group
  let groups = {};
  let orgs = {};
  for (let spec of Object.values(specToIssues)) {
    for (let group of spec.groups) {
      const name = `${spec.organization} ${group.name}`;
      if (!groups[name]) {
        groups[name] = [];
      }
      if (!orgs[spec.organization]) {
        orgs[spec.organization] = [];
      }
      groups[name] = groups[name].concat(spec.issues);
      orgs[spec.organization] = orgs[spec.organization].concat(spec.issues);
    }
  }

  let index = [];
  for (let collection of [groups, orgs]) {
    for (let name of Object.keys(collection)) {
      // Remove duplicates and label titles
      collection[name] = collection[name].filter((issue, index, arr) => arr.findIndex(i => issue.number === i.number) === index)
        .map(issue => {
          const relevantSpecs = Object.values(specToIssues)
                .filter(spec => spec.issues.find(i => i.number === issue.number))
                .map(spec => spec.shortname);
          return {
            ...issue,
            title: `[${relevantSpecs.join(', ')}] ${issue.title}`
          };
        })
        .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
      // Generate feed
      const path = toSlug(name);
      const feed = generateFeed(name, path, collection[name]);
      fs.writeFileSync("public/" + path + ".rss", feed.rss2());
      fs.writeFileSync("public/" + path + ".json", feed.json1());

      const markdown = generateMarkdown(name, collection[name]);
      fs.writeFileSync("public/" + path + ".md", markdown);

      index.push({name, path, count: collection[name].length});
    }
    index.sort((a, b) => a.name.localeCompare(b.name));
    const README = `
# MDN Web Docs Issues grouped by the spec they relate to

This repository collects information on MDN Web Docs issues and group them based on the specifications they relate to and the orgs / groups that produce these specifications.

${index.map(({name, path, count}) => `* [${name}](${path}.md): ${count} issues [![RSS feed for ${name}-relevant issues](https://www.w3.org/QA/2007/04/feed_icon)](${path}.rss)`).join("\n")}
`;
    fs.writeFileSync("public/README.md", README);

  }
})();

