const axios = require('axios');
const cheerio = require('cheerio');
const core = require('@actions/core');

const version = process.argv[2];
const filterTargetsStr = process.argv[3] || '';
const filterSubtargetsStr = process.argv[4] || '';

const filterTargets = filterTargetsStr ? filterTargetsStr.split(',').map(t => t.trim()).filter(t => t) : [];
const filterSubtargets = filterSubtargetsStr ? filterSubtargetsStr.split(',').map(s => s.trim()).filter(s => s) : [];

if (!version) {
  core.setFailed('Version argument is required');
  process.exit(1);
}

const MIRRORS = [
  'https://downloads.openwrt.org',
  'https://mirror-03.infra.openwrt.org',
  'https://archive.openwrt.org'
];

let baseUrl = MIRRORS[0];

async function fetchHTML(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      return cheerio.load(data);
    } catch (error) {
      console.error(`Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, attempt * 1000));
      }
    }
  }
  return null;
}

async function getItems(url) {
  const $ = await fetchHTML(url);
  if (!$) return [];
  const items = [];
  $('table tr td.n a').each((_, el) => {
    const name = $(el).attr('href');
    // Filter: must end with /, not be ../ or parent directory links
    if (name && name.endsWith('/') && !name.startsWith('/') && name !== '../') {
      items.push(name.slice(0, -1));
    }
  });
  return items;
}

async function getTargets() {
  for (const mirror of MIRRORS) {
    const url = `${mirror}/releases/${version}/targets/`;
    const items = await getItems(url);
    if (items.length > 0) {
      baseUrl = mirror;
      return items;
    }
  }
  return [];
}

async function getDetails(target, subtarget) {
  const packagesUrl = `${baseUrl}${target}/${subtarget}/packages/`;
  const $ = await fetchHTML(packagesUrl);
  if (!$) return { vermagic: '', pkgarch: '' };

  let vermagic = '';
  let pkgarch = '';

  $('a').each((_, el) => {
    const name = $(el).attr('href');
    if (name && name.startsWith('kernel_')) {
      // Улучшенное регулярное выражение: поддерживает .ipk и .apk
      const match = name.match(/kernel_.*[-~]([a-f0-9]+)_([a-zA-Z0-9_-]+)\.(?:ipk|apk)$/);
      if (match) {
        vermagic = match[1];
        pkgarch = match[2];
      }
    }
  });
  return { vermagic, pkgarch };
}

async function main() {
  try {
    const targets = await getTargets();
    if (targets.length === 0) {
      core.setFailed(`No targets found for version ${version}. Check if version exists.`);
      return;
    }

    const jobConfig = [];

    for (const target of targets) {
      if (filterTargets.length > 0 && !filterTargets.includes(target)) continue;

      const subtargets = await getItems(`${baseUrl}${target}/`);

      for (const subtarget of subtargets) {
        if (filterSubtargets.length > 0 && !filterSubtargets.includes(subtarget)) continue;

        console.log(`Processing: ${target}/${subtarget}`);
        const { vermagic, pkgarch } = await getDetails(target, subtarget);

        if (pkgarch) {
          jobConfig.push({
            tag: version,
            target,
            subtarget,
            vermagic,
            pkgarch,
          });
        }
      }
    }

    if (jobConfig.length === 0) {
      core.setFailed("No targets found to build. Check your filters.");
    } else {
      console.log(`Total jobs generated: ${jobConfig.length}`);
      core.setOutput('job-config', JSON.stringify(jobConfig));
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

main();