"use strict";

const fs = require("fs");

const octokit = require("./lib/octokit");
const { JSDOM } = require("jsdom");
const bcd = require('@mdn/browser-compat-data');
const browserSpecs = require("browser-specs");


const issueQuery = `
  query ($cursor: String){
    repository(owner: "mdn", name: "content") {
      issues(first: 100, after: $cursor, states: [OPEN]) {
        nodes {
          bodyHTML
          createdAt
          number
          url
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
        map[data.__compat.mdn_url] = data.__compat.spec_url;
      }
      for (let subdata of Object.values(data)) {
        if (subdata?.__compat?.mdn_url) {
          map[subdata.__compat.mdn_url] = subdata.__compat.spec_url;
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


(async function() {
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
    const spec_url = pageMap[page_url];
    if (!spec_url || !spec_url.startsWith) {
      console.error(`No matching spec entry for ${page_url} found in BCD`);
      return;
    }
    const spec = browserSpecs.find(s => spec_url.startsWith(s.url) || spec_url.startsWith(s.series.nightlyUrl)  || spec_url.startsWith(s.nightly.url));
    if (!spec) {
      console.error(`No matching spec for ${spec_url} from ${p} found in browser-specs`);
      return;
    }
    specs[spec.shortname] = specs[spec.shortname] ?? [];
    specs[spec.shortname].push(pages[p]);
  });
  Object.keys(specs).forEach(s => {
    specs[s] = specs[s].sort((a, b) => a.created_at - b.created_at);
  });
  fs.writeFileSync("unknownpages.json", JSON.stringify(unknownPages, null, 2));
  fs.writeFileSync("nomatch.json", JSON.stringify(noMatch, null, 2));
  fs.writeFileSync("byspec.json", JSON.stringify(specs, null, 2));
})();

